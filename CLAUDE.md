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
4. ✅ Multi-Agent con Claude Sonnet 4.6 (4 tools, optimizado desde Opus 4.6)

### 🔴 FASE 1 — Producción & Calidad (COMPLETADA)
5. ✅ LLM-as-Judge → evaluación automática de respuestas del agente
6. ✅ Prompt Experiments → v3-estructurado ganador (3.96/5) — dataset iacc-eval 8 preguntas
6b. ✅ Langfuse Prompt Management → prompt ganador en UI, agente lo lee con getPrompt()
7. ✅ Guardrails + RBAC → scope, injection, permisos por rol, redacción de datos sensibles

### 🟢 FASE 2 — Producto & Negocio (EN CURSO)
8. 🔄 Teams Bot → Bot Framework + lista blanca — pendiente acceso Azure para conectar a Teams
9. ✅ AI Gateway LiteLLM → virtual keys por proyecto/dev, límites de gasto, alias de modelos
10. ⬜ Fine-tuning → modelo especializado en dominio IACC (cuando haya datos suficientes)

---

## Migración M1 → M5

### Contexto
El MacBook Air M1 8GB quedó limitado para correr el stack completo Docker (7 servicios ~5-6GB RAM).
Se migró el proyecto al MacBook Pro M5 16GB para mejor rendimiento.

### Estado de la migración
- ✅ Código subido a GitHub: https://github.com/AndresEspinozaBringas/iacc-ai-poc
- ✅ Exportar datos Docker del equipo origen (paso 2)
- ✅ Transferir backups al equipo destino (paso 3)
- ✅ Configurar equipo destino (paso 4)
- ✅ Restaurar datos (paso 5)
- ✅ Verificar entorno (paso 6) — completada en MacBook Pro M5

### Scripts de migración (portables — funcionan en cualquier equipo)
Los scripts detectan su ubicación automáticamente con `PROJECT_DIR`.
No contienen rutas hardcodeadas — funcionan independiente de dónde esté clonado el proyecto.

```bash
# En equipo origen
bash scripts/paso1-github-m1.sh                          # preparar git
bash scripts/paso2-exportar-datos-m1.sh                  # exportar volúmenes Docker

# En equipo destino
bash paso4-configurar-m5.sh <URL_GITHUB> [dir_destino]   # clonar + instalar
bash scripts/paso5-restaurar-datos-m5.sh                 # restaurar datos
bash scripts/paso6-verificar-m5.sh                       # verificar entorno
```

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

## POC 6 — Prompt Experiments (COMPLETADO)

### Resultado
| Variante | Promedio | Destaca en |
|----------|----------|-----------|
| v1-baseline | 3.43/5 | — |
| v2-conciso | 3.74/5 | Concisión |
| **v3-estructurado** | **3.96/5** | Correctitud + Sin alucinaciones |

**Ganador: v3-estructurado** — formato `**Respuesta:**` + `**Fuentes consultadas:**`

### Comando
```bash
cd poc6 && npm run experiment    # 3 variantes × 8 preguntas (~10 min)
```

---

## POC 6b — Langfuse Prompt Management (COMPLETADO)

### Qué se hizo
- Prompt ganador (v3-estructurado) subido a Langfuse como `agent-system` con label `production`
- `poc4/agent.js` modificado para leer el prompt con `langfuse.getPrompt('agent-system')`
- Fallback local si Langfuse no está disponible

### Comando
```bash
cd poc6b && npm run setup    # sube el prompt a Langfuse (solo primera vez)
```

### Gestión
Langfuse → Prompts → `agent-system` → editar sin tocar código

---

## POC 7 — Guardrails + RBAC (COMPLETADO)

### Arquitectura
```
INPUT:  injection check (regex) → scope check (Haiku) → permission check (por rol)
AGENT:  herramientas filtradas según rol
OUTPUT: redacción de datos sensibles según rol
```

### Roles implementados
| Rol | Datos alumnos | Endpoints admin | Métricas |
|-----|--------------|-----------------|----------|
| director-ti | ✅ | ✅ | ✅ |
| jefe-desarrollo | ✅ | ❌ | ✅ |
| lider-tecnico | ❌ | ❌ | ❌ |
| desarrollador-fullstack | ❌ | ❌ | ❌ |

### Comando
```bash
cd poc7 && npm run agent    # selección de rol interactiva al arrancar
```

---

## POC 8 — Teams Bot (EN CURSO)

### Estado
- ✅ Bot implementado con Bot Framework SDK
- ✅ Lista blanca: andres.espinoza, alejandro.opazo, mauricio.mendoza, alejandro.lucero (@iacc.cl)
- ✅ Guardrails POC 7 integrados
- ✅ Selección de rol al inicio de conversación
- 🔄 Pendiente: acceso Azure para configurar Messaging Endpoint

### Comando
```bash
# Terminal 1
cd poc8 && npm run start     # servidor en puerto 3978
# Terminal 2
cd poc8 && npm run tunnel    # túnel público con localtunnel
```

---

## POC 9 — AI Gateway LiteLLM (COMPLETADO)

### Stack
- LiteLLM como contenedor Docker (puerto 4000)
- 3 alias de modelos: `agente-iacc`, `juez-iacc`, `rag-iacc`
- 9 virtual keys: 5 por proyecto + 4 por desarrollador del equipo
- Dashboard: http://localhost:4000/ui

### Alias de modelos
| Alias | Modelo real | Usado en |
|-------|-------------|---------|
| `agente-iacc` | claude-sonnet-4-6 | poc4, poc7, poc8 |
| `juez-iacc` | claude-haiku-4-5 | poc5, poc6 |
| `rag-iacc` | claude-haiku-4-5 | rag/query.js |

### Comandos
```bash
cd poc9
npm run setup-keys    # crear virtual keys (solo primera vez)
npm run test          # verificar gateway
```

---

## Estrategia de modelos (optimización de costos)

| Componente | Alias LiteLLM | Modelo real | Costo output |
|-----------|---------------|-------------|-------------|
| Agente RAG + guardrails | `agente-iacc` | claude-sonnet-4-6 | $15/1M tokens |
| Juez evaluador | `juez-iacc` | claude-haiku-4-5 | $5/1M tokens |
| RAG queries | `rag-iacc` | claude-haiku-4-5 | $5/1M tokens |

Para cambiar modelo: editar `litellm_config.yaml` y reiniciar el contenedor.

---

## Estructura del proyecto actualizada
```
iacc-ai-poc/
├── docker-compose.yml       ← Stack completo (Langfuse + ChromaDB + LiteLLM)
├── litellm_config.yaml      ← Alias de modelos y config del gateway
├── .env                     ← Credenciales (NO commitear)
├── CLAUDE.md
├── TRAINING.md
├── scripts/                 ← Scripts portables (sin rutas hardcodeadas)
│   ├── paso1-github-m1.sh
│   ├── paso1b-push-github.sh
│   ├── paso2-exportar-datos-m1.sh
│   ├── paso3-transferir-red.sh
│   ├── paso4-configurar-m5.sh
│   ├── paso5-restaurar-datos-m5.sh
│   └── paso6-verificar-m5.sh
├── rag/                     ← POC 3: RAG multi-fuente
├── poc4/                    ← POC 4: Agente multi-herramienta ✅
├── poc5/                    ← POC 5: LLM-as-Judge ✅
├── poc6/                    ← POC 6: Prompt Experiments ✅
├── poc6b/                   ← POC 6b: Langfuse Prompt Management ✅
├── poc7/                    ← POC 7: Guardrails + RBAC ✅
├── poc8/                    ← POC 8: Teams Bot 🔄
└── poc9/                    ← POC 9: AI Gateway LiteLLM ✅
```
