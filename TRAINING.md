# Guía de Capacitación — Ecosistema de IA en IACC

> **Audiencia:** Equipo de desarrollo IACC (7 devs)
> **Prerequisitos:** Node.js, Docker, JavaScript/TypeScript básico
> **Repositorio:** `~/langfuse-poc`

---

## Índice

1. [Mapa conceptual del ecosistema](#1-mapa-conceptual-del-ecosistema)
2. [POC 1 — LLM Observability con Langfuse](#2-poc-1--llm-observability-con-langfuse)
3. [POC 2 — MCP Server propio](#3-poc-2--mcp-server-propio)
4. [POC 3 — RAG multi-fuente](#4-poc-3--rag-multi-fuente)
5. [POC 4 — Agente Multi-herramienta](#5-poc-4--agente-multi-herramienta)
6. [Cuándo usar qué](#6-cuándo-usar-qué)
7. [Ejercicios prácticos](#7-ejercicios-prácticos)
8. [Glosario](#8-glosario)

---

## 1. Mapa conceptual del ecosistema

```
┌─────────────────────────────────────────────────────────────┐
│                    ECOSISTEMA IA IACC                        │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌─────────────────────┐   │
│  │  Claude  │    │Langfuse  │    │     ChromaDB        │   │
│  │  Opus4.6 │◄──►│(trazas)  │    │  (vector DB)        │   │
│  └──────────┘    └──────────┘    └─────────────────────┘   │
│       ▲                                    ▲                │
│       │           ┌────────────────────────┘                │
│  ┌────┴──────────────────────────────────────────┐          │
│  │              AGENTE (POC 4)                   │          │
│  │   search_wiki │ search_kb │ query_jira         │          │
│  └───────────────────────────────────────────────┘          │
│         ▲              ▲              ▲                      │
│    ┌────┴────┐   ┌─────┴────┐  ┌─────┴────┐                │
│    │  Wiki   │   │ Excel/   │  │  Jira    │                │
│    │  IACC   │   │ APIs     │  │  Cloud   │                │
│    └─────────┘   └──────────┘  └──────────┘                │
│                                                             │
│  ┌──────────────────────────┐                               │
│  │    MCP Server (POC 2)    │                               │
│  │  get_student_info        │                               │
│  │  calculate_final_grade   │                               │
│  └──────────────────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

### Las 4 capas que construimos

| Capa | Qué es | Para qué sirve |
|------|--------|---------------|
| **Observabilidad** | Langfuse | Ver qué hace el LLM, cuánto cuesta, cuánto tarda |
| **Extensión** | MCP Server | Darle herramientas propias a Claude Code |
| **Conocimiento** | RAG + ChromaDB | Que el LLM conozca tu documentación interna |
| **Autonomía** | Agente Tool Use | Que el LLM decida solo qué herramienta usar |

---

## 2. POC 1 — LLM Observability con Langfuse

### ¿Qué problema resuelve?
Cuando usas un LLM en producción **no sabes**:
- Qué prompts usó exactamente
- Cuántos tokens consumió (costo real)
- Cuánto tardó cada llamada
- Por qué una respuesta fue mala

Langfuse es el "Datadog para LLMs" — registra todo.

### Conceptos clave

**Trace:** Una ejecución completa de principio a fin.
```
Trace: "pregunta del usuario"
  └── Span: retrieve (50ms)
  └── Span: generate (1200ms)
       └── LLM call: claude-opus-4-6, 1500 tokens
```

**Span:** Un paso dentro de un trace. Puede anidarse.

**Generation:** Una llamada específica al LLM con tokens contados.

### Cómo instrumentar código con Langfuse

```javascript
import { Langfuse } from 'langfuse';

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl:    process.env.LANGFUSE_BASE_URL,
});

// 1. Crear trace (toda la operación)
const trace = langfuse.trace({ name: 'mi-operacion', input: pregunta });

// 2. Crear span (un paso)
const span = trace.span({ name: 'busqueda', input: query });
const resultado = await buscar(query);
span.end({ output: resultado });

// 3. Registrar resultado final
trace.update({ output: respuesta });

// 4. Enviar a Langfuse (siempre al final)
await langfuse.flushAsync();
```

### Stack Docker

```yaml
# docker-compose.yml (resumen)
services:
  langfuse-web:    # Dashboard → localhost:3000
  langfuse-worker: # Procesamiento asíncrono
  postgres:        # Base de datos (puerto 5433)
  clickhouse:      # Analytics
  redis:           # Cache y queue
  minio:           # Blob storage
  chromadb:        # Vector DB (agregado en POC 3)
```

### Comandos
```bash
cd ~/langfuse-poc
docker compose up -d      # Levantar todo
docker compose ps         # Ver estado
docker compose down       # Detener
```

### Dashboard
- URL: http://localhost:3000
- Ver trazas: menú "Traces"
- Cada trace muestra: input, output, latencia, tokens, costo

---

## 3. POC 2 — MCP Server propio

### ¿Qué es MCP?
**Model Context Protocol** — protocolo abierto de Anthropic que permite extender las capacidades de Claude con herramientas propias. Es como una "API de herramientas" que Claude Code puede usar automáticamente.

```
Claude Code ──[MCP Protocol]──► Tu servidor ──► Tu base de datos / API
```

### Diferencia con Tool Use (POC 4)
| MCP Server | Tool Use (API) |
|------------|----------------|
| Herramientas para Claude Code (IDE) | Herramientas para tu aplicación |
| Configuración en settings de Claude | Definición en tu código |
| Uso interactivo | Uso programático |

### Herramientas implementadas

```javascript
// get_student_info: busca alumno por RUT
// Input:  { rut: "12345678-9" }
// Output: "Alumno: María González\nCarrera: Ingeniería..."

// calculate_final_grade: calcula nota ponderada
// Input:  { notas: [5.0, 6.0, 4.5], ponderaciones: [30, 40, 30] }
// Output: "Nota final: 5.3\nEstado: ✓ Aprobado"
```

### Cómo usar en Claude Code
Una vez configurado, Claude Code puede llamar las herramientas automáticamente:
```
> Busca al alumno con RUT 12345678-9
→ Claude llama get_student_info automáticamente
→ Muestra el resultado
```

---

## 4. POC 3 — RAG multi-fuente

### ¿Qué es RAG?
**Retrieval-Augmented Generation** — técnica que permite que un LLM responda usando **tu documentación interna** sin necesidad de re-entrenarlo.

```
Pregunta ──► Embedding ──► Búsqueda semántica ──► Top-5 chunks relevantes
                                                         │
                                               Claude + contexto ──► Respuesta
```

### El concepto de Embedding

Un embedding convierte texto en un vector numérico que captura el **significado semántico**:

```
"autenticar usuario"  → [0.23, -0.41, 0.87, ...]
"login con password"  → [0.21, -0.39, 0.85, ...]  ← similar!
"temperatura en Lima" → [-0.54, 0.12, -0.33, ...] ← diferente
```

Textos con significado similar quedan cerca en el espacio vectorial. ChromaDB busca los más cercanos a tu pregunta.

### ChromaDB — Vector Database

```
ChromaDB
  └── Colección: iacc-apis
        ├── [Matricula-Contrato] POST /api/login | Autenticación...
        ├── [Matricula-Contrato] GET /api/postulantes/:id | ...
        ├── [Jira] EV-1316 | Historia | Finalizado | Creación rol Visitante...
        ├── [Wiki] Arquitectura SGD | El SGD es una plataforma SaaS...
        └── ... 2.865 documentos total
```

Cada documento tiene:
- **id:** identificador único (`excel-0`, `jira-EV-1316`, `wiki-107-0`)
- **document:** texto del chunk
- **metadata:** fuente, tipo, URL, etc.

### Modelo de embedding utilizado
**all-MiniLM-L6-v2** (descargado automáticamente por ChromaDB):
- 384 dimensiones
- ~23MB de tamaño
- Corre localmente, sin API externa
- Excelente para inglés y español

### Las 3 fuentes y cómo se ingestan

#### Fuente 1: Excel (catálogos de API)
```javascript
// ingest/excel.js
// 1. Lee el Excel con xlsx
const rows = XLSX.utils.sheet_to_json(ws);

// 2. Convierte cada fila en texto enriquecido
function rowToText(row, source) {
  return `Sistema: ${source}
Endpoint: ${method} ${endpoint}
Descripción: ${desc}
Request: ${request}
Autenticación: ${auth}`;
}

// 3. Carga en ChromaDB en batches de 100
await collection.add({ ids, documents, metadatas });
```

**Columnas diferentes entre archivos → normalización:**
- `Servicio/Módulo` o `Servicio` o `Sistema consumidor` → módulo
- `Método HTTP` o `Método` → método HTTP

#### Fuente 2: Jira Cloud (REST API v3)
```javascript
// ingest/jira.js
// 1. Autenticación: Basic Auth (email:token en base64)
const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

// 2. POST /rest/api/3/search/jql con paginación por nextPageToken
do {
  const data = await fetch(url, { body: JSON.stringify({ jql, maxResults: 50, nextPageToken }) });
  nextPageToken = data.isLast ? undefined : data.nextPageToken;
} while (nextPageToken);

// 3. Descripción en formato ADF (Atlassian Document Format) → texto plano
function adfToText(node) {
  if (node.type === 'text') return node.text;
  if (node.content) return node.content.map(adfToText).join(' ');
}
```

**Proyectos indexados:** CA, KAG, PEE, IDE1CN, EV, TOP, DIBC, RMCH

#### Fuente 3: Wiki.js (GraphQL API)
```javascript
// ingest/wiki.js
// 1. Lista páginas via GraphQL
const data = await gql(`{ pages { list { id title path contentType } } }`);

// 2. Obtiene contenido de cada página
const content = await gql(`query($id: Int!) { pages { single(id: $id) { content } } }`, { id });

// 3. Limpia HTML y Markdown
function stripHtml(html)     { return html.replace(/<[^>]+>/g, ' '); }
function stripMarkdown(md)   { return md.replace(/```[\s\S]*?```/g, '').replace(/#{1,6}\s+/gm, ''); }

// 4. Chunking por secciones (headings)
function chunkBySection(text, pageTitle) {
  return text.split(/\n(?=#{1,3}\s)/) // divide en cada heading
    .filter(s => s.length >= 100)
    .map(s => `Página: ${pageTitle}\n\n${s}`);
}
```

**Páginas indexadas:** 113 (58 markdown + 55 HTML)
**Tipos de contenido:** arquitecturas, flujos funcionales, minutas, onboarding, estándares, PaP

### Chunking — concepto crítico

Chunking es cómo dividir documentos largos en piezas indexables:

| Estrategia | Cuándo usar |
|------------|-------------|
| Por fila (Excel) | Cada endpoint = 1 chunk |
| Por issue (Jira) | Cada ticket = 1 chunk |
| Por sección/heading (Wiki) | Cada sección = 1 chunk |
| Por párrafo | Documentos sin estructura |
| Por tokens fijos | Textos muy largos |

**Regla:** chunk mínimo 100 chars, máximo 1000 chars. Siempre incluir contexto (título de página/fuente).

### RAG vs JQL directo

```
¿La respuesta requiere ENTENDER contenido?  → RAG
¿La respuesta requiere FILTRAR/CONTAR?       → API/JQL directo
```

| Pregunta | Herramienta correcta | Por qué |
|----------|---------------------|---------|
| ¿Qué hace el endpoint /api/login? | RAG | Semántica |
| ¿Issues finalizados esta semana? | JQL | Filtro temporal |
| ¿Qué trabaja el equipo de EV? | RAG | Resumen semántico |
| ¿Cuántos bugs hay abiertos? | JQL | Conteo exacto |
| ¿Hay APIs relacionadas con pagos? | RAG | Búsqueda conceptual |
| ¿Issues asignados a Juan? | JQL | Filtro por campo |

### Comandos RAG
```bash
cd ~/langfuse-poc/rag
npm run ingest          # Re-ingestar todo (Excel + Jira + Wiki)
npm run ingest:excel    # Solo Excel
npm run ingest:jira     # Solo Jira
npm run ingest:wiki     # Solo Wiki.js
npm run query           # CLI interactivo de consulta
```

---

## 5. POC 4 — Agente Multi-herramienta

### ¿Qué es un Agente?
Un agente es un LLM que puede:
1. **Razonar** sobre qué necesita hacer
2. **Llamar herramientas** para obtener información
3. **Iterar** hasta tener suficiente contexto
4. **Sintetizar** una respuesta final

```
Usuario: "¿Qué dice la wiki del SGD y qué issues están abiertos?"
     │
     ▼
Claude Opus 4.6 razona:
  "Necesito dos fuentes: wiki (search_wiki) y Jira (query_jira)"
     │
     ├──► search_wiki("arquitectura SGD") → 5 chunks de wiki
     └──► query_jira("project = EV AND status != Done") → 17 issues
     │
     ▼
Claude sintetiza y responde con ambas fuentes integradas
```

### Tool Use — cómo funciona técnicamente

```javascript
// 1. Defines herramientas con nombre, descripción e input_schema
const TOOLS = [{
  name: 'search_wiki',
  description: 'Busca en la Wiki técnica de IACC...',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Pregunta en lenguaje natural' }
    },
    required: ['query']
  }
}];

// 2. Claude responde con tool_use en vez de texto
// response.content = [{ type: 'tool_use', name: 'search_wiki', input: { query: '...' } }]

// 3. Ejecutas la herramienta y devuelves tool_result
messages.push({ role: 'user', content: [{
  type: 'tool_result',
  tool_use_id: tool.id,
  content: resultado
}]});

// 4. Loop hasta stop_reason === 'end_turn'
```

### El agentic loop completo

```javascript
while (iteraciones < MAX_ITER) {
  // Llama a Claude (con streaming)
  const stream = claude.messages.stream({ model, tools, messages });
  const response = await stream.finalMessage();

  // ¿Terminó?
  if (response.stop_reason === 'end_turn') break;

  // ¿Quiere usar herramientas?
  if (response.stop_reason === 'tool_use') {
    const toolCalls = response.content.filter(b => b.type === 'tool_use');

    // Filtra thinking blocks antes de agregar al historial
    messages.push({ role: 'assistant',
      content: response.content.filter(b => b.type !== 'thinking') });

    // Ejecuta cada herramienta
    const results = await Promise.all(toolCalls.map(t => executeTool(t)));
    messages.push({ role: 'user', content: results });
  }
}
```

### Modelo: Claude Opus 4.6

**Adaptive thinking** (`thinking: {type: "adaptive"}`):
- Claude razona internamente antes de responder
- Decide cuánto pensar según la complejidad
- Visible en Langfuse como bloques de "thinking"
- Mejora significativamente la calidad de decisiones

**Por qué Opus 4.6 para el agente:**
- Mejor razonamiento sobre cuándo y cómo usar herramientas
- Puede llamar múltiples herramientas en paralelo
- Sabe cuándo tiene suficiente información para responder

### Las 4 herramientas del agente

```
search_knowledge_base → ChromaDB (fuente: APIs + issues Jira)
  Cuándo: preguntas semánticas sobre endpoints o contexto de tickets

search_wiki → ChromaDB (fuente: Wiki IACC)
  Cuándo: arquitectura, flujos, onboarding, estándares, minutas

query_jira → Jira REST API directa
  Cuándo: filtros exactos (fechas, estado, asignado, conteo)

get_jira_issue → Jira REST API directa
  Cuándo: detalle completo de un issue específico (EV-1316, etc.)
```

### Observabilidad del agente en Langfuse

Cada ejecución del agente genera una traza con:
```
Trace: agent-query (pregunta completa)
  ├── Span: decide (qué herramientas usó Claude)
  ├── Span: tool:search_wiki (input/output del RAG)
  ├── Span: tool:query_jira (JQL + resultados)
  └── Span: decide (respuesta final)
```

### Importante: thinking blocks en multi-turn

```javascript
// ⚠️ Error común con adaptive thinking + tool_use
// Los bloques thinking NO se deben reenviar al historial entre turnos

// ❌ MAL: incluye thinking blocks → API error 400
messages.push({ role: 'assistant', content: response.content });

// ✅ BIEN: filtra thinking blocks antes de agregar
messages.push({ role: 'assistant',
  content: response.content.filter(b => b.type !== 'thinking') });
```

### Comando
```bash
cd ~/langfuse-poc/poc4
npm run agent
```

---

## 6. Cuándo usar qué

### Árbol de decisión

```
¿Qué necesitas?
│
├── Monitorear LLMs en producción
│   └── → Langfuse (traza, costo, latencia)
│
├── Darle herramientas propias a Claude Code
│   └── → MCP Server
│
├── Que el LLM conozca tu documentación interna
│   ├── Solo para consultas de contenido → RAG puro
│   └── Para responder preguntas complejas → RAG dentro de un Agente
│
├── Ejecutar acciones basadas en lógica (si X entonces Y)
│   └── → Agente con Tool Use
│
└── Buscar con filtros exactos (fecha, estado, campo)
    └── → API directa (JQL, REST, SQL)
```

### Comparativa de las 4 tecnologías

| | Langfuse | MCP | RAG | Agente |
|--|---------|-----|-----|--------|
| **Qué hace** | Observa | Extiende | Conoce | Actúa |
| **Complejidad** | Baja | Media | Media | Alta |
| **Latencia** | Nula | Baja | Media | Alta |
| **Costo** | Bajo | Bajo | Medio | Alto |
| **Caso de uso** | Producción | IDE | Docs internas | Tareas complejas |

---

## 7. Ejercicios prácticos

### Nivel 1 — Observabilidad (Langfuse)
1. Abre http://localhost:3000 y explora las trazas existentes
2. Identifica cuánto tiempo tarda cada span en `agent-query`
3. Compara la latencia de `search_wiki` vs `query_jira`
4. Busca una traza de `rag-ingest-jira` y ve cuántos issues procesó

### Nivel 2 — RAG (consultas)
```bash
cd ~/langfuse-poc/rag && npm run query
```
Prueba estas preguntas y evalúa si las respuestas son correctas:
1. `¿Cómo autentico un usuario en la API de matrícula?`
2. `¿Qué endpoints existen para gestionar contratos?`
3. `¿Qué hace el proyecto KAG?`
4. `¿Cuál es la arquitectura del Remote Lab?`

### Nivel 3 — Agente (consultas cruzadas)
```bash
cd ~/langfuse-poc/poc4 && npm run agent
```
Prueba estas preguntas y observa qué herramientas usa:
1. `¿Cuántos issues están en progreso en el proyecto CA?` (→ debe usar query_jira)
2. `¿Qué documenta la wiki sobre HubSpot?` (→ debe usar search_wiki)
3. `¿Qué dice la wiki del API Gateway y qué issues hay en KAG?` (→ debe usar ambos)
4. `Dame el detalle del issue EV-1404` (→ debe usar get_jira_issue)

### Nivel 4 — Extensión (para devs avanzados)

**Ejercicio A:** Agregar una nueva herramienta al agente
```javascript
// En poc4/agent.js, agrega una nueva tool:
{
  name: 'search_confluence',
  description: 'Busca en Confluence de IACC',
  input_schema: { /* ... */ }
}
// Implementa la función fetchConfluence()
// Agrega el case en executeTool()
```

**Ejercicio B:** Agregar una nueva fuente al RAG
```javascript
// Crear rag/ingest/confluence.js siguiendo el patrón de jira.js:
// 1. Autenticación
// 2. Fetch paginado
// 3. Conversión a texto
// 4. Upsert en ChromaDB con metadata source: 'Confluence'
```

**Ejercicio C:** Crear un MCP Tool para Jira
```javascript
// Agregar al MCP Server una tool: get_my_jira_issues
// Input: { assignee: string }
// Output: lista de issues asignados a esa persona
```

---

## 8. Glosario

| Término | Definición |
|---------|------------|
| **LLM** | Large Language Model — modelo de lenguaje grande (ej: Claude, GPT) |
| **Embedding** | Representación numérica (vector) de un texto que captura su significado semántico |
| **Vector Database** | Base de datos optimizada para buscar vectores por similitud (ej: ChromaDB) |
| **RAG** | Retrieval-Augmented Generation — técnica que combina búsqueda semántica con generación de texto |
| **Chunk** | Fragmento de documento indexado en la vector DB |
| **Semantic search** | Búsqueda por significado, no por palabras exactas |
| **Tool Use** | Capacidad de un LLM de llamar funciones/herramientas definidas por el desarrollador |
| **Agentic loop** | Ciclo donde el LLM llama herramientas iterativamente hasta completar una tarea |
| **MCP** | Model Context Protocol — protocolo para extender Claude con herramientas propias |
| **Trace** | Registro completo de una ejecución en Langfuse (inicio a fin) |
| **Span** | Paso individual dentro de un trace |
| **Adaptive thinking** | Modo de Claude Opus 4.6 donde razona internamente antes de responder |
| **ADF** | Atlassian Document Format — formato JSON anidado usado por Jira para descripciones |
| **JQL** | Jira Query Language — lenguaje de filtrado de Jira (ej: `project = EV AND status = Done`) |
| **ChromaDB** | Base de datos vectorial open source, corre en Docker |
| **Langfuse** | Plataforma open source de observabilidad para LLMs |
| **all-MiniLM-L6-v2** | Modelo de embedding local usado por ChromaDB (384 dimensiones, ~23MB) |
| **Token** | Unidad de texto procesada por el LLM (~¾ de una palabra en inglés) |
| **Hallucination** | Cuando el LLM genera información incorrecta con aparente confianza |
| **Prompt engineering** | Técnica de diseñar instrucciones efectivas para guiar al LLM |
| **next_page_token** | Token de paginación usado por Jira API v3 |
| **tool_use block** | Bloque en la respuesta de Claude que indica quiere llamar una herramienta |
| **thinking block** | Bloque de razonamiento interno de Claude (no debe enviarse de vuelta en multi-turn) |

---

## Recursos para profundizar

| Recurso | URL |
|---------|-----|
| Documentación Claude API | https://platform.claude.com/docs |
| Langfuse docs | https://langfuse.com/docs |
| ChromaDB docs | https://docs.trychroma.com |
| Wiki.js GraphQL API | https://docs.requarks.io/api |
| Jira REST API v3 | https://developer.atlassian.com/cloud/jira/platform/rest/v3 |
| MCP Protocol | https://modelcontextprotocol.io |
| Repositorio del proyecto | `~/langfuse-poc` |
