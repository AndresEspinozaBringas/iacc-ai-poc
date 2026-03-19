/**
 * POC 14 — MCP Server IACC para Kiro IDE
 *
 * Expone herramientas de contexto IACC directamente en el IDE:
 *   - search_technical_docs  → búsqueda semántica en ChromaDB (APIs + Wiki + Jira)
 *   - get_api_contracts      → contratos de endpoints por módulo o ruta
 *   - get_related_stories    → issues Jira relacionados con el código actual
 *   - get_coding_standards   → estándares y convenciones del equipo IACC
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
            enum: ['all', 'apis', 'jira', 'wiki'],
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
    const sourceMap = { apis: 'excel', jira: 'jira', wiki: 'wiki' };
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
