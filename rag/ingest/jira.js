/**
 * POC 3 — RAG: Ingesta de issues Jira Cloud
 *
 * Flujo:
 *   Jira REST API v3 (POST /search/jql) → pagina issues → extrae texto ADF
 *   → chunk por issue → ChromaDB (misma colección que Excel)
 *   Langfuse traza todo el proceso.
 *
 * Nota: se agrega a la colección 'iacc-apis' ya existente.
 * Los ids Jira tienen prefijo 'jira-' para no colisionar con los Excel.
 */

import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';

const COLLECTION_NAME = 'iacc-apis';
const JIRA_BASE_URL   = process.env.JIRA_BASE_URL;
const PROJECTS        = ['CA', 'KAG', 'PEE', 'IDE1CN', 'EV', 'TOP', 'DIBC', 'RMCH', 'PEE'];
const PAGE_SIZE       = 50;
const BATCH_SIZE      = 50; // ChromaDB batch

// Auth Basic para Jira Cloud (email:token en base64)
const authHeader = 'Basic ' + Buffer.from(
  `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
).toString('base64');

// ── Extractor de texto desde Atlassian Document Format (ADF) ─────────────────
// ADF es un JSON anidado. Recorremos recursivamente y extraemos los nodos "text".
function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(adfToText).join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ── Convierte un issue Jira en texto enriquecido para embedding ───────────────
function issueToText(issue) {
  const f       = issue.fields;
  const summary = f.summary || '';
  const type    = f.issuetype?.name || '';
  const status  = f.status?.name || '';
  const project = f.project?.name || issue.key.split('-')[0];
  const assignee = f.assignee?.displayName || 'Sin asignar';
  const priority = f.priority?.name || '';
  const labels  = (f.labels || []).join(', ');
  const desc    = adfToText(f.description);

  return [
    `Jira: ${issue.key} | Proyecto: ${project}`,
    `Tipo: ${type} | Estado: ${status} | Prioridad: ${priority}`,
    `Título: ${summary}`,
    assignee !== 'Sin asignar' ? `Asignado a: ${assignee}` : null,
    labels   ? `Labels: ${labels}`                          : null,
    desc     ? `Descripción: ${desc.slice(0, 800)}`         : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Fetch paginado de todos los issues ───────────────────────────────────────
async function fetchAllIssues(jql, onPage) {
  let nextPageToken = undefined;
  let total = 0;

  do {
    const body = {
      jql,
      maxResults: PAGE_SIZE,
      fields: ['summary', 'description', 'issuetype', 'status', 'assignee',
               'priority', 'labels', 'project'],
      ...(nextPageToken ? { nextPageToken } : {}),
    };

    const res  = await fetch(`${JIRA_BASE_URL}/rest/api/3/search/jql`, {
      method:  'POST',
      headers: { 'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    const data = await res.json();

    await onPage(data.issues || []);
    total        += (data.issues || []).length;
    nextPageToken = data.isLast ? undefined : data.nextPageToken;

    process.stdout.write(`\r  → ${total} issues descargados...`);
  } while (nextPageToken);

  process.stdout.write('\n');
  return total;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const chroma   = new ChromaClient({ path: 'http://localhost:8000' });
  const embedder = new DefaultEmbeddingFunction();
  const langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl:    process.env.LANGFUSE_BASE_URL,
  });

  // Obtiene (o crea si no existe) la colección — no borra los datos de Excel
  const collection = await chroma.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embedder,
  });

  const trace = langfuse.trace({ name: 'rag-ingest-jira' });

  // Elimina solo los docs Jira previos para re-ingesta limpia
  console.log('🗑️  Limpiando issues Jira previos de la colección...');
  try {
    await collection.delete({ where: { source: { '$eq': 'Jira' } } });
  } catch { /* primera vez, no hay nada que borrar */ }

  const jql  = `project in (${PROJECTS.join(',')}) ORDER BY updated DESC`;
  console.log(`🔍 JQL: ${jql}\n`);

  const span       = trace.span({ name: 'ingest-jira', input: jql });
  let   totalDocs  = 0;
  let   buffer     = { ids: [], documents: [], metadatas: [] };

  const flush = async () => {
    if (buffer.ids.length === 0) return;
    await collection.upsert({
      ids:       buffer.ids,
      documents: buffer.documents,
      metadatas: buffer.metadatas,
    });
    totalDocs += buffer.ids.length;
    buffer = { ids: [], documents: [], metadatas: [] };
  };

  await fetchAllIssues(jql, async (issues) => {
    for (const issue of issues) {
      buffer.ids.push(`jira-${issue.key}`);
      buffer.documents.push(issueToText(issue));
      buffer.metadatas.push({
        source:   'Jira',
        project:  issue.key.split('-')[0],
        key:      issue.key,
        type:     issue.fields.issuetype?.name || '',
        status:   issue.fields.status?.name    || '',
      });

      if (buffer.ids.length >= BATCH_SIZE) await flush();
    }
  });

  await flush(); // último batch

  span.end({ output: `${totalDocs} issues indexados` });
  trace.update({ output: `Total: ${totalDocs} issues Jira en ChromaDB` });
  await langfuse.flushAsync();

  console.log(`\n✅ Ingesta Jira completa — ${totalDocs} issues indexados`);
  console.log('👉 Ahora ejecuta: npm run query');
}

main().catch(err => {
  console.error('❌ Error en ingesta Jira:', err.message);
  process.exit(1);
});
