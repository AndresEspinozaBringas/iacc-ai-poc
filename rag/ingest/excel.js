/**
 * POC 3 — RAG: Ingesta de catálogos de API desde Excel
 *
 * Flujo:
 *   Excel (.xlsx) → parseo → chunk por endpoint → ChromaDB (embedding en servidor)
 *   Langfuse traza todo el proceso para observabilidad.
 *
 * ChromaDB usa 'all-MiniLM-L6-v2' por defecto (se descarga la primera vez).
 */

import XLSX from 'xlsx';
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';

const COLLECTION_NAME = 'iacc-apis';

// Los tres catálogos de API — rutas absolutas para no depender del cwd
const CATALOGS = [
  {
    path: '/Users/andresespinozabringas/Downloads/api-catalog-Matricula-Contrato.xlsx',
    source: 'Matricula-Contrato',
    sheet: 'APIs Catalog',
  },
  {
    path: '/Users/andresespinozabringas/Downloads/api-catalog-PlanifCurso.xlsx',
    source: 'PlanifCurso',
    sheet: 'APIs Catalog',
  },
  {
    path: '/Users/andresespinozabringas/Downloads/docente-api-catalog.xlsx',
    source: 'Docente',
    sheet: 'APIs Catalog',
  },
];

/**
 * Convierte una fila del Excel en texto enriquecido para embedding.
 * Normaliza las distintas columnas entre los tres archivos.
 */
function rowToText(row, source) {
  const modulo    = row['Servicio/Módulo'] || row['Servicio'] || row['Sistema consumidor'] || '';
  const version   = row['Versión'] || '';
  const endpoint  = row['Endpoint'] || '';
  const method    = row['Método HTTP'] || row['Método'] || '';
  const desc      = row['Descripción'] || '';
  const request   = row['Request Body Schema'] || '';
  const response  = row['Response Schema'] || '';
  const codes     = row['Códigos HTTP'] || '';
  const auth      = row['Autenticación'] || '';
  const file      = row['Archivo Fuente'] || '';
  const tipo      = row['Tipo'] || '';

  return [
    `Sistema: ${source}`,
    `Módulo: ${modulo} | Versión: ${version}${tipo ? ' | Tipo: ' + tipo : ''}`,
    `Endpoint: ${method} ${endpoint}`,
    `Descripción: ${desc}`,
    request  ? `Request: ${request}`   : null,
    response ? `Response: ${response}` : null,
    `Autenticación: ${auth} | HTTP Codes: ${codes}`,
    file     ? `Fuente: ${file}`       : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  // --- Clientes ---
  const chroma = new ChromaClient({ path: 'http://localhost:8000' });
  const langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl:    process.env.LANGFUSE_BASE_URL,
  });

  const trace = langfuse.trace({ name: 'rag-ingest-excel' });

  // Limpia y recrea la colección para permitir re-ingesta
  console.log('🗑️  Limpiando colección anterior...');
  try { await chroma.deleteCollection({ name: COLLECTION_NAME }); } catch { /* no existía */ }

  // DefaultEmbeddingFunction usa all-MiniLM-L6-v2 localmente (descarga ~23MB la primera vez)
  const embedder   = new DefaultEmbeddingFunction();
  const collection = await chroma.createCollection({ name: COLLECTION_NAME, embeddingFunction: embedder });
  console.log(`📦 Colección '${COLLECTION_NAME}' creada\n`);

  let totalDocs = 0;

  for (const catalog of CATALOGS) {
    const span = trace.span({ name: `ingest-${catalog.source}`, input: catalog.path });

    const wb   = XLSX.readFile(catalog.path);
    const ws   = wb.Sheets[catalog.sheet];
    const rows = XLSX.utils.sheet_to_json(ws);

    const documents = rows.map(row => rowToText(row, catalog.source));
    const ids       = rows.map((_, i) => `${catalog.source}-${i}`);
    const metadatas = rows.map(row => ({
      source:   catalog.source,
      endpoint: row['Endpoint']                      || '',
      method:   row['Método HTTP'] || row['Método']  || '',
      module:   row['Servicio/Módulo'] || row['Servicio'] || '',
    }));

    // ChromaDB acepta máx ~166 docs por batch; usamos 100 para margen
    const BATCH_SIZE = 100;
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      await collection.add({
        ids:       ids.slice(i, i + BATCH_SIZE),
        documents: documents.slice(i, i + BATCH_SIZE),
        metadatas: metadatas.slice(i, i + BATCH_SIZE),
      });
    }

    span.end({ output: `${rows.length} endpoints indexados` });
    console.log(`✓ ${catalog.source}: ${rows.length} endpoints indexados`);
    totalDocs += rows.length;
  }

  trace.update({ output: `Total: ${totalDocs} endpoints en ChromaDB` });
  await langfuse.flushAsync();

  console.log(`\n✅ Ingesta completa — ${totalDocs} endpoints disponibles para consulta`);
  console.log('👉 Ahora ejecuta: npm run query');
}

main().catch(err => {
  console.error('❌ Error en ingesta:', err.message);
  process.exit(1);
});
