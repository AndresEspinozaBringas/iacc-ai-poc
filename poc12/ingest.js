/**
 * POC 12 — Ingesta SharePoint → ChromaDB
 *
 * Indexa en la colección iacc-apis (source: 'sharepoint'):
 *   - Documentos: .docx, .pdf, .txt, .md de todas las bibliotecas
 *   - Páginas: sitios y páginas SharePoint
 *   - Listas: items con todos sus campos
 *
 * Variables de entorno requeridas:
 *   SHAREPOINT_TENANT_ID     — ID del tenant Azure AD
 *   SHAREPOINT_CLIENT_ID     — Application (client) ID del App Registration
 *   SHAREPOINT_CLIENT_SECRET — Secret del App Registration
 *   SHAREPOINT_SITE_URL      — URL del sitio (ej: https://iaccsa.sharepoint.com/sites/desarrollo)
 */

import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// ── Config ────────────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.SHAREPOINT_TENANT_ID;
const CLIENT_ID     = process.env.SHAREPOINT_CLIENT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET;
const SITE_URL      = process.env.SHAREPOINT_SITE_URL;

const CHUNK_SIZE    = 1000;   // caracteres por chunk
const CHUNK_OVERLAP = 150;
const MAX_FILE_MB   = 20;     // ignorar archivos mayores
const SUPPORTED_EXT = new Set(['.docx', '.pdf', '.txt', '.md']);

// Tipos de lista a ignorar (listas de sistema de SharePoint)
const SKIP_LIST_TEMPLATES = new Set([
  'appCatalog', 'webPartCatalog', 'listTemplateCatalog',
  'userInformation', 'masterPageCatalog', 'workflowHistoryList',
  'taskList', 'announcementsList', 'surveyList',
]);

// ── Argumento --only ──────────────────────────────────────────────────────────
const onlyArg = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];

// ── Validación ────────────────────────────────────────────────────────────────
for (const [k, v] of Object.entries({ TENANT_ID, CLIENT_ID, CLIENT_SECRET, SITE_URL })) {
  if (!v) { console.error(`❌ Falta la variable de entorno SHAREPOINT_${k.split('_').slice(1).join('_') || k}`); process.exit(1); }
}

// ── Graph API helpers ─────────────────────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  );
  if (!res.ok) throw new Error(`Auth failed: ${await res.text()}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + data.expires_in * 1000;
  return _token;
}

async function graphGet(url) {
  const token = await getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') ?? '10', 10);
    console.warn(`   ⏳ Rate limit — esperando ${retry}s...`);
    await sleep(retry * 1000);
    return graphGet(url);
  }
  if (!res.ok) throw new Error(`Graph ${res.status}: ${url}\n${await res.text()}`);
  return res.json();
}

async function graphGetBinary(url) {
  const token = await getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  return res.arrayBuffer();
}

/** Recorre todas las páginas de un endpoint Graph (paginación con @odata.nextLink) */
async function graphGetAll(url) {
  const items = [];
  let next = url;
  while (next) {
    const data = await graphGet(next);
    items.push(...(data.value ?? []));
    next = data['@odata.nextLink'] ?? null;
  }
  return items;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── ChromaDB ──────────────────────────────────────────────────────────────────
const chroma  = new ChromaClient({ path: process.env.CHROMADB_URL ?? 'http://localhost:8000' });
const embedder = new DefaultEmbeddingFunction();
let collection;

async function upsertChunks(chunks) {
  if (!chunks.length) return;
  await collection.upsert({
    ids:        chunks.map(c => c.id),
    documents:  chunks.map(c => c.text),
    metadatas:  chunks.map(c => c.meta),
  });
}

// ── Chunking ──────────────────────────────────────────────────────────────────
function chunkText(text, baseMeta, baseId) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  let idx = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push({
      id:   `${baseId}-chunk${idx}`,
      text: clean.slice(start, end),
      meta: { ...baseMeta, chunk: idx },
    });
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    idx++;
  }
  return chunks;
}

// ── Extracción de texto por tipo ──────────────────────────────────────────────
async function extractText(buffer, ext) {
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return value;
  }
  if (ext === '.pdf') {
    const data = await pdfParse(Buffer.from(buffer));
    return data.text;
  }
  if (ext === '.txt' || ext === '.md') {
    return Buffer.from(buffer).toString('utf8');
  }
  return '';
}

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot !== -1 ? filename.slice(dot).toLowerCase() : '';
}

// ── Ingesta de documentos ─────────────────────────────────────────────────────
async function ingestDocuments(siteId, siteLabel) {
  console.log('\n📄 Indexando documentos...');
  const drives = await graphGetAll(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`
  );
  console.log(`   ${drives.length} biblioteca(s) encontrada(s)`);

  let total = 0;
  for (const drive of drives) {
    console.log(`   📁 ${drive.name}`);
    const files = await listDriveFiles(drive.id);
    for (const file of files) {
      const ext = getExt(file.name);
      if (!SUPPORTED_EXT.has(ext)) continue;
      const sizeMB = (file.size ?? 0) / 1_048_576;
      if (sizeMB > MAX_FILE_MB) {
        console.log(`      ⚠️  ${file.name} (${sizeMB.toFixed(1)} MB) — demasiado grande, omitido`);
        continue;
      }

      try {
        const buffer = await graphGetBinary(
          `https://graph.microsoft.com/v1.0/drives/${drive.id}/items/${file.id}/content`
        );
        const text = await extractText(buffer, ext);
        if (!text.trim()) continue;

        const baseMeta = {
          source:    'sharepoint',
          type:      'document',
          title:     file.name,
          filename:  file.name,
          library:   drive.name,
          site:      siteLabel,
          url:       file.webUrl ?? '',
          modified:  file.lastModifiedDateTime?.substring(0, 10) ?? '',
        };
        const chunks = chunkText(text, baseMeta, `sp-doc-${file.id}`);
        await upsertChunks(chunks);
        total += chunks.length;
        process.stdout.write(`      ✅ ${file.name} (${chunks.length} chunks)\n`);
      } catch (err) {
        console.warn(`      ❌ ${file.name}: ${err.message}`);
      }
      await sleep(200); // throttle suave
    }
  }
  console.log(`   → ${total} chunks indexados de documentos`);
}

async function listDriveFiles(driveId, folderId = 'root') {
  const items = await graphGetAll(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`
  );
  const files = [];
  for (const item of items) {
    if (item.folder) {
      const sub = await listDriveFiles(driveId, item.id);
      files.push(...sub);
    } else {
      files.push(item);
    }
  }
  return files;
}

// ── Ingesta de páginas ────────────────────────────────────────────────────────
async function ingestPages(siteId, siteLabel) {
  console.log('\n📰 Indexando páginas SharePoint...');
  let pages;
  try {
    pages = await graphGetAll(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/pages?$select=id,title,webUrl,lastModifiedDateTime,description`
    );
  } catch {
    // Algunos planes/permisos no tienen acceso a /pages
    console.log('   ⚠️  No se pudo acceder a /pages (verifica permiso Sites.Read.All)');
    return;
  }

  console.log(`   ${pages.length} página(s) encontrada(s)`);
  let total = 0;
  for (const page of pages) {
    try {
      // Obtener contenido HTML de la página
      let text = page.description ?? '';
      try {
        const detail = await graphGet(
          `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${page.id}/microsoft.graph.sitePage?$expand=canvasLayout`
        );
        text = extractPageText(detail);
      } catch {
        // fallback a descripción
      }

      if (!text.trim()) continue;

      const baseMeta = {
        source:   'sharepoint',
        type:     'page',
        title:    page.title ?? 'Sin título',
        site:     siteLabel,
        url:      page.webUrl ?? '',
        modified: page.lastModifiedDateTime?.substring(0, 10) ?? '',
      };
      const chunks = chunkText(text, baseMeta, `sp-page-${page.id}`);
      await upsertChunks(chunks);
      total += chunks.length;
      console.log(`   ✅ ${page.title} (${chunks.length} chunks)`);
    } catch (err) {
      console.warn(`   ❌ ${page.title}: ${err.message}`);
    }
    await sleep(200);
  }
  console.log(`   → ${total} chunks indexados de páginas`);
}

function extractPageText(page) {
  const parts = [];
  if (page.title) parts.push(page.title);
  if (page.description) parts.push(page.description);

  const sections = page.canvasLayout?.horizontalSections ?? [];
  for (const section of sections) {
    for (const col of section.columns ?? []) {
      for (const webpart of col.webparts ?? []) {
        const inner = webpart.innerHtml ?? webpart.textWebPartText ?? '';
        if (inner) parts.push(stripHtml(inner));
      }
    }
  }
  return parts.join('\n\n');
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Ingesta de listas ─────────────────────────────────────────────────────────
async function ingestLists(siteId, siteLabel) {
  console.log('\n📋 Indexando listas SharePoint...');
  const lists = await graphGetAll(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,description,list`
  );

  const filtered = lists.filter(l => {
    const template = l.list?.template ?? '';
    return !SKIP_LIST_TEMPLATES.has(template) && !l.displayName.startsWith('_');
  });
  console.log(`   ${filtered.length} lista(s) relevante(s) (de ${lists.length} totales)`);

  let total = 0;
  for (const list of filtered) {
    try {
      const items = await graphGetAll(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${list.id}/items?expand=fields`
      );
      console.log(`   📋 ${list.displayName} — ${items.length} item(s)`);

      for (const item of items) {
        const fields = item.fields ?? {};
        // Construir texto a partir de todos los campos con valor
        const textParts = Object.entries(fields)
          .filter(([k, v]) => !k.startsWith('_') && !k.startsWith('@') && v !== null && v !== '' && typeof v !== 'object')
          .map(([k, v]) => `${k}: ${v}`);

        if (!textParts.length) continue;
        const text = `Lista: ${list.displayName}\n${textParts.join('\n')}`;

        const title = fields.Title ?? fields.Name ?? fields.Nombre ?? `Item ${item.id}`;
        const baseMeta = {
          source:    'sharepoint',
          type:      'list',
          title:     String(title),
          list_name: list.displayName,
          site:      siteLabel,
          url:       item.webUrl ?? '',
          modified:  item.lastModifiedDateTime?.substring(0, 10) ?? '',
        };
        const chunks = chunkText(text, baseMeta, `sp-list-${list.id}-${item.id}`);
        await upsertChunks(chunks);
        total += chunks.length;
      }
      console.log(`      ✅ ${items.length} items indexados`);
    } catch (err) {
      console.warn(`   ❌ ${list.displayName}: ${err.message}`);
    }
    await sleep(300);
  }
  console.log(`   → ${total} chunks indexados de listas`);
}

// ── Resolver URL de sitio a siteId ────────────────────────────────────────────
async function resolveSiteId(siteUrl) {
  const url = new URL(siteUrl);
  const hostname = url.hostname;
  const path = url.pathname; // /sites/desarrollo

  const res = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${hostname}:${path}`
  );
  return { siteId: res.id, siteLabel: res.displayName ?? path };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔷 POC 12 — Ingesta SharePoint → ChromaDB');
  console.log(`   Sitio: ${SITE_URL}`);
  if (onlyArg) console.log(`   Modo: solo ${onlyArg}`);
  console.log('');

  // Autenticar
  console.log('🔑 Autenticando con Microsoft Graph...');
  await getToken();
  console.log('   ✅ Token obtenido');

  // Resolver siteId
  console.log('🔍 Resolviendo sitio SharePoint...');
  const { siteId, siteLabel } = await resolveSiteId(SITE_URL);
  console.log(`   ✅ Sitio: ${siteLabel} (${siteId})`);

  // Conectar a ChromaDB
  console.log('\n🗄️  Conectando a ChromaDB...');
  collection = await chroma.getOrCreateCollection({
    name: 'iacc-apis',
    embeddingFunction: embedder,
  });
  console.log('   ✅ Colección iacc-apis lista');

  // Eliminar chunks previos de SharePoint para re-indexar limpio
  if (!onlyArg) {
    try {
      await collection.delete({ where: { source: 'sharepoint' } });
      console.log('   🗑️  Chunks previos de SharePoint eliminados');
    } catch { /* colección vacía, ok */ }
  }

  const startTotal = Date.now();

  // Ejecutar ingesta según --only o todo
  if (!onlyArg || onlyArg === 'documents') {
    await ingestDocuments(siteId, siteLabel);
  }
  if (!onlyArg || onlyArg === 'pages') {
    await ingestPages(siteId, siteLabel);
  }
  if (!onlyArg || onlyArg === 'lists') {
    await ingestLists(siteId, siteLabel);
  }

  const elapsed = ((Date.now() - startTotal) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(55));
  console.log(`✅ Ingesta completada en ${elapsed}s`);
  console.log(`   Consulta con: cd ../rag && npm run query`);
  console.log(`   O pregunta en Kiro: "¿Qué documentos hay sobre ...?"`);
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
