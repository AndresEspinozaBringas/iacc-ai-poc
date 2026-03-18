/**
 * POC 5 — LLM-as-Judge
 *
 * Flujo por cada pregunta:
 *   1. AGENT    → Corre el agente (poc4) con la pregunta, captura respuesta + herramientas usadas
 *   2. JUDGE    → Claude evalúa la respuesta en 4 dimensiones (1-5)
 *   3. SCORE    → Guarda los scores en Langfuse vinculados al trace del agente
 *   4. REPORT   → Muestra resumen en consola
 *
 * Dimensiones de evaluación:
 *   - correctitud:       ¿La información es factualmente correcta?
 *   - uso_herramientas:  ¿Usó las herramientas adecuadas para la pregunta?
 *   - concision:         ¿La respuesta es clara y sin relleno innecesario?
 *   - sin_alucinaciones: ¿Evita inventar información no presente en el contexto?
 */

import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';

// ── Clientes compartidos ──────────────────────────────────────────────────────
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

// ── Herramientas del agente (igual que poc4) ──────────────────────────────────
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
    body: JSON.stringify({ jql, maxResults: Math.min(maxResults || 20, 50), fields: ['summary', 'status', 'issuetype', 'assignee', 'updated'] }),
  });
  const data = await res.json();
  return (data.issues || []).map(i =>
    `${i.key} [${i.fields.issuetype.name}] | ${i.fields.status.name} | ${i.fields.summary}`
  ).join('\n') || 'Sin resultados.';
}

async function getJiraIssue(key) {
  const res = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/issue/${key}?fields=summary,description,status,issuetype,assignee`,
    { headers: { Authorization: JIRA_AUTH, Accept: 'application/json' } });
  if (!res.ok) return `Issue ${key} no encontrado.`;
  const d = await res.json();
  return `${d.key}: ${d.fields.summary}\nEstado: ${d.fields.status?.name} | Tipo: ${d.fields.issuetype?.name}`;
}

async function executeTool(name, input) {
  switch (name) {
    case 'search_knowledge_base':
      return searchChroma(input.query, input.n_results, { source: { '$in': ['Matricula-Contrato', 'PlanifCurso', 'Docente', 'Jira'] } });
    case 'search_wiki':
      return searchChroma(input.query, input.n_results, { source: { '$eq': 'Wiki' } });
    case 'query_jira':
      return queryJira(input.jql, input.max_results);
    case 'get_jira_issue':
      return getJiraIssue(input.issue_key);
    default:
      return `Herramienta desconocida: ${name}`;
  }
}

// ── STEP 1: Corre el agente y captura resultado ────────────────────────────────
export async function runAgent(question) {
  const trace    = langfuse.trace({ name: 'agent-query', input: question });
  const messages = [{ role: 'user', content: question }];
  const toolsUsed = [];
  let   finalAnswer = '';
  let   iteraciones = 0;

  while (iteraciones < 5) {
    iteraciones++;
    const response = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      thinking:   { type: 'adaptive' },
      system:     'Eres un asistente técnico de IACC. Responde usando las herramientas disponibles. Sé preciso y conciso. Responde en español.',
      tools:      TOOLS,
      messages,
    });

    // Registra la llamada LLM como generation (tokens + costo visibles en Langfuse)
    const generation = trace.generation({
      name:   `agent-iter-${iteraciones}`,
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
        const result = await executeTool(tool.name, tool.input);
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }
      messages.push({ role: 'user', content: results });
    }
  }

  return { traceId: trace.id, answer: finalAnswer, toolsUsed: [...new Set(toolsUsed)] };
}

// ── STEP 2: Claude Juez evalúa la respuesta ───────────────────────────────────
async function judgeAnswer({ question, answer, toolsUsed, traceId }) {
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
    model:      'claude-haiku-4-5', // Haiku para el juez (más económico)
    max_tokens: 512,
    messages:   [{ role: 'user', content: judgePrompt }],
  });

  // Registra el juez como generation vinculada al mismo trace del agente
  const judgeGen = langfuse.generation({
    traceId,
    name:   'judge',
    model:  'claude-haiku-4-5',
    input:  judgePrompt,
    output: res.content[0].text.trim(),
    usage:  { input: res.usage.input_tokens, output: res.usage.output_tokens },
  });
  judgeGen.end();

  const text = res.content[0].text.trim();
  // Extrae el JSON aunque haya texto alrededor
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Juez no devolvió JSON válido: ${text}`);
  return JSON.parse(match[0]);
}

// ── STEP 3: Guarda scores en Langfuse ─────────────────────────────────────────
async function saveScores(traceId, scores) {
  const dims = ['correctitud', 'uso_herramientas', 'concision', 'sin_alucinaciones'];
  for (const dim of dims) {
    await langfuse.score({
      traceId,
      name:    dim,
      value:   scores[dim],
      comment: scores.comentario,
    });
  }
}

// ── Pipeline completo: una pregunta ───────────────────────────────────────────
export async function evaluateQuestion(question, expectedTools = []) {
  process.stdout.write(`\n📝 Pregunta: ${question}\n`);
  process.stdout.write('   🤖 Corriendo agente...');

  const { traceId, answer, toolsUsed } = await runAgent(question);
  process.stdout.write(` ✓ (herramientas: ${toolsUsed.join(', ') || 'ninguna'})\n`);

  process.stdout.write('   ⚖️  Evaluando con juez...');
  const scores = await judgeAnswer({ question, answer, toolsUsed, traceId });
  process.stdout.write(' ✓\n');

  await saveScores(traceId, scores);

  // Validación de herramientas esperadas
  const toolsOk = expectedTools.length === 0 ||
    expectedTools.every(t => toolsUsed.includes(t));

  const promedio = (
    scores.correctitud + scores.uso_herramientas +
    scores.concision + scores.sin_alucinaciones
  ) / 4;

  return {
    pregunta:    question,
    traceId,
    toolsUsed,
    toolsOk,
    scores,
    promedio:    Math.round(promedio * 10) / 10,
  };
}

// ── CLI: evaluar una sola pregunta interactivamente ───────────────────────────
async function main() {
  const question = process.argv[2] || '¿Cuál es la arquitectura del Portal de Pagos?';

  console.log('\n⚖️  IACC LLM-as-Judge');
  console.log('─'.repeat(60));

  const result = await evaluateQuestion(question);

  console.log('\n📊 Scores:');
  console.log(`   Correctitud:       ${'⭐'.repeat(result.scores.correctitud)} ${result.scores.correctitud}/5`);
  console.log(`   Uso herramientas:  ${'⭐'.repeat(result.scores.uso_herramientas)} ${result.scores.uso_herramientas}/5`);
  console.log(`   Concisión:         ${'⭐'.repeat(result.scores.concision)} ${result.scores.concision}/5`);
  console.log(`   Sin alucinaciones: ${'⭐'.repeat(result.scores.sin_alucinaciones)} ${result.scores.sin_alucinaciones}/5`);
  console.log(`\n   Promedio: ${result.promedio}/5`);
  console.log(`   💬 ${result.scores.comentario}`);
  console.log(`\n   🔗 Trace en Langfuse: ${process.env.LANGFUSE_BASE_URL}/trace/${result.traceId}`);

  await langfuse.flushAsync();
}

main().catch(console.error);
