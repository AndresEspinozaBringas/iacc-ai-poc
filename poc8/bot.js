/**
 * POC 8 — IACC Teams Bot
 *
 * Flujo de conversación:
 *   1. Usuario escribe por primera vez → bot pregunta el rol
 *   2. Usuario selecciona rol (1-4) → se guarda en ConversationState
 *   3. Mensajes siguientes → guardrails + agente Claude → respuesta
 *
 * Guardrails heredados de POC 7:
 *   - Prompt injection (regex)
 *   - Scope check (Haiku)
 *   - RBAC por herramienta
 *   - Output redaction
 *
 * Diferencia vs CLI: sin streaming (Teams no lo soporta).
 * El agente corre completo y envía la respuesta final.
 */

import { ActivityHandler, MessageFactory } from 'botbuilder';
import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';

import { ROLES, getRoleConfig, canUseTool } from '../poc7/guardrails/permissions.js';
import { checkScope }     from '../poc7/guardrails/scope.js';
import { checkInjection } from '../poc7/guardrails/injection.js';
import { redactOutput }   from '../poc7/guardrails/redact.js';

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

const ROLE_KEYS = Object.keys(ROLES);

// ── Lista blanca de usuarios autorizados (configurada en .env) ────────────────
const ALLOWED_USERS = (process.env.BOT_ALLOWED_USERS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// ── Mensaje de bienvenida con selección de rol ────────────────────────────────
function buildWelcomeMessage() {
  const opciones = ROLE_KEYS.map((key, i) => `**${i + 1}.** ${ROLES[key].label}`).join('\n');
  return `👋 Hola, soy el **Asistente Técnico de IACC**.

Puedo ayudarte con consultas sobre APIs, issues Jira, arquitectura y documentación técnica.

Antes de comenzar, selecciona tu rol escribiendo el número:

${opciones}`;
}

// ── System prompt con herramientas disponibles según rol ──────────────────────
function buildSystemPrompt(roleConfig) {
  const hasStudentData = roleConfig.tools.includes('get_student_data');
  return `Eres un asistente técnico de IACC respondiendo desde Microsoft Teams. Estructura SIEMPRE tu respuesta así:

**Respuesta:**
[Información directa en 2-4 oraciones concisas]

**Fuentes consultadas:**
[Lista las herramientas usadas y qué aportó cada una]

Herramientas disponibles:
- search_knowledge_base → APIs y endpoints (búsqueda semántica)
- search_wiki → arquitectura, flujos, reglas de negocio, documentación técnica
- query_jira → filtros JQL exactos: fechas, estados, proyectos, asignados
- get_jira_issue → detalle completo de un issue específico (ej: EV-1316)
${hasStudentData ? '- get_student_data → datos personales de alumnos (RUT, email, carrera, promedio)' : ''}

Usa herramientas antes de responder. Combina fuentes si es necesario.
Responde en español con precisión técnica. Formato Markdown compatible con Teams.`;
}

// ── Herramientas ──────────────────────────────────────────────────────────────
const ALL_TOOLS = [
  {
    name: 'search_knowledge_base',
    description: 'Busca en catálogo de APIs e issues Jira usando búsqueda semántica.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, n_results: { type: 'integer' } }, required: ['query'] },
  },
  {
    name: 'search_wiki',
    description: 'Busca en la Wiki técnica de IACC (arquitectura, flujos, reglas de negocio).',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, n_results: { type: 'integer' } }, required: ['query'] },
  },
  {
    name: 'query_jira',
    description: 'Ejecuta JQL contra Jira Cloud. Proyectos: CA, KAG, PEE, IDE1CN, EV, TOP, DIBC, RMCH.',
    input_schema: { type: 'object', properties: { jql: { type: 'string' }, max_results: { type: 'integer' } }, required: ['jql'] },
  },
  {
    name: 'get_jira_issue',
    description: 'Obtiene detalle completo de un issue Jira por su key (ej: EV-1316).',
    input_schema: { type: 'object', properties: { issue_key: { type: 'string' } }, required: ['issue_key'] },
  },
  {
    name: 'get_student_data',
    description: 'Consulta datos personales de un alumno IACC por RUT.',
    input_schema: { type: 'object', properties: { rut: { type: 'string' } }, required: ['rut'] },
  },
];

// ── Implementaciones ──────────────────────────────────────────────────────────
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
    body:    JSON.stringify({ jql, maxResults: Math.min(maxResults || 20, 50), fields: ['summary', 'status', 'issuetype', 'assignee', 'updated'] }),
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

function getStudentData(rut) {
  const MOCK = {
    '12345678-9': { rut: '12.345.678-9', nombre: 'María González Pérez', email: 'mgonzalez@alumno.iacc.cl', carrera: 'Ingeniería en Informática', promedio: 5.8, estado: 'Matriculado' },
    '98765432-1': { rut: '98.765.432-1', nombre: 'Carlos Rodríguez Muñoz', email: 'crodriguez@alumno.iacc.cl', carrera: 'Administración de Empresas', promedio: 4.9, estado: 'Matriculado' },
  };
  return JSON.stringify(MOCK[rut] || MOCK['12345678-9'], null, 2);
}

async function executeTool(name, input, rol, trace) {
  const span = trace.span({ name: `tool:${name}`, input });

  if (!canUseTool(rol, name)) {
    const msg = `Acceso denegado: el rol "${ROLES[rol]?.label}" no tiene permiso para usar "${name}".`;
    span.end({ output: msg });
    await langfuse.score({ traceId: trace.id, name: 'guardrail_triggered', value: 1, comment: `permission_denied — ${rol} → ${name}` });
    return msg;
  }

  let result;
  switch (name) {
    case 'search_knowledge_base':
      result = await searchChroma(input.query, input.n_results, { source: { '$in': ['Matricula-Contrato', 'PlanifCurso', 'Docente', 'Jira'] } }); break;
    case 'search_wiki':
      result = await searchChroma(input.query, input.n_results, { source: { '$eq': 'Wiki' } }); break;
    case 'query_jira':
      result = await queryJira(input.jql, input.max_results); break;
    case 'get_jira_issue':
      result = await getJiraIssue(input.issue_key); break;
    case 'get_student_data':
      result = getStudentData(input.rut); break;
    default:
      result = `Herramienta desconocida: ${name}`;
  }

  span.end({ output: result.slice(0, 300) });
  return result;
}

// ── Agente (sin streaming — Teams no lo soporta) ──────────────────────────────
async function runAgent(question, rol, roleConfig, trace) {
  const systemPrompt  = buildSystemPrompt(roleConfig);
  const allowedTools  = ALL_TOOLS.filter(t => canUseTool(rol, t.name));
  const messages      = [{ role: 'user', content: question }];
  let   finalAnswer   = '';
  let   iteraciones   = 0;

  while (iteraciones < 5) {
    iteraciones++;

    const response = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     systemPrompt,
      tools:      allowedTools,
      messages,
    });

    trace.generation({
      name:  `iter-${iteraciones}`,
      model: 'claude-sonnet-4-6',
      input: messages[messages.length - 1].content,
      output: response.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    }).end();

    if (response.stop_reason === 'end_turn') {
      finalAnswer = response.content.find(b => b.type === 'text')?.text || '';
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const tool of response.content.filter(b => b.type === 'tool_use')) {
        const result = await executeTool(tool.name, tool.input, rol, trace);
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }
      messages.push({ role: 'user', content: results });
    }
  }

  // Guardrail de output
  const { text: safeText, redacted, count } = redactOutput(finalAnswer, roleConfig);
  if (redacted) {
    await langfuse.score({ traceId: trace.id, name: 'guardrail_triggered', value: 1, comment: `output_redacted — ${count} dato(s)` });
    return safeText + `\n\n_⚠️ ${count} dato(s) sensible(s) redactado(s) para tu rol._`;
  }

  return safeText;
}

// ── Bot principal ─────────────────────────────────────────────────────────────
export class IACCBot extends ActivityHandler {
  constructor(conversationState) {
    super();
    this.conversationState = conversationState;
    this.rolProp = conversationState.createProperty('rol');

    // Mensaje de bienvenida al unirse al canal
    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(MessageFactory.text(buildWelcomeMessage()));
        }
      }
      await next();
    });

    // Procesamiento de mensajes
    this.onMessage(async (context, next) => {
      const text      = context.activity.text?.trim() || '';
      const userEmail = (context.activity.from?.email || '').toLowerCase();
      const userId    = (context.activity.from?.aadObjectId || context.activity.from?.id || '').toLowerCase();

      // Verificar lista blanca antes de cualquier procesamiento
      const isAllowed = ALLOWED_USERS.length === 0 ||
        ALLOWED_USERS.some(allowed => userEmail.includes(allowed) || allowed.includes(userId));

      if (!isAllowed) {
        await context.sendActivity(MessageFactory.text(
          '⛔ No tienes acceso a este bot en esta etapa del proyecto.\n\nContacta al equipo de desarrollo de IACC si crees que deberías tener acceso.'
        ));
        console.log(`[Acceso denegado] usuario: ${userEmail || userId}`);
        await next();
        return;
      }

      let rol = await this.rolProp.get(context, null);

      // Si no tiene rol asignado → interpretar como selección
      if (!rol) {
        const idx = parseInt(text) - 1;
        if (idx >= 0 && idx < ROLE_KEYS.length) {
          rol = ROLE_KEYS[idx];
          await this.rolProp.set(context, rol);
          await this.conversationState.saveChanges(context);

          const config = getRoleConfig(rol);
          const permStr = [
            config.canSeeStudentData    ? '✅ Datos de alumnos' : '❌ Datos de alumnos',
            config.canSeeAdminEndpoints ? '✅ Endpoints admin'  : '❌ Endpoints admin',
            config.canSeeMetrics        ? '✅ Métricas/costos'  : '❌ Métricas/costos',
          ].join(' | ');

          await context.sendActivity(MessageFactory.text(
            `✅ Rol asignado: **${config.label}**\n\n${permStr}\n\n¿En qué puedo ayudarte?`
          ));
        } else {
          await context.sendActivity(MessageFactory.text(
            `Por favor escribe un número del 1 al ${ROLE_KEYS.length} para seleccionar tu rol.\n\n${buildWelcomeMessage()}`
          ));
        }
        await next();
        return;
      }

      // Comando para cambiar rol
      if (text.toLowerCase() === 'cambiar rol') {
        await this.rolProp.set(context, null);
        await this.conversationState.saveChanges(context);
        await context.sendActivity(MessageFactory.text(buildWelcomeMessage()));
        await next();
        return;
      }

      const roleConfig = getRoleConfig(rol);
      const userName   = context.activity.from?.name || 'Usuario';

      // Indicador de escritura mientras procesa
      await context.sendActivity({ type: 'typing' });

      const trace = langfuse.trace({
        name:     'teams-agent-query',
        input:    text,
        metadata: { rol, label: roleConfig.label, userName, channel: 'teams' },
        tags:     [rol, 'poc8', 'teams'],
      });

      // Guardrail 1: injection
      const injCheck = checkInjection(text);
      if (injCheck.isInjection) {
        await langfuse.score({ traceId: trace.id, name: 'guardrail_triggered', value: 1, comment: 'prompt_injection' });
        trace.update({ output: 'BLOQUEADO: prompt injection' });
        await context.sendActivity(MessageFactory.text('⚠️ Consulta bloqueada: se detectó un intento de manipulación del sistema.'));
        await langfuse.flushAsync();
        await next();
        return;
      }

      // Guardrail 2: scope
      const scopeCheck = await checkScope(text);
      if (!scopeCheck.inScope) {
        await langfuse.score({ traceId: trace.id, name: 'guardrail_triggered', value: 1, comment: `out_of_scope: ${scopeCheck.reason}` });
        const msg = `⚠️ Consulta fuera de dominio: solo puedo responder preguntas relacionadas con los sistemas y proyectos de IACC.\n\n_${scopeCheck.reason}_`;
        trace.update({ output: msg });
        await context.sendActivity(MessageFactory.text(msg));
        await langfuse.flushAsync();
        await next();
        return;
      }

      // Ejecutar agente
      try {
        const answer = await runAgent(text, rol, roleConfig, trace);
        trace.update({ output: answer });
        await context.sendActivity(MessageFactory.text(answer));
      } catch (err) {
        console.error('[AgentError]', err);
        await context.sendActivity(MessageFactory.text('❌ Error al procesar tu consulta. Por favor intenta nuevamente.'));
      }

      await langfuse.flushAsync();
      await next();
    });
  }

  async run(context) {
    await super.run(context);
    await this.conversationState.saveChanges(context);
  }
}
