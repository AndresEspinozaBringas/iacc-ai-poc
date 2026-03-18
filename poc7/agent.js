/**
 * POC 7 — Agente con Guardrails y RBAC
 *
 * Extiende el agente del POC 4 con cuatro capas de protección:
 *
 * INPUT:
 *   1. Injection check  → detecta intentos de manipulación (regex, instantáneo)
 *   2. Scope check      → verifica que la pregunta sea de dominio IACC (Haiku)
 *   3. Permission check → valida que el rol pueda usar la herramienta solicitada
 *
 * OUTPUT:
 *   4. Redact           → enmascara datos sensibles según el rol
 *
 * El rol se selecciona al arrancar de forma interactiva (simulando lo que en
 * producción vendría de Azure AD / JWT de Teams).
 *
 * Langfuse traza cada consulta con metadata de rol y acción del guardrail.
 *
 * Uso: npm run agent
 */

import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';
import readline from 'readline';

import { ROLES, getRoleConfig, canUseTool, printPermissionsTable } from './guardrails/permissions.js';
import { checkScope }     from './guardrails/scope.js';
import { checkInjection } from './guardrails/injection.js';
import { redactOutput }   from './guardrails/redact.js';

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

// ── Herramientas disponibles ──────────────────────────────────────────────────
const ALL_TOOLS = [
  {
    name: 'search_knowledge_base',
    description: `Busca en catálogo de APIs e issues Jira usando búsqueda semántica.
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
    description: `Ejecuta JQL contra Jira Cloud de IACC.
Úsala para: filtros exactos por fecha, estado, asignado, conteo de issues.
Proyectos: CA, KAG, PEE, IDE1CN, EV, TOP, DIBC, RMCH`,
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
  {
    name: 'get_student_data',
    description: `Consulta datos personales de un alumno IACC por RUT.
Devuelve: nombre completo, RUT, email, carrera, promedio y estado de matrícula.
Úsala cuando el usuario pida información de un alumno específico.`,
    input_schema: {
      type: 'object',
      properties: {
        rut: { type: 'string', description: 'RUT del alumno (ej: 12345678-9)' },
      },
      required: ['rut'],
    },
  },
];

// ── Implementaciones de herramientas ──────────────────────────────────────────

async function searchChroma(query, nResults = 5, where) {
  const col    = await chroma.getCollection({ name: 'iacc-apis', embeddingFunction: embedder });
  const params = { queryTexts: [query], nResults: Math.min(nResults || 5, 10) };
  if (where) params.where = where;
  const r = await col.query(params);
  return r.documents[0].map((d, i) => `[${r.metadatas[0][i]?.source}]\n${d}`).join('\n\n---\n\n');
}

async function queryJira(jql, maxResults = 20) {
  const res = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/search/jql`, {
    method:  'POST',
    headers: { Authorization: JIRA_AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      jql,
      maxResults: Math.min(maxResults || 20, 50),
      fields: ['summary', 'status', 'issuetype', 'assignee', 'updated'],
    }),
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

// Herramienta simulada con datos ficticios para demostrar RBAC
function getStudentData(rut) {
  const MOCK_STUDENTS = {
    '12345678-9': {
      rut:    '12.345.678-9',
      nombre: 'María González Pérez',
      email:  'mgonzalez@alumno.iacc.cl',
      carrera: 'Ingeniería en Informática',
      promedio: 5.8,
      estado:  'Matriculado',
    },
    '98765432-1': {
      rut:    '98.765.432-1',
      nombre: 'Carlos Rodríguez Muñoz',
      email:  'crodriguez@alumno.iacc.cl',
      carrera: 'Administración de Empresas',
      promedio: 4.9,
      estado:  'Matriculado',
    },
  };

  const student = MOCK_STUDENTS[rut] || MOCK_STUDENTS['12345678-9'];
  return JSON.stringify(student, null, 2);
}

// ── Ejecutor de herramientas con control de permisos ──────────────────────────
async function executeTool(name, input, rol, trace) {
  const span = trace.span({ name: `tool:${name}`, input });

  // Guardrail 3: verificar permiso antes de ejecutar
  if (!canUseTool(rol, name)) {
    const msg = `🚫 Acceso denegado: el rol "${ROLES[rol]?.label}" no tiene permiso para usar "${name}".`;
    span.end({ output: msg, metadata: { guardrail: 'permission_denied', rol } });

    await langfuse.score({
      traceId: trace.id,
      name:    'guardrail_triggered',
      value:   1,
      comment: `permission_denied — rol: ${rol} intentó usar: ${name}`,
    });

    return msg;
  }

  let result;
  try {
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
      case 'get_student_data':
        result = getStudentData(input.rut);
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

// ── System prompt con contexto de rol ────────────────────────────────────────
function buildSystemPrompt(roleConfig) {
  const toolsLine = roleConfig.tools.includes('get_student_data')
    ? '- get_student_data → datos personales de alumnos (RUT, email, carrera, promedio)'
    : '';

  return `Eres un asistente técnico de IACC. Estructura SIEMPRE tu respuesta con este formato:

**Respuesta:**
[Información directa en 2-4 oraciones concisas]

**Fuentes consultadas:**
[Lista las herramientas que usaste y qué aportó cada una]

Herramientas disponibles para tu rol:
- search_knowledge_base → APIs y endpoints (búsqueda semántica)
- search_wiki → arquitectura, flujos, reglas de negocio, documentación técnica
- query_jira → filtros JQL exactos: fechas, estados, proyectos, asignados
- get_jira_issue → detalle completo de un issue específico (ej: EV-1316)
${toolsLine}

Usa herramientas antes de responder. Si necesitas múltiples fuentes, combínalas.
Responde en español con precisión técnica.
Si no tienes acceso a una herramienta necesaria para responder, indícalo claramente.`;
}

// ── Guardrails de input ───────────────────────────────────────────────────────
async function runInputGuardrails(question, rol, trace) {
  // 1. Injection
  const injCheck = checkInjection(question);
  if (injCheck.isInjection) {
    await langfuse.score({
      traceId: trace.id,
      name:    'guardrail_triggered',
      value:   1,
      comment: `prompt_injection detectado — patrón: ${injCheck.pattern}`,
    });
    trace.update({ metadata: { guardrail: 'injection_blocked', rol } });
    return { blocked: true, reason: '⚠️  Consulta bloqueada: se detectó un intento de manipulación del sistema.' };
  }

  // 2. Scope
  process.stdout.write('🔍 Verificando scope...');
  const scopeCheck = await checkScope(question);
  process.stdout.write('\r                        \r');

  if (!scopeCheck.inScope) {
    await langfuse.score({
      traceId: trace.id,
      name:    'guardrail_triggered',
      value:   1,
      comment: `out_of_scope — razón: ${scopeCheck.reason}`,
    });
    trace.update({ metadata: { guardrail: 'scope_blocked', rol } });
    return {
      blocked: true,
      reason:  `⚠️  Consulta fuera de dominio: solo puedo responder preguntas relacionadas con los sistemas y proyectos de IACC.\n   (${scopeCheck.reason})`,
    };
  }

  return { blocked: false };
}

// ── Agentic loop principal ────────────────────────────────────────────────────
async function runAgent(question, rol, roleConfig, systemPrompt) {
  const trace = langfuse.trace({
    name:     'agent-query-rbac',
    input:    question,
    metadata: { rol, label: roleConfig.label },
    tags:     [rol, 'poc7'],
  });

  // Guardrails de input
  const guard = await runInputGuardrails(question, rol, trace);
  if (guard.blocked) {
    console.log(`\n${guard.reason}\n`);
    trace.update({ output: guard.reason });
    await langfuse.flushAsync();
    return;
  }

  const messages = [{ role: 'user', content: question }];
  // Solo exponer las herramientas que el rol puede usar
  const allowedTools = ALL_TOOLS.filter(t => canUseTool(rol, t.name));

  console.log('\n🤖 Agente pensando...\n');

  let iteraciones = 0;
  let finalText   = '';

  while (iteraciones < 5) {
    iteraciones++;

    const stream = claude.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      thinking:   { type: 'adaptive' },
      system:     systemPrompt,
      tools:      allowedTools,
      messages,
    });

    stream.on('text', (delta) => {
      process.stdout.write(delta);
      finalText += delta;
    });

    const response = await stream.finalMessage();

    trace.generation({
      name:   `iter-${iteraciones}`,
      model:  'claude-sonnet-4-6',
      input:  messages[messages.length - 1].content,
      output: response.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      usage:  { input: response.usage.input_tokens, output: response.usage.output_tokens },
    }).end();

    if (response.stop_reason === 'end_turn') {
      // Guardrail de output: redactar datos sensibles
      const { text: safeText, redacted, count } = redactOutput(finalText, roleConfig);

      if (redacted) {
        // Reescribe en consola con datos redactados
        process.stdout.write(`\n\n⚠️  ${count} dato(s) sensible(s) redactado(s) para el rol "${roleConfig.label}".\n`);
        await langfuse.score({
          traceId: trace.id,
          name:    'guardrail_triggered',
          value:   1,
          comment: `output_redacted — ${count} dato(s) enmascarado(s) para rol: ${rol}`,
        });
      }

      trace.update({ output: safeText, metadata: { rol, guardrail: redacted ? 'output_redacted' : 'none' } });
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const contentForHistory = response.content.filter(b => b.type !== 'thinking');
      messages.push({ role: 'assistant', content: contentForHistory });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      console.log(`\n\n🔧 Usando: ${toolUseBlocks.map(t => t.name).join(', ')}\n`);

      const toolResults = [];
      for (const tool of toolUseBlocks) {
        const result = await executeTool(tool.name, tool.input, rol, trace);
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
      finalText = '';
    }
  }

  await langfuse.flushAsync();
  console.log('\n' + '─'.repeat(60));
}

// ── Selección de rol interactiva ──────────────────────────────────────────────
async function selectRole(rl) {
  const roleKeys = Object.keys(ROLES);

  return new Promise((resolve) => {
    console.log('\n👤 Selecciona tu rol:');
    roleKeys.forEach((key, i) => {
      console.log(`   ${i + 1}. ${ROLES[key].label} (${key})`);
    });
    console.log('');

    rl.question('> ', (answer) => {
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < roleKeys.length) {
        resolve(roleKeys[idx]);
      } else {
        console.log('   Opción no válida. Usando "desarrollador-fullstack" por defecto.');
        resolve('desarrollador-fullstack');
      }
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🛡️  IACC Agent — POC 7: Guardrails + RBAC');
  console.log('═'.repeat(50));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Selección de rol
  const rol        = await selectRole(rl);
  const roleConfig = getRoleConfig(rol);

  printPermissionsTable(rol);
  console.log('\n   Guardrails activos:');
  console.log('   🔒 Prompt injection  — regex instantáneo');
  console.log('   🔒 Scope checker     — clasificador Haiku');
  console.log('   🔒 RBAC por tool     — verificación por herramienta');
  console.log('   🔒 Output redaction  — enmascarado de datos sensibles');
  console.log('\n   "salir" para terminar.\n');
  console.log('─'.repeat(50));

  const systemPrompt = buildSystemPrompt(roleConfig);

  const ask = () => {
    rl.question('\n> ', async (question) => {
      if (!question.trim() || question.toLowerCase() === 'salir') {
        console.log('\nHasta luego 👋');
        rl.close();
        return;
      }
      await runAgent(question, rol, roleConfig, systemPrompt);
      ask();
    });
  };

  ask();
}

main().catch(console.error);
