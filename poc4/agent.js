/**
 * POC 4 — Agente Multi-herramienta IACC
 *
 * Claude Opus 4.6 decide autónomamente qué herramienta usar según la pregunta:
 *   - search_knowledge_base → ChromaDB (RAG semántico: APIs, contexto de issues)
 *   - query_jira            → Jira REST API (filtros exactos: fechas, estados, asignados)
 *   - get_jira_issue        → Detalle completo de un issue específico por key
 *
 * Arquitectura del loop:
 *   1. Claude recibe pregunta + definición de herramientas
 *   2. Claude responde con tool_use (qué herramienta y con qué args)
 *   3. Ejecutamos la herramienta y devolvemos tool_result
 *   4. Repetimos hasta que Claude responde con end_turn
 *   5. Langfuse traza cada paso (decide → tool → generate)
 */

import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';
import readline from 'readline';

// ── Clientes ─────────────────────────────────────────────────────────────────
const claude   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const chroma   = new ChromaClient({ path: 'http://localhost:8000' });
const embedder = new DefaultEmbeddingFunction();
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl:    process.env.LANGFUSE_BASE_URL,
});

const JIRA_AUTH = 'Basic ' + Buffer.from(
  `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
).toString('base64');

// ── Definición de herramientas para Claude ────────────────────────────────────
const TOOLS = [
  {
    name: 'search_knowledge_base',
    description: `Busca en la base de conocimiento de IACC usando búsqueda semántica.
Cubre catálogo de APIs y descripciones de issues Jira.
Usa esta herramienta para preguntas sobre:
- Contenido de APIs (qué hace un endpoint, cómo autenticar, qué parámetros)
- Contexto y descripción de proyectos o issues Jira
- Búsquedas conceptuales ("algo relacionado con X")
NO uses esta herramienta para: contar issues, filtrar por fechas, filtrar por estado/asignado.`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Pregunta o tema a buscar en lenguaje natural',
        },
        n_results: {
          type: 'integer',
          description: 'Cantidad de resultados a recuperar (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_jira',
    description: `Ejecuta una consulta JQL contra Jira Cloud de IACC.
Usa esta herramienta para preguntas que requieren filtros exactos:
- Issues finalizados/en progreso/bloqueados en un período
- Contar issues por estado, tipo, asignado
- Issues de un proyecto específico ordenados por fecha
- Buscar por asignado, prioridad, etiqueta
Proyectos disponibles: CA, KAG, PEE, IDE1CN, EV, TOP, DIBC, RMCH`,
    input_schema: {
      type: 'object',
      properties: {
        jql: {
          type: 'string',
          description: 'Query JQL válido para Jira Cloud. Ejemplo: project = EV AND status = Done AND updated >= -7d ORDER BY updated DESC',
        },
        max_results: {
          type: 'integer',
          description: 'Máximo de issues a retornar (default: 20, max: 50)',
        },
      },
      required: ['jql'],
    },
  },
  {
    name: 'search_wiki',
    description: `Busca en la Wiki técnica de IACC usando búsqueda semántica.
Cubre documentación de productos, arquitecturas, flujos funcionales, minutas,
onboarding de desarrolladores, estándares y reglas de negocio.
Usa esta herramienta para preguntas sobre:
- Arquitectura de un sistema o producto
- Flujos funcionales o reglas de negocio
- Onboarding y estándares de desarrollo
- Minutas y decisiones de equipo
- Documentación técnica y funcional de productos (SGD, EV, SMC, Portal Pagos, etc.)`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Pregunta o tema a buscar en la wiki en lenguaje natural',
        },
        n_results: {
          type: 'integer',
          description: 'Cantidad de resultados a recuperar (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_jira_issue',
    description: `Obtiene el detalle completo de un issue Jira específico por su key.
Usa esta herramienta cuando necesitas la descripción completa, comentarios o
contexto detallado de un issue en particular (ej: EV-1316, KAG-55).`,
    input_schema: {
      type: 'object',
      properties: {
        issue_key: {
          type: 'string',
          description: 'Key del issue, ej: EV-1316, KAG-55, CA-100',
        },
      },
      required: ['issue_key'],
    },
  },
];

// ── Implementación de herramientas ────────────────────────────────────────────

async function searchChroma(query, nResults = 5, where = undefined) {
  const collection = await chroma.getCollection({
    name: 'iacc-apis',
    embeddingFunction: embedder,
  });
  const params = { queryTexts: [query], nResults: Math.min(nResults, 10) };
  if (where) params.where = where;
  const results = await collection.query(params);
  const chunks   = results.documents[0];
  const metadata = results.metadatas[0];
  return chunks.map((doc, i) => `[${metadata[i]?.source || '?'}]\n${doc}`).join('\n\n---\n\n');
}

async function searchKnowledgeBase(query, nResults = 5) {
  // Busca en APIs + Jira (excluye Wiki)
  return searchChroma(query, nResults, { source: { '$in': ['Matricula-Contrato', 'PlanifCurso', 'Docente', 'Jira'] } });
}

async function queryJira(jql, maxResults = 20) {
  const res = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/search/jql`, {
    method:  'POST',
    headers: { 'Authorization': JIRA_AUTH, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql,
      maxResults: Math.min(maxResults, 50),
      fields: ['summary', 'status', 'issuetype', 'assignee', 'priority', 'updated', 'labels'],
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    return `Error JQL: ${JSON.stringify(err.errorMessages || err)}`;
  }
  const data   = await res.json();
  const issues = data.issues || [];
  if (issues.length === 0) return 'No se encontraron issues con ese criterio.';

  return issues.map(i => {
    const f        = i.fields;
    const updated  = new Date(f.updated).toLocaleDateString('es-CL');
    const assignee = f.assignee?.displayName || 'Sin asignar';
    return `${i.key} [${f.issuetype.name}] | ${f.status.name} | ${updated} | ${assignee}\n  ${f.summary}`;
  }).join('\n');
}

async function getJiraIssue(issueKey) {
  const res = await fetch(
    `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${issueKey}?fields=summary,description,status,issuetype,assignee,priority,labels,comment`,
    { headers: { 'Authorization': JIRA_AUTH, 'Accept': 'application/json' } }
  );
  if (!res.ok) return `Issue ${issueKey} no encontrado.`;

  const data = await res.json();
  const f    = data.fields;

  // Extrae texto de descripción ADF
  const extractText = (node) => {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.content) return node.content.map(extractText).join(' ').trim();
    return '';
  };

  const desc     = extractText(f.description);
  const comments = (f.comment?.comments || []).slice(-3)
    .map(c => `  [${c.author?.displayName}]: ${extractText(c.body).slice(0, 200)}`)
    .join('\n');

  return [
    `${data.key}: ${f.summary}`,
    `Tipo: ${f.issuetype?.name} | Estado: ${f.status?.name} | Prioridad: ${f.priority?.name}`,
    f.assignee ? `Asignado: ${f.assignee.displayName}` : null,
    desc ? `\nDescripción:\n${desc.slice(0, 600)}` : null,
    comments ? `\nÚltimos comentarios:\n${comments}` : null,
  ].filter(Boolean).join('\n');
}

// ── Ejecutor de herramientas ──────────────────────────────────────────────────
async function executeTool(name, input, traceSpan) {
  const span = traceSpan.span({ name: `tool:${name}`, input });
  let result;
  try {
    switch (name) {
      case 'search_knowledge_base':
        result = await searchKnowledgeBase(input.query, input.n_results);
        break;
      case 'search_wiki':
        result = await searchChroma(input.query, input.n_results, { source: { '$eq': 'Wiki' } });
        break;
      case 'query_jira':
        result = await queryJira(input.jql, input.max_results);
        break;
      case 'get_jira_issue':
        result = await getJiraIssue(input.issue_key);
        break;
      default:
        result = `Herramienta desconocida: ${name}`;
    }
  } catch (err) {
    result = `Error ejecutando ${name}: ${err.message}`;
  }
  span.end({ output: result.slice(0, 300) });
  return result;
}

// ── System prompt del agente ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un asistente técnico de IACC con acceso a dos fuentes de información:

1. Base de conocimiento (search_knowledge_base): catálogo de APIs y descripción de issues Jira.
   Úsala para preguntas conceptuales o de contenido.

2. Jira Cloud (query_jira, get_jira_issue): acceso directo a issues en tiempo real.
   Úsala para filtros exactos por fecha, estado, asignado, etc.

Razona sobre qué herramienta es más apropiada antes de llamarla.
Puedes llamar múltiples herramientas si la pregunta lo requiere.
Responde en español, de forma concisa y útil.`;

// ── Agentic loop principal ────────────────────────────────────────────────────
async function runAgent(question) {
  const trace    = langfuse.trace({ name: 'agent-query', input: question });
  const messages = [{ role: 'user', content: question }];

  console.log('\n🤖 Agente pensando...\n');

  let iteraciones = 0;
  const MAX_ITER  = 5; // evita loops infinitos

  while (iteraciones < MAX_ITER) {
    iteraciones++;

    // Streaming para ver la respuesta en tiempo real
    const stream = claude.messages.stream({
      model:    'claude-sonnet-4-6',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system:   SYSTEM_PROMPT,
      tools:    TOOLS,
      messages,
    });

    // Muestra texto en tiempo real
    stream.on('text', (delta) => process.stdout.write(delta));

    const response = await stream.finalMessage();

    // Registra la llamada LLM como generation (tokens + costo visibles en Langfuse)
    const generation = trace.generation({
      name:   `decide-iter-${iteraciones}`,
      model:  'claude-sonnet-4-6',
      input:  messages[messages.length - 1].content,
      output: response.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      usage:  { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
    generation.end();

    // Fin de conversación
    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text')?.text || '';
      trace.update({ output: text });
      break;
    }

    // Claude quiere usar herramientas
    if (response.stop_reason === 'tool_use') {
      // Los bloques thinking no se deben reenviar al historial en multi-turn con tool_use
      const contentForHistory = response.content.filter(b => b.type !== 'thinking');
      messages.push({ role: 'assistant', content: contentForHistory });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults   = [];

      console.log(`\n🔧 Usando: ${toolUseBlocks.map(t => t.name).join(', ')}\n`);

      for (const tool of toolUseBlocks) {
        const result = await executeTool(tool.name, tool.input, trace);
        toolResults.push({
          type:        'tool_result',
          tool_use_id: tool.id,
          content:     result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  await langfuse.flushAsync();
  console.log('\n' + '─'.repeat(60));
}

// ── CLI interactivo ───────────────────────────────────────────────────────────
async function main() {
  console.log('\n🧠 IACC Agent — Claude Sonnet 4.6 + Tool Use');
  console.log('Pregunta en lenguaje natural. El agente decide cómo responder.');
  console.log('"salir" para terminar.\n');
  console.log('Herramientas disponibles:');
  console.log('  📚 search_knowledge_base — RAG semántico (APIs + issues Jira)');
  console.log('  📖 search_wiki           — RAG semántico (Wiki técnica IACC)');
  console.log('  🎯 query_jira            — JQL directo (filtros exactos)');
  console.log('  🔍 get_jira_issue        — Detalle de un issue específico\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('> ', async (question) => {
      if (!question.trim() || question.toLowerCase() === 'salir') {
        console.log('\nHasta luego 👋');
        rl.close();
        return;
      }
      await runAgent(question);
      ask();
    });
  };

  ask();
}

main();
