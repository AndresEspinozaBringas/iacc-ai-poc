/**
 * POC 3 — RAG: Ingesta de páginas Wiki.js (GraphQL API)
 *
 * Flujo:
 *   Wiki.js GraphQL → lista páginas → obtiene contenido (markdown/HTML)
 *   → strip HTML/markdown → chunking por sección → ChromaDB
 *   Langfuse traza el proceso.
 *
 * Chunking strategy:
 *   - Divide por secciones (headings ## / ###)
 *   - Chunks mínimo 100 chars, máximo 1000 chars
 *   - Preserva contexto: título de página + sección en cada chunk
 */

import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import { Langfuse } from 'langfuse';

const COLLECTION_NAME = 'iacc-apis';
const WIKIJS_URL      = process.env.WIKIJS_BASE_URL;
const WIKIJS_TOKEN    = process.env.WIKIJS_API_TOKEN;
const MIN_CHUNK_LEN   = 100;
const MAX_CHUNK_LEN   = 1000;
const BATCH_SIZE      = 50;

// ── GraphQL helper ────────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const res = await fetch(`${WIKIJS_URL}/graphql`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${WIKIJS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Wiki.js GraphQL error ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

// ── Limpieza de contenido ─────────────────────────────────────────────────────

// Elimina tags HTML y entidades comunes
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Elimina sintaxis markdown manteniendo el texto
function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')   // code blocks
    .replace(/`[^`]+`/g, '')           // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')   // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → texto
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold/italic
    .replace(/^\s*[-*+]\s+/gm, '')     // listas
    .replace(/^\s*\d+\.\s+/gm, '')     // listas numeradas
    .replace(/\|[^\n]+\|/g, ' ')       // tablas
    .replace(/^[-=]{3,}$/gm, '')       // separadores
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Chunking por secciones ────────────────────────────────────────────────────
function chunkBySection(text, pageTitle) {
  // Divide en secciones usando headings (## o ### en markdown, o párrafos en HTML)
  const sections = text
    .split(/\n(?=#{1,3}\s)/)  // split en headings markdown
    .map(s => s.trim())
    .filter(s => s.length >= MIN_CHUNK_LEN);

  // Si no hay headings (HTML limpio), divide por párrafos dobles
  const parts = sections.length > 1 ? sections :
    text.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length >= MIN_CHUNK_LEN);

  const chunks = [];
  let buffer = '';

  for (const part of parts) {
    if ((buffer + '\n' + part).length > MAX_CHUNK_LEN && buffer.length >= MIN_CHUNK_LEN) {
      chunks.push(`Página: ${pageTitle}\n\n${buffer.trim()}`);
      buffer = part;
    } else {
      buffer = buffer ? buffer + '\n' + part : part;
    }
  }
  if (buffer.length >= MIN_CHUNK_LEN) {
    chunks.push(`Página: ${pageTitle}\n\n${buffer.trim()}`);
  }

  return chunks;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const chroma   = new ChromaClient({ path: 'http://localhost:8000' });
  const embedder = new DefaultEmbeddingFunction();
  const langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl:    process.env.LANGFUSE_BASE_URL,
  });

  const collection = await chroma.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embedder,
  });

  const trace = langfuse.trace({ name: 'rag-ingest-wiki' });

  // Limpia docs Wiki previos para re-ingesta
  console.log('🗑️  Limpiando páginas Wiki previas...');
  try {
    await collection.delete({ where: { source: { '$eq': 'Wiki' } } });
  } catch { /* primera vez */ }

  // 1. Lista todas las páginas
  console.log('📋 Obteniendo lista de páginas...');
  const listData = await gql(`{
    pages {
      list(orderBy: TITLE) {
        id title path contentType isPublished
      }
    }
  }`);

  const pages = (listData.pages.list || []).filter(p => p.isPublished);
  console.log(`   ${pages.length} páginas publicadas encontradas\n`);

  const span      = trace.span({ name: 'ingest-wiki', input: `${pages.length} páginas` });
  let totalChunks = 0;
  let buffer      = { ids: [], documents: [], metadatas: [] };

  const flush = async () => {
    if (buffer.ids.length === 0) return;
    await collection.upsert({
      ids:       buffer.ids,
      documents: buffer.documents,
      metadatas: buffer.metadatas,
    });
    totalChunks += buffer.ids.length;
    buffer = { ids: [], documents: [], metadatas: [] };
  };

  // 2. Obtiene contenido de cada página y chunkea
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    process.stdout.write(`\r  [${i + 1}/${pages.length}] ${page.path.slice(0, 60).padEnd(60)}`);

    try {
      const pageData = await gql(
        `query($id: Int!) { pages { single(id: $id) { content } } }`,
        { id: page.id }
      );
      const raw     = pageData?.pages?.single?.content || '';
      const cleaned = page.contentType === 'html' ? stripHtml(raw) : stripMarkdown(raw);

      if (cleaned.length < MIN_CHUNK_LEN) continue;

      const chunks = chunkBySection(cleaned, page.title);

      for (let c = 0; c < chunks.length; c++) {
        buffer.ids.push(`wiki-${page.id}-${c}`);
        buffer.documents.push(chunks[c]);
        buffer.metadatas.push({
          source:      'Wiki',
          page_id:     String(page.id),
          title:       page.title,
          path:        page.path,
          contentType: page.contentType,
          url:         `${WIKIJS_URL}/${page.path}`,
        });

        if (buffer.ids.length >= BATCH_SIZE) await flush();
      }
    } catch (err) {
      // Página inaccesible, se omite
    }
  }

  await flush();

  process.stdout.write('\n');
  span.end({ output: `${pages.length} páginas → ${totalChunks} chunks` });
  trace.update({ output: `${totalChunks} chunks Wiki en ChromaDB` });
  await langfuse.flushAsync();

  console.log(`\n✅ Ingesta Wiki completa — ${pages.length} páginas → ${totalChunks} chunks`);
  console.log('👉 Ahora ejecuta: npm run query');
}

main().catch(err => {
  console.error('❌ Error en ingesta Wiki:', err.message);
  process.exit(1);
});
