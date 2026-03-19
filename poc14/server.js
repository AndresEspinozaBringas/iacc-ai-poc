/**
 * POC 14 — MCP Server IACC para Kiro IDE
 *
 * Expone herramientas de contexto IACC directamente en el IDE:
 *   - search_technical_docs  → búsqueda semántica en ChromaDB (APIs + Wiki + Jira)
 *   - get_api_contracts      → contratos de endpoints por módulo o ruta
 *   - get_related_stories    → issues Jira relacionados con el código actual
 *   - get_coding_standards   → estándares y convenciones del equipo IACC
 *   - get_jira_issue         → detalle completo de un issue por key (CA-248, PEE-12…)
 *   - query_jira             → búsqueda JQL directa (estado, asignado, fechas, sprint)
 *
 * Transporte: stdio (estándar para MCP servers locales en Kiro)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ── Cargar .env desde la raíz del proyecto (compatible Windows/Mac/Linux) ─────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

// ── Clientes ──────────────────────────────────────────────────────────────────
const chroma = new ChromaClient({
  path: process.env.CHROMADB_URL ?? 'http://localhost:8000',
});
const embedder = new DefaultEmbeddingFunction();

const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? '';
const JIRA_AUTH = JIRA_BASE_URL
  ? 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')
  : null;

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'iacc-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ── Definición de herramientas ────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_technical_docs',
      description: `Busca documentación técnica de IACC usando búsqueda semántica.
Cubre: catálogos de APIs (endpoints, parámetros, autenticación), issues Jira y páginas Wiki.js.
Úsala cuando necesites entender:
- Cómo funciona un endpoint o qué parámetros acepta
- Contexto de un módulo o funcionalidad
- Qué hace o hizo el equipo en un área específica
- Arquitectura y decisiones técnicas documentadas en Wiki`,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Consulta en lenguaje natural (ej: "autenticación SSO", "endpoint de matrícula")',
          },
          filter: {
            type: 'string',
            enum: ['all', 'apis', 'jira', 'wiki', 'sharepoint'],
            description: 'Filtrar por fuente (default: all)',
          },
          n_results: {
            type: 'integer',
            description: 'Número de resultados (default: 6, max: 15)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_api_contracts',
      description: `Obtiene contratos de API (endpoints) de un módulo o ruta específica de IACC.
Devuelve: método HTTP, ruta, descripción, parámetros, respuesta esperada y notas de autenticación.
Úsala cuando estés implementando una integración y necesites el contrato exacto del endpoint.`,
      inputSchema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Módulo o área del sistema (ej: "matrícula", "notas", "alumnos", "autenticación")',
          },
          path_filter: {
            type: 'string',
            description: 'Fragmento de la ruta del endpoint (ej: "/api/students", "/auth/login")',
          },
          n_results: {
            type: 'integer',
            description: 'Número de endpoints a retornar (default: 8)',
          },
        },
        required: ['module'],
      },
    },
    {
      name: 'get_related_stories',
      description: `Encuentra issues de Jira relacionados con el código que estás escribiendo.
Busca por contexto semántico: nombre de archivo, función, módulo o descripción de lo que implementas.
Devuelve: key del issue, resumen, estado, prioridad y enlace directo.
Úsala para entender el contexto de negocio detrás del código o vincular tu trabajo a HUs existentes.`,
      inputSchema: {
        type: 'object',
        properties: {
          context: {
            type: 'string',
            description: 'Descripción de lo que estás implementando (ej: "modal de pago con tarjeta crédito")',
          },
          project_keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Proyectos Jira a buscar (ej: ["CA", "PEE"]). Si se omite, busca en todos.',
          },
          n_results: {
            type: 'integer',
            description: 'Número de issues a retornar (default: 5)',
          },
        },
        required: ['context'],
      },
    },
    {
      name: 'get_coding_standards',
      description: `Obtiene los estándares y convenciones de desarrollo del equipo IACC.
Cubre: convenciones de nomenclatura, estructura de proyectos, patrones de diseño preferidos,
reglas de linting, estándares de API REST, convenciones de commits y pull requests.
Úsala antes de crear nuevos archivos, módulos o APIs para seguir las convenciones del equipo.`,
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'Área específica (ej: "naming conventions", "API design", "commits", "testing"). Si se omite, retorna estándares generales.',
          },
        },
      },
    },
    {
      name: 'get_jira_issue',
      description: `Obtiene el detalle completo de un issue de Jira por su key (ej: CA-248, PEE-12, KAG-5).
Devuelve: resumen, descripción, estado, prioridad, asignado, reporter, sprint, fechas y comentarios recientes.
Úsala cuando tengas el key exacto del ticket y necesites entender qué hace, qué pide o cuál es su contexto.`,
      inputSchema: {
        type: 'object',
        properties: {
          issue_key: {
            type: 'string',
            description: 'Key del issue en formato PROYECTO-NÚMERO (ej: CA-248, PEE-12)',
          },
        },
        required: ['issue_key'],
      },
    },
    {
      name: 'query_jira',
      description: `Ejecuta una búsqueda en Jira usando JQL o lenguaje natural.
Úsala para: ver issues por estado, sprint activo, asignado, fechas, tipo o proyecto.
Ejemplos: "bugs abiertos en CA", "tareas asignadas a andres.espinoza", "issues creados esta semana en PEE".
A diferencia de search_technical_docs (semántica), esta herramienta filtra por atributos exactos.`,
      inputSchema: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'Query JQL (ej: \'project = CA AND status = "In Progress"\') o descripción en español',
          },
          max_results: {
            type: 'integer',
            description: 'Máximo de issues a retornar (default: 10, max: 50)',
          },
        },
        required: ['jql'],
      },
    },
  ],
}));

// ── Implementación de herramientas ────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_technical_docs':
        return await searchTechnicalDocs(args);
      case 'get_api_contracts':
        return await getApiContracts(args);
      case 'get_related_stories':
        return await getRelatedStories(args);
      case 'get_coding_standards':
        return await getCodingStandards(args);
      case 'get_jira_issue':
        return await getJiraIssue(args);
      case 'query_jira':
        return await queryJira(args);
      default:
        throw new Error(`Herramienta desconocida: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `❌ Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── search_technical_docs ─────────────────────────────────────────────────────
async function searchTechnicalDocs({ query, filter = 'all', n_results = 6 }) {
  const collection = await chroma.getOrCreateCollection({
    name: 'iacc-apis',
    embeddingFunction: embedder,
  });

  const queryParams = {
    queryTexts: [query],
    nResults: Math.min(n_results, 15),
  };

  // Aplicar filtro por fuente
  if (filter !== 'all') {
    const sourceMap = { apis: 'excel', jira: 'jira', wiki: 'wiki', sharepoint: 'sharepoint' };
    queryParams.where = { source: sourceMap[filter] };
  }

  const results = await collection.query(queryParams);

  if (!results.documents?.[0]?.length) {
    return {
      content: [{ type: 'text', text: 'No se encontraron resultados para la consulta.' }],
    };
  }

  const docs = results.documents[0];
  const metas = results.metadatas[0];
  const distances = results.distances[0];

  const formatted = docs.map((doc, i) => {
    const meta = metas[i] ?? {};
    const relevance = distances ? (1 - distances[i]).toFixed(2) : 'N/A';
    const source = meta.source ?? 'desconocido';
    const title = meta.title ?? meta.key ?? meta.endpoint ?? 'Sin título';
    return `### [${source.toUpperCase()}] ${title} (relevancia: ${relevance})\n${doc.substring(0, 500)}`;
  }).join('\n\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `# Resultados para: "${query}"\n\n${formatted}`,
    }],
  };
}

// ── get_api_contracts ─────────────────────────────────────────────────────────
async function getApiContracts({ module, path_filter, n_results = 8 }) {
  const collection = await chroma.getOrCreateCollection({
    name: 'iacc-apis',
    embeddingFunction: embedder,
  });

  const queryText = path_filter
    ? `endpoint API ${module} ruta ${path_filter}`
    : `API endpoints del módulo ${module}`;

  const results = await collection.query({
    queryTexts: [queryText],
    nResults: Math.min(n_results, 15),
    where: { source: 'excel' },
  });

  if (!results.documents?.[0]?.length) {
    return {
      content: [{
        type: 'text',
        text: `No se encontraron endpoints para el módulo "${module}"${path_filter ? ` con ruta "${path_filter}"` : ''}.`,
      }],
    };
  }

  const docs = results.documents[0];
  const metas = results.metadatas[0];

  const formatted = docs.map((doc, i) => {
    const meta = metas[i] ?? {};
    const method = meta.method ?? '';
    const endpoint = meta.endpoint ?? '';
    const header = [method, endpoint].filter(Boolean).join(' ') || 'Endpoint';
    return `### ${header}\n${doc.substring(0, 600)}`;
  }).join('\n\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `# Contratos API — Módulo: ${module}\n\n${formatted}`,
    }],
  };
}

// ── get_related_stories ───────────────────────────────────────────────────────
async function getRelatedStories({ context, project_keys, n_results = 5 }) {
  // Primero buscar en ChromaDB (datos indexados de Jira)
  const collection = await chroma.getOrCreateCollection({
    name: 'iacc-apis',
    embeddingFunction: embedder,
  });

  const whereClause = project_keys?.length
    ? { $and: [{ source: 'jira' }, { project: { $in: project_keys } }] }
    : { source: 'jira' };

  const results = await collection.query({
    queryTexts: [context],
    nResults: Math.min(n_results, 10),
    where: whereClause,
  });

  if (!results.documents?.[0]?.length) {
    // Fallback: buscar en todos los resultados sin filtro de proyecto
    const fallbackResults = await collection.query({
      queryTexts: [context],
      nResults: Math.min(n_results, 10),
      where: { source: 'jira' },
    });

    if (!fallbackResults.documents?.[0]?.length) {
      return {
        content: [{ type: 'text', text: `No se encontraron issues Jira relacionados con: "${context}"` }],
      };
    }

    results.documents = fallbackResults.documents;
    results.metadatas = fallbackResults.metadatas;
  }

  const docs = results.documents[0];
  const metas = results.metadatas[0];

  const formatted = docs.map((doc, i) => {
    const meta = metas[i] ?? {};
    const key = meta.key ?? '???';
    const jiraUrl = JIRA_BASE_URL ? `${JIRA_BASE_URL}/browse/${key}` : null;
    const status = meta.status ?? '';
    const priority = meta.priority ?? '';
    const link = jiraUrl ? `[${key}](${jiraUrl})` : key;
    const badge = [status, priority].filter(Boolean).join(' · ');
    return `### ${link}${badge ? ` — ${badge}` : ''}\n${doc.substring(0, 400)}`;
  }).join('\n\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `# Issues relacionados con: "${context}"\n\n${formatted}`,
    }],
  };
}

// ── get_coding_standards ──────────────────────────────────────────────────────
async function getCodingStandards({ topic } = {}) {
  // Primero intentar buscar en ChromaDB (si hay estándares indexados en Wiki)
  try {
    const collection = await chroma.getOrCreateCollection({
      name: 'iacc-apis',
      embeddingFunction: embedder,
    });

    const query = topic
      ? `estándares convenciones ${topic} IACC`
      : 'estándares convenciones desarrollo equipo IACC';

    const results = await collection.query({
      queryTexts: [query],
      nResults: 4,
      where: { source: 'wiki' },
    });

    if (results.documents?.[0]?.length) {
      const docs = results.documents[0];
      const metas = results.metadatas[0];
      const fromWiki = docs.map((doc, i) => {
        const title = metas[i]?.title ?? 'Sin título';
        return `### ${title}\n${doc.substring(0, 600)}`;
      }).join('\n\n---\n\n');

      return {
        content: [{
          type: 'text',
          text: `# Estándares IACC${topic ? ` — ${topic}` : ''}\n\n*Fuente: Wiki IACC*\n\n${fromWiki}\n\n---\n\n${getStaticStandards(topic)}`,
        }],
      };
    }
  } catch {
    // Si ChromaDB no está disponible, usar estándares estáticos
  }

  return {
    content: [{
      type: 'text',
      text: getStaticStandards(topic),
    }],
  };
}

function getStaticStandards(topic) {
  const standards = {
    default: `# Estándares de Desarrollo — Equipo IACC

## Stack base
- **Frontend**: React / Next.js (TypeScript)
- **Backend**: Node.js + Express o Lambda (TypeScript)
- **Base de datos**: PostgreSQL en RDS (AWS)
- **Infraestructura**: AWS (EC2, Lambda, RDS, S3)
- **CI/CD**: GitHub Actions
- **Automatización**: N8N self-hosted

## Nomenclatura
- **Variables/funciones**: camelCase
- **Clases**: PascalCase
- **Constantes**: UPPER_SNAKE_CASE
- **Archivos**: kebab-case (ej: \`student-service.ts\`)
- **Tablas DB**: snake_case plural (ej: \`student_enrollments\`)

## Estructura de proyecto Node.js/Express
\`\`\`
src/
  controllers/    ← manejo de HTTP request/response
  services/       ← lógica de negocio
  repositories/   ← acceso a datos
  middlewares/    ← autenticación, validación, logging
  models/         ← tipos e interfaces TypeScript
  routes/         ← definición de rutas
  utils/          ← helpers sin estado
\`\`\`

## APIs REST
- Versionar en URL: \`/api/v1/resource\`
- Usar sustantivos en plural: \`/api/v1/students\`
- Respuesta estándar:
\`\`\`json
{ "data": {...}, "error": null, "meta": { "timestamp": "..." } }
\`\`\`
- Autenticación: Bearer token en header \`Authorization\`
- Errores: usar códigos HTTP correctos (400, 401, 403, 404, 422, 500)

## Commits
- Formato: \`type(scope): descripción en español\`
- Types: feat, fix, docs, refactor, test, chore
- Ejemplo: \`feat(matrícula): agregar validación RUT duplicado\`

## Pull Requests
- Branch: \`feature/nombre-descriptivo\` o \`fix/descripcion-del-bug\`
- PR siempre hacia \`develop\` (nunca directo a \`main\`)
- Requiere al menos 1 revisión antes de merge
- Incluir descripción del cambio y cómo probar`,

    naming: `# Convenciones de Nomenclatura — IACC

## JavaScript/TypeScript
- Variables y funciones: **camelCase** → \`getStudentById\`, \`isEnrolled\`
- Clases e interfaces: **PascalCase** → \`StudentService\`, \`EnrollmentDTO\`
- Constantes: **UPPER_SNAKE_CASE** → \`MAX_RETRY_ATTEMPTS\`, \`API_BASE_URL\`
- Archivos: **kebab-case** → \`student-service.ts\`, \`auth-middleware.ts\`
- Tests: mismo nombre + \`.test.ts\` → \`student-service.test.ts\`

## Base de Datos
- Tablas: **snake_case plural** → \`students\`, \`course_enrollments\`
- Columnas: **snake_case** → \`first_name\`, \`created_at\`
- PKs: \`id\` (UUID o serial según el caso)
- FKs: \`tabla_id\` → \`student_id\`, \`course_id\`
- Índices: \`idx_tabla_columna\` → \`idx_students_rut\``,

    commits: `# Convenciones de Commits — IACC

## Formato
\`type(scope): descripción breve en español\`

## Types
| Type | Cuándo usar |
|------|-------------|
| \`feat\` | Nueva funcionalidad |
| \`fix\` | Corrección de bug |
| \`docs\` | Solo documentación |
| \`refactor\` | Refactoring sin cambio de comportamiento |
| \`test\` | Agregar o corregir tests |
| \`chore\` | Build, deps, CI/CD |
| \`perf\` | Mejora de rendimiento |

## Ejemplos
\`\`\`
feat(matrícula): agregar validación de RUT duplicado en pre-inscripción
fix(auth): corregir expiración de token SSO al cambiar contraseña
docs(api): actualizar Swagger con nuevos endpoints de notas
refactor(students): extraer lógica de cálculo de promedio a servicio separado
\`\`\``,

    testing: `# Estándares de Testing — IACC

## Framework
- **Unit tests**: Jest + ts-jest
- **Integration tests**: Supertest + Jest (con DB real, no mocks)
- **E2E**: Playwright (pendiente adopción)

## Estructura
\`\`\`
src/
  __tests__/
    unit/         ← tests de funciones puras
    integration/  ← tests de endpoints completos
\`\`\`

## Convenciones
- Test debe ser independiente: no depender del orden de ejecución
- Un test = una assertion principal
- Usar \`describe\` para agrupar por función/módulo
- Naming: \`it('should return 404 when student not found')\`
- Cobertura mínima: 70% en servicios y controllers

## No mockear la base de datos
Los tests de integración usan una DB PostgreSQL real (test DB).
Esto evita falsos positivos por divergencia mock/producción.`,
  };

  if (topic) {
    const topicLower = topic.toLowerCase();
    if (topicLower.includes('naming') || topicLower.includes('nombre') || topicLower.includes('convencion')) {
      return standards.naming;
    }
    if (topicLower.includes('commit')) {
      return standards.commits;
    }
    if (topicLower.includes('test')) {
      return standards.testing;
    }
  }

  return standards.default;
}

// ── get_jira_issue ────────────────────────────────────────────────────────────
async function getJiraIssue({ issue_key }) {
  if (!JIRA_AUTH) {
    return { content: [{ type: 'text', text: '❌ JIRA_BASE_URL, JIRA_EMAIL o JIRA_API_TOKEN no están configurados en .env' }], isError: true };
  }

  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${issue_key.toUpperCase()}`;
  const res = await fetch(url, { headers: { Authorization: JIRA_AUTH, Accept: 'application/json' } });

  if (res.status === 404) {
    return { content: [{ type: 'text', text: `❌ Issue ${issue_key} no encontrado. Verifica el key y que tengas acceso al proyecto.` }], isError: true };
  }
  if (!res.ok) {
    return { content: [{ type: 'text', text: `❌ Error Jira ${res.status}: ${await res.text()}` }], isError: true };
  }

  const data = await res.json();
  const f = data.fields;

  // Extraer texto de la descripción (formato Atlassian Document Format)
  const description = extractAdfText(f.description);

  // Comentarios recientes (últimos 3)
  const comments = (f.comment?.comments ?? [])
    .slice(-3)
    .map(c => `**${c.author?.displayName ?? 'Anónimo'}** (${c.created?.substring(0, 10)}):\n${extractAdfText(c.body)}`)
    .join('\n\n');

  const lines = [
    `# ${data.key}: ${f.summary}`,
    '',
    `**Estado:** ${f.status?.name ?? '-'}  |  **Prioridad:** ${f.priority?.name ?? '-'}  |  **Tipo:** ${f.issuetype?.name ?? '-'}`,
    `**Asignado:** ${f.assignee?.displayName ?? 'Sin asignar'}  |  **Reporter:** ${f.reporter?.displayName ?? '-'}`,
    `**Proyecto:** ${f.project?.name ?? '-'}  |  **Sprint:** ${f.sprint?.name ?? f.customfield_10020?.[0]?.name ?? '-'}`,
    `**Creado:** ${f.created?.substring(0, 10) ?? '-'}  |  **Actualizado:** ${f.updated?.substring(0, 10) ?? '-'}`,
    f.duedate ? `**Fecha límite:** ${f.duedate}` : '',
    '',
    '## Descripción',
    description || '_Sin descripción_',
    comments ? `\n## Comentarios recientes\n${comments}` : '',
    '',
    `🔗 ${JIRA_BASE_URL}/browse/${data.key}`,
  ].filter(l => l !== undefined);

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ── query_jira ────────────────────────────────────────────────────────────────
async function queryJira({ jql, max_results = 10 }) {
  if (!JIRA_AUTH) {
    return { content: [{ type: 'text', text: '❌ JIRA_BASE_URL, JIRA_EMAIL o JIRA_API_TOKEN no están configurados en .env' }], isError: true };
  }

  const limit = Math.min(max_results, 50);
  const url = `${JIRA_BASE_URL}/rest/api/3/search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: JIRA_AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jql,
      maxResults: limit,
      fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'created', 'updated', 'project'],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { content: [{ type: 'text', text: `❌ Error JQL ${res.status}: ${err}` }], isError: true };
  }

  const data = await res.json();
  const issues = data.issues ?? [];

  if (!issues.length) {
    return { content: [{ type: 'text', text: `No se encontraron issues para: \`${jql}\`` }] };
  }

  const rows = issues.map(i => {
    const f = i.fields;
    const assignee = f.assignee?.displayName ?? 'Sin asignar';
    return `- **${i.key}** [${f.status?.name}] ${f.summary} *(${assignee})*`;
  });

  const text = [
    `# Resultados Jira (${issues.length} de ${data.total})`,
    `**JQL:** \`${jql}\``,
    '',
    rows.join('\n'),
    data.total > limit ? `\n_...y ${data.total - limit} más. Refina el JQL para ver más resultados._` : '',
  ].join('\n');

  return { content: [{ type: 'text', text: text }] };
}

// ── Helper: extraer texto plano de Atlassian Document Format ──────────────────
function extractAdfText(node, depth = 0) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'paragraph') {
    const text = (node.content ?? []).map(n => extractAdfText(n, depth)).join('');
    return text + '\n';
  }
  if (node.type === 'heading') {
    const text = (node.content ?? []).map(n => extractAdfText(n, depth)).join('');
    return '#'.repeat(node.attrs?.level ?? 2) + ' ' + text + '\n';
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? []).map(n => extractAdfText(n, depth + 1)).join('');
  }
  if (node.type === 'listItem') {
    const text = (node.content ?? []).map(n => extractAdfText(n, depth)).join('').trim();
    return '  '.repeat(depth - 1) + '- ' + text + '\n';
  }
  if (node.type === 'codeBlock') {
    const code = (node.content ?? []).map(n => extractAdfText(n)).join('');
    return '```\n' + code + '\n```\n';
  }
  if (node.content) {
    return node.content.map(n => extractAdfText(n, depth)).join('');
  }
  return '';
}

// ── Iniciar servidor ──────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr para logs (stdout está reservado para el protocolo MCP)
  console.error('✅ IACC MCP Server corriendo en stdio');
  console.error(`   ChromaDB: ${process.env.CHROMADB_URL ?? 'http://localhost:8000'}`);
  console.error(`   Jira: ${JIRA_BASE_URL || '(no configurado)'}`);
}

main().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
