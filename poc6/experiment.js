/**
 * POC 6 — Prompt Experiments
 *
 * Compara 3 variantes del system prompt del agente usando:
 *   1. Langfuse Datasets — sube las 8 preguntas IACC como dataset "iacc-eval"
 *   2. Langfuse Experiments — cada variante es un "run" vinculado vía item.link()
 *   3. LLM-as-Judge (Haiku 4.5) — mismas 4 dimensiones que POC 5
 *
 * Resultado: tabla comparativa en consola + experimentos visibles en Langfuse
 *   → Datasets → iacc-eval → ver runs lado a lado
 *
 * Uso: npm run experiment
 */

import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';

// ── Clientes ──────────────────────────────────────────────────────────────────
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

const DATASET_NAME = 'iacc-eval';

// ── Dataset (8 preguntas IACC) ────────────────────────────────────────────────
const QUESTIONS = [
  { id: 'q01', pregunta: '¿Cómo se autentica un usuario en la API de matrícula?',
    herramientas_esperadas: ['search_knowledge_base'], tipo: 'semantica', tema: 'APIs' },
  { id: 'q02', pregunta: '¿Cuál es la arquitectura del Portal de Pagos?',
    herramientas_esperadas: ['search_wiki'], tipo: 'semantica', tema: 'arquitectura' },
  { id: 'q03', pregunta: '¿Qué issues están en progreso en el proyecto CA?',
    herramientas_esperadas: ['query_jira'], tipo: 'filtro', tema: 'jira' },
  { id: 'q04', pregunta: '¿Qué dice la wiki sobre el SGD y qué issues están abiertos en ese sistema?',
    herramientas_esperadas: ['search_wiki', 'query_jira'], tipo: 'cruzada', tema: 'sgd' },
  { id: 'q05', pregunta: '¿Qué endpoints existen para gestionar contratos en la API de matrícula?',
    herramientas_esperadas: ['search_knowledge_base'], tipo: 'semantica', tema: 'APIs' },
  { id: 'q06', pregunta: '¿Cuáles son las reglas de negocio del Planificador de Cursos?',
    herramientas_esperadas: ['search_wiki'], tipo: 'semantica', tema: 'reglas' },
  { id: 'q07', pregunta: '¿Qué HDU finalizaron esta semana en el proyecto EV?',
    herramientas_esperadas: ['query_jira'], tipo: 'filtro', tema: 'jira' },
  { id: 'q08', pregunta: '¿Qué hay relacionado con autenticación SSO en las APIs?',
    herramientas_esperadas: ['search_knowledge_base'], tipo: 'semantica', tema: 'APIs' },
];

// ── Variantes de system prompt ────────────────────────────────────────────────
const PROMPT_VARIANTS = [
  {
    name: 'v1-baseline',
    system: `Eres un asistente técnico de IACC con acceso a dos fuentes de información:

1. Base de conocimiento (search_knowledge_base): catálogo de APIs y descripción de issues Jira.
   Úsala para preguntas conceptuales o de contenido.

2. Wiki técnica (search_wiki): arquitectura, flujos, onboarding, estándares, minutas, reglas de negocio.
   Úsala para documentación de productos y sistemas IACC.

3. Jira Cloud (query_jira, get_jira_issue): acceso directo a issues en tiempo real.
   Úsala para filtros exactos por fecha, estado, asignado, etc.

Razona sobre qué herramienta es más apropiada antes de llamarla.
Puedes llamar múltiples herramientas si la pregunta lo requiere.
Responde en español, de forma concisa y útil.`,
  },
  {
    name: 'v2-conciso',
    system: `Eres un asistente técnico de IACC. Reglas estrictas:
- Máximo 3 bullets por respuesta. Sin introducciones ni despedidas.
- Solo información verificada mediante herramientas. Si no hay datos, di "No encontré información suficiente."
- Usa search_knowledge_base para preguntas sobre APIs y endpoints.
- Usa search_wiki para arquitecturas, flujos y documentación técnica de productos.
- Usa query_jira para filtros exactos (fechas, estados, asignados, conteo de issues).
- Usa get_jira_issue solo cuando necesites el detalle completo de un issue específico.
Responde en español.`,
  },
  {
    name: 'v3-estructurado',
    system: `Eres un asistente técnico de IACC. Estructura SIEMPRE tu respuesta con este formato:

**Respuesta:**
[Información directa en 2-4 oraciones concisas]

**Fuentes consultadas:**
[Lista las herramientas que usaste y qué aportó cada una]

Herramientas disponibles:
- search_knowledge_base → APIs y endpoints (búsqueda semántica)
- search_wiki → arquitectura, flujos, reglas de negocio, documentación técnica
- query_jira → filtros JQL exactos: fechas, estados, proyectos, asignados
- get_jira_issue → detalle completo de un issue específico (ej: EV-1316)

Usa herramientas antes de responder. Si necesitas múltiples fuentes, combínalas.
Responde en español con precisión técnica.`,
  },
];

// ── Herramientas del agente ───────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_knowledge_base',
    description: `Busca en catálogo de APIs y issues Jira usando búsqueda semántica.
Úsala para: endpoints, autenticación, contexto de proyectos, búsquedas conceptuales.`,
    input_schema: {
      type: 'object',
      properties: {
        query:     { type: 'string' },
        n_results: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_wiki',
    description: `Busca en la Wiki técnica de IACC.
Úsala para: arquitecturas, flujos, onboarding, estándares, minutas, reglas de negocio.`,
    input_schema: {
      type: 'object',
      properties: {
        query:     { type: 'string' },
        n_results: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_jira',
    description: `Ejecuta JQL contra Jira Cloud.
Úsala para: filtros exactos por fecha, estado, asignado, conteo de issues.`,
    input_schema: {
      type: 'object',
      properties: {
        jql:         { type: 'string' },
        max_results: { type: 'integer' },
      },
      required: ['jql'],
    },
  },
  {
    name: 'get_jira_issue',
    description: 'Obtiene detalle completo de un issue Jira por su key (ej: EV-1316).',
    input_schema: {
      type: 'object',
      properties: { issue_key: { type: 'string' } },
      required: ['issue_key'],
    },
  },
];

// ── Implementaciones de herramientas ──────────────────────────────────────────
async function searchChroma(query, nResults = 5, where) {
  const col = await chroma.getCollection({ name: 'iacc-apis', embeddingFunction: embedder });
  const params = { queryTexts: [query], nResults: Math.min(nResults || 5, 10) };
  if (where) params.where = where;
  const r = await col.query(params);
  return r.documents[0].map((d, i) => `[${r.metadatas[0][i]?.source}]\n${d}`).join('\n\n---\n\n');
}

async function queryJira(jql, maxResults = 20) {
  const res = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Authorization: JIRA_AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, maxResults: Math.min(maxResults || 20, 50),
      fields: ['summary', 'status', 'issuetype', 'assignee', 'updated'] }),
  });
  const data = await res.json();
  return (data.issues || []).map(i =>
    `${i.key} [${i.fields.issuetype.name}] | ${i.fields.status.name} | ${i.fields.summary}`
  ).join('\n') || 'Sin resultados.';
}

async function getJiraIssue(key) {
  const res = await fetch(
    `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${key}?fields=summary,description,status,issuetype,assignee`,
    { headers: { Authorization: JIRA_AUTH, Accept: 'application/json' } }
  );
  if (!res.ok) return `Issue ${key} no encontrado.`;
  const d = await res.json();
  return `${d.key}: ${d.fields.summary}\nEstado: ${d.fields.status?.name} | Tipo: ${d.fields.issuetype?.name}`;
}

async function executeTool(name, input, trace) {
  const span = trace.span({ name: `tool:${name}`, input });
  let result;
  switch (name) {
    case 'search_knowledge_base':
      result = await searchChroma(input.query, input.n_results,
        { source: { '$in': ['Matricula-Contrato', 'PlanifCurso', 'Docente', 'Jira'] } });
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
  span.end({ output: result.slice(0, 300) });
  return result;
}

// ── Agente con prompt configurable ───────────────────────────────────────────
async function runAgentWithVariant(question, systemPrompt, variantName) {
  // Devuelve el objeto trace (no solo el ID) para poder hacer item.link()
  const trace = langfuse.trace({
    name:     'prompt-experiment',
    input:    question,
    metadata: { variant: variantName },
    tags:     [variantName, 'poc6'],
  });

  const messages  = [{ role: 'user', content: question }];
  const toolsUsed = [];
  let   finalAnswer = '';
  let   iteraciones = 0;

  while (iteraciones < 5) {
    iteraciones++;

    const response = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      tools:      TOOLS,
      messages,
    });

    // Registra cada llamada LLM como generation
    const generation = trace.generation({
      name:   `iter-${iteraciones}`,
      model:  'claude-sonnet-4-6',
      input:  messages[messages.length - 1].content,
      output: response.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      usage:  { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
    generation.end();

    if (response.stop_reason === 'end_turn') {
      finalAnswer = response.content.find(b => b.type === 'text')?.text || '';
      trace.update({ output: finalAnswer });
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolCalls = response.content.filter(b => b.type === 'tool_use');
      toolsUsed.push(...toolCalls.map(t => t.name));
      messages.push({ role: 'assistant', content: response.content.filter(b => b.type !== 'thinking') });

      const results = [];
      for (const tool of toolCalls) {
        const result = await executeTool(tool.name, tool.input, trace);
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }
      messages.push({ role: 'user', content: results });
    }
  }

  return { trace, answer: finalAnswer, toolsUsed: [...new Set(toolsUsed)] };
}

// ── Juez LLM (Haiku 4.5) ─────────────────────────────────────────────────────
async function judgeAnswer({ question, answer, toolsUsed }) {
  const judgePrompt = `Eres un evaluador experto de sistemas de IA. Evalúa la siguiente respuesta de un agente.

PREGUNTA DEL USUARIO:
${question}

HERRAMIENTAS USADAS POR EL AGENTE:
${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'Ninguna'}

RESPUESTA DEL AGENTE:
${answer}

Evalúa en estas 4 dimensiones del 1 al 5:
- correctitud (1=incorrecta, 5=completamente correcta)
- uso_herramientas (1=herramientas inadecuadas, 5=herramientas perfectas para la pregunta)
- concision (1=verbosa/confusa, 5=clara y precisa)
- sin_alucinaciones (1=inventa datos, 5=solo usa información del contexto)

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "correctitud": N,
  "uso_herramientas": N,
  "concision": N,
  "sin_alucinaciones": N,
  "comentario": "explicación breve de los scores"
}`;

  const res = await claude.messages.create({
    model:    'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: judgePrompt }],
  });

  const text  = res.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Juez no devolvió JSON válido: ${text}`);
  return JSON.parse(match[0]);
}

async function saveScores(traceId, scores) {
  const dims = ['correctitud', 'uso_herramientas', 'concision', 'sin_alucinaciones'];
  for (const dim of dims) {
    await langfuse.score({ traceId, name: dim, value: scores[dim], comment: scores.comentario });
  }
}

// ── Dataset: crear una vez, reutilizar ────────────────────────────────────────
async function setupDataset() {
  await langfuse.createDataset({
    name:        DATASET_NAME,
    description: 'Dataset de evaluación IACC — 8 preguntas técnicas mixtas (semántica, filtro, cruzada)',
  });

  const existing = await langfuse.getDataset(DATASET_NAME);
  if (existing.items.length === 0) {
    for (const q of QUESTIONS) {
      await langfuse.createDatasetItem({
        datasetName:    DATASET_NAME,
        input:          { question: q.pregunta },
        expectedOutput: { herramientas: q.herramientas_esperadas },
        metadata:       { id: q.id, tipo: q.tipo, tema: q.tema },
      });
    }
    console.log(`✅ Dataset creado con ${QUESTIONS.length} items.`);
  } else {
    console.log(`📋 Dataset ya existe con ${existing.items.length} items. Se reutiliza.`);
  }
}

// ── Corre un experimento (una variante contra todo el dataset) ────────────────
async function runExperiment(variant) {
  console.log(`\n🔬 Variante: ${variant.name}`);
  console.log('─'.repeat(55));

  const dataset = await langfuse.getDataset(DATASET_NAME);
  const results = [];

  for (const item of dataset.items) {
    const question = item.input.question;
    process.stdout.write(`  [${item.metadata.id}] ${question.slice(0, 48).padEnd(48)}...`);

    try {
      const { trace, answer, toolsUsed } = await runAgentWithVariant(
        question, variant.system, variant.name
      );

      // Vincula el trace al run del experimento en Langfuse
      await item.link(trace, variant.name);

      const scores = await judgeAnswer({ question, answer, toolsUsed });
      await saveScores(trace.id, scores);

      const promedio = (
        scores.correctitud + scores.uso_herramientas +
        scores.concision + scores.sin_alucinaciones
      ) / 4;

      results.push({
        id: item.metadata.id,
        tipo: item.metadata.tipo,
        scores,
        promedio: Math.round(promedio * 10) / 10,
        toolsOk: item.metadata.herramientas_esperadas?.every(t => toolsUsed.includes(t)) ?? true,
      });

      process.stdout.write(` ${promedio.toFixed(1)}/5\n`);
    } catch (err) {
      process.stdout.write(` ❌ ${err.message}\n`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  return results;
}

// ── Tabla comparativa final ───────────────────────────────────────────────────
function printComparisonTable(allResults) {
  const DIMS   = ['correctitud', 'uso_herramientas', 'concision', 'sin_alucinaciones'];
  const LABELS = { correctitud: 'Correctitud', uso_herramientas: 'Uso herram.', concision: 'Concisión', sin_alucinaciones: 'Sin aluc.' };
  const names  = Object.keys(allResults);

  const avg = (scores, dim) =>
    (scores.map(s => s.scores[dim]).reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

  console.log('\n' + '═'.repeat(68));
  console.log('📊 COMPARACIÓN DE VARIANTES DE SYSTEM PROMPT');
  console.log('═'.repeat(68));

  // Header
  const header = 'Dimensión'.padEnd(20) + names.map(n => n.padEnd(20)).join('');
  console.log('\n' + header);
  console.log('─'.repeat(68));

  // Una fila por dimensión
  for (const dim of DIMS) {
    const row = LABELS[dim].padEnd(20) + names.map(n => avg(allResults[n], dim).padEnd(20)).join('');
    console.log(row);
  }

  console.log('─'.repeat(68));

  // Promedio global por variante
  const promedios = {};
  const promedioRow = 'PROMEDIO GLOBAL'.padEnd(20) + names.map(n => {
    const p = (allResults[n].reduce((s, r) => s + r.promedio, 0) / allResults[n].length).toFixed(2);
    promedios[n] = +p;
    return p.padEnd(20);
  }).join('');
  console.log(promedioRow);

  // Ganador
  const winner = names.reduce((a, b) => promedios[a] >= promedios[b] ? a : b);
  console.log(`\n🏆 Mejor variante: ${winner} (${promedios[winner]}/5)`);
  console.log(`🔗 Ver en Langfuse: ${process.env.LANGFUSE_BASE_URL} → Datasets → ${DATASET_NAME}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🧪 POC 6 — Prompt Experiments IACC');
  console.log(`   Variantes: ${PROMPT_VARIANTS.map(v => v.name).join(', ')}`);
  console.log(`   Dataset:   ${DATASET_NAME} (${QUESTIONS.length} preguntas)`);
  console.log(`   Modelo:    claude-sonnet-4-6 (agente) + claude-haiku-4-5 (juez)`);
  console.log('─'.repeat(55));

  await setupDataset();

  const allResults = {};
  for (const variant of PROMPT_VARIANTS) {
    allResults[variant.name] = await runExperiment(variant);
  }

  await langfuse.flushAsync();
  printComparisonTable(allResults);
}

main().catch(console.error);
