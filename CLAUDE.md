# AI Ecosystem POC Lab — IACC

## Contexto del proyecto
Laboratorio para explorar y construir pruebas de concepto del ecosistema de IA moderno.
Objetivo: capacitar al equipo de desarrollo en tecnologías de IA aplicadas a los sistemas de IACC.

## Perfil del equipo
- Jefe de Desarrollo en IACC (institución educativa)
- Equipo de 7 desarrolladores
- Infraestructura AWS
- N8N self-hosted para automatización
- Soluciones SaaS propias en desarrollo
- MacBook como máquina principal

## Stack base
- MacBook (Apple Silicon)
- Docker Desktop
- Node.js v20+
- Claude API (Anthropic) — modelo principal
- GitHub

## Hoja de ruta del POC — COMPLETADA
1. ✅ LLM Observability con Langfuse
2. ✅ MCP Server propio
3. ✅ RAG sobre documentación técnica (Excel ✅, Jira Cloud ✅, Wiki.js ✅)
4. ✅ Multi-Agent System (Tool Use con Claude Opus 4.6)

---

## Estructura del proyecto

```
langfuse-poc/
├── docker-compose.yml       ← Stack completo (Langfuse + ChromaDB)
├── .env                     ← Credenciales (NO commitear)
├── scripts/
│   └── test-claude.js       ← Script inicial POC 1
├── rag/                     ← POC 3: RAG multi-fuente
│   ├── package.json
│   ├── ingest/
│   │   ├── excel.js         ← Ingesta catálogos API Excel
│   │   ├── jira.js          ← Ingesta issues Jira Cloud
│   │   └── wiki.js          ← Ingesta páginas Wiki.js
│   └── query.js             ← CLI de consulta RAG
└── poc4/                    ← POC 4: Agente multi-herramienta
    ├── package.json
    └── agent.js             ← Agente Claude Opus 4.6
```

---

## POC 1 — LLM Observability con Langfuse

### Servicios Docker
| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| langfuse-web | 3000 | Dashboard principal → http://localhost:3000 |
| langfuse-worker | 3030 | Procesamiento asíncrono de eventos |
| postgres | 5433 | Base de datos (5432 ocupado por otro postgres) |
| clickhouse | 8123 | Analytics OLAP |
| redis | 6379 | Cache y queue |
| minio | 9090 | Blob storage (9000 ocupado por php-fpm) |
| **chromadb** | **8000** | **Vector DB para RAG (agregado en POC 3)** |

### Comandos útiles
```bash
cd ~/langfuse-poc

docker compose up -d           # Levantar stack completo
docker compose up -d chromadb  # Solo ChromaDB
docker compose ps              # Ver estado
docker compose logs -f langfuse-web
docker compose down
```

### Variables de entorno requeridas (.env)
```
ANTHROPIC_API_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_BASE_URL=http://localhost:3000
JIRA_BASE_URL=https://iaccsa.atlassian.net
JIRA_EMAIL=...
JIRA_API_TOKEN=...
WIKIJS_BASE_URL=https://wiki.iacc.cl
WIKIJS_API_TOKEN=...
```

---

## POC 2 — MCP Server propio

### Qué se construyó
Servidor MCP (`iacc-server`) con herramientas para consultar datos de alumnos de IACC, integrado con Claude Code.

### Tools implementadas
- `get_student_info` — obtiene nombre, carrera y año de un alumno por RUT
- `calculate_final_grade` — calcula nota final ponderada a partir de notas parciales

---

## POC 3 — RAG multi-fuente

### Fuentes indexadas en ChromaDB (colección: `iacc-apis`)
| Fuente | Docs | Script |
|--------|------|--------|
| Excel (3 catálogos API) | 242 endpoints | `npm run ingest:excel` |
| Jira Cloud (8 proyectos: CA, KAG, PEE, IDE1CN, EV, TOP, DIBC, RMCH) | 2.522 issues | `npm run ingest:jira` |
| Wiki.js (113 páginas) | 101 chunks | `npm run ingest:wiki` |
| **Total** | **2.865 docs** | `npm run ingest` |

### Comandos
```bash
cd ~/langfuse-poc/rag

npm run ingest          # Re-ingestar todo
npm run ingest:excel    # Solo Excel
npm run ingest:jira     # Solo Jira
npm run ingest:wiki     # Solo Wiki.js
npm run query           # CLI de consulta interactiva
```

### Cuándo usar RAG vs JQL directo
| Pregunta | Herramienta |
|----------|-------------|
| ¿Qué hace este endpoint? | RAG |
| ¿Qué finalizó esta semana? | JQL directo |
| ¿Qué está trabajando el equipo en X módulo? | RAG |
| ¿Cuántos bugs hay abiertos? | JQL directo |
| ¿Hay algo relacionado con autenticación SSO? | RAG |
| ¿Issues asignados a una persona? | JQL directo |

---

## POC 4 — Agente Multi-herramienta

### Herramientas disponibles
| Tool | Fuente | Cuándo usarla |
|------|--------|---------------|
| `search_knowledge_base` | ChromaDB (APIs + Jira) | Preguntas semánticas sobre APIs o contexto de issues |
| `search_wiki` | ChromaDB (Wiki IACC) | Arquitectura, flujos, onboarding, estándares, minutas |
| `query_jira` | Jira REST API | Filtros exactos: fechas, estado, asignado, conteo |
| `get_jira_issue` | Jira REST API | Detalle completo de un issue específico |

### Modelo: Claude Sonnet 4.6 (optimizado desde Opus 4.6)
- Adaptive thinking habilitado (`thinking: {type: "adaptive"}`)
- Loop manual con streaming (respuesta en tiempo real)
- Langfuse traza cada decisión y llamada a herramienta como generation (tokens + costo visible)

### Comando
```bash
cd ~/langfuse-poc/poc4
npm run agent
```

---

## Documentación adicional
Ver `TRAINING.md` para guía completa de capacitación del equipo.

---

## Hoja de ruta extendida

### ✅ FASE 0 — Fundamentos (COMPLETADA)
1. ✅ LLM Observability con Langfuse
2. ✅ MCP Server propio (iacc-server)
3. ✅ RAG multi-fuente (Excel + Jira + Wiki.js → 2.865 docs en ChromaDB)
4. ✅ Multi-Agent con Claude Opus 4.6 (4 tools)

### 🔴 FASE 1 — Producción & Calidad (EN CURSO)
5. ✅ LLM-as-Judge → evaluación automática de respuestas del agente
6. 🔄 Prompt Experiments → comparar variantes de system prompt con Langfuse Datasets
6b. ⬜ Langfuse Prompt Management → gestionar el prompt ganador desde la UI sin tocar código
7. ⬜ Guardrails → privacidad, scope, alucinación, prompt injection

### 🟢 FASE 2 — Producto & Negocio
8. ⬜ Asistente Web IACC → interfaz chat sobre RAG actual (Next.js + Express)
9. ⬜ AI Gateway con LiteLLM → centralizar llamadas LLM del equipo con control de costos
10. ⬜ Fine-tuning → modelo especializado en dominio IACC (cuando haya datos suficientes)

---

## POC 5 — LLM-as-Judge (COMPLETADO)

### Objetivo
Evaluar automáticamente la calidad de las respuestas del agente usando Claude como juez.

### Arquitectura
```
Pregunta usuario
      ↓
Agente responde (poc4/agent.js)
      ↓
Langfuse captura: input + output + contexto RAG usado
      ↓
Claude evalúa con criterios:
  - Correctitud factual (1-5)
  - Uso del contexto RAG (1-5)
  - Concisión (1-5)
  - Sin alucinaciones (1-5)
      ↓
Score guardado en Langfuse
      ↓
Dashboard muestra tendencias
```

### Stack
- Langfuse SDK (scores API) — ya instalado
- Claude API como juez — ya disponible
- Carpeta: poc5/
- Archivo principal: poc5/evaluator.js

---

## POC 6 — Prompt Experiments (EN CURSO)

### Objetivo
Comparar 3 variantes del system prompt del agente usando Langfuse Datasets y Experiments.

### Variantes
| Variante | Estrategia |
|----------|-----------|
| `v1-baseline` | Prompt actual del agente (poc4), explicativo |
| `v2-conciso` | Reglas estrictas: máx 3 bullets, solo info verificada |
| `v3-estructurado` | Formato fijo con `**Respuesta:**` + `**Fuentes consultadas:**` |

### Stack
- Langfuse Datasets API — dataset `iacc-eval` con 8 preguntas
- Langfuse Experiments — cada variante es un run vinculado vía `item.link(trace, runName)`
- LLM-as-Judge (Haiku 4.5) — mismas 4 dimensiones que POC 5
- Modelos: Sonnet 4.6 (agente) + Haiku 4.5 (juez)

### Comandos
```bash
cd ~/langfuse-poc/poc6
npm run experiment    # corre las 3 variantes × 8 preguntas (~10 min)
```

### Ver resultados
Langfuse → Datasets → `iacc-eval` → comparar runs lado a lado

---

## POC 6b — Langfuse Prompt Management (PRÓXIMO)

### Objetivo
Mover el prompt ganador de POC 6 a Langfuse Prompt Management para gestionarlo desde la UI sin tocar código.

### Qué agrega
- Versionar prompts desde la UI (v1, v2, v3... con historial y fechas)
- Cambiar el prompt en producción sin deploy
- Rollback en 1 click si un prompt nuevo empeora las métricas
- Prompt separado del código: `await langfuse.getPrompt('agent-system', version)`

---

## Estrategia de modelos (optimización de costos)

| Componente | Modelo | Costo output |
|-----------|--------|-------------|
| Agente (poc4, poc5, poc6) | `claude-sonnet-4-6` | $15/1M tokens |
| Juez evaluador (poc5, poc6) | `claude-haiku-4-5` | $5/1M tokens |
| RAG query (rag/query.js) | `claude-haiku-4-5` | $5/1M tokens |

---

## Estructura del proyecto actualizada
```
langfuse-poc/
├── docker-compose.yml
├── .env
├── CLAUDE.md
├── TRAINING.md
├── scripts/
│   └── test-claude.js
├── rag/                     ← POC 3: RAG multi-fuente
├── poc4/                    ← POC 4: Agente multi-herramienta
│   └── agent.js
├── poc5/                    ← POC 5: LLM-as-Judge ✅
│   ├── evaluator.js
│   ├── run-eval.js
│   └── dataset.json
├── poc6/                    ← POC 6: Prompt Experiments 🔄
│   ├── experiment.js
│   └── package.json
├── poc7/                    ← POC 7: Guardrails
└── web/                     ← Fase 2: Asistente Web IACC
```
