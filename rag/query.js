/**
 * POC 3 — RAG: Consulta en lenguaje natural sobre APIs IACC
 *
 * Flujo por cada pregunta:
 *   1. RETRIEVE  → ChromaDB busca los 5 endpoints más similares (semántico)
 *   2. AUGMENT   → Construye prompt con contexto recuperado
 *   3. GENERATE  → Claude responde usando solo el contexto
 *   4. TRACE     → Langfuse registra retrieve + generate como spans
 */

import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';
import Anthropic from '@anthropic-ai/sdk';
import { Langfuse } from 'langfuse';
import readline from 'readline';

const COLLECTION_NAME = 'iacc-apis';
const N_RESULTS = 5; // cuántos chunks recuperar

// --- Clientes ---
const chroma   = new ChromaClient({ path: 'http://localhost:8000' });
const claude   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl:    process.env.LANGFUSE_BASE_URL,
});

const SYSTEM_PROMPT = `Eres un asistente técnico de IACC especializado en APIs internas.
Responde únicamente basándote en el contexto proporcionado (catálogo de APIs).
Si la información no está en el contexto, responde: "No encontré esa información en el catálogo de APIs."
Responde en español, de forma concisa y técnica. Cuando menciones endpoints, usa formato: MÉTODO /ruta`;

async function ragQuery(question) {
  const trace = langfuse.trace({ name: 'rag-query', input: question });

  // --- 1. RETRIEVE ---
  const retrieveSpan = trace.span({ name: 'retrieve', input: question });
  const embedder   = new DefaultEmbeddingFunction();
  const collection = await chroma.getCollection({ name: COLLECTION_NAME, embeddingFunction: embedder });
  const results = await collection.query({ queryTexts: [question], nResults: N_RESULTS });

  const chunks   = results.documents[0];
  const sources  = results.metadatas[0];
  const context  = chunks.join('\n\n---\n\n');
  retrieveSpan.end({ output: { chunks_count: chunks.length, sources } });

  // --- 2. AUGMENT + 3. GENERATE ---
  const generateSpan = trace.span({
    name: 'generate',
    input: { question, context_length: context.length },
  });

  const response = await claude.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [
      {
        role:    'user',
        content: `Contexto — APIs disponibles:\n${context}\n\nPregunta: ${question}`,
      },
    ],
  });

  const answer = response.content[0].text;
  generateSpan.end({ output: answer });
  trace.update({ output: answer });
  await langfuse.flushAsync();

  return { answer, sources };
}

// --- CLI interactivo ---
async function main() {
  console.log('\n🔍 IACC RAG — Consulta de catálogo de APIs');
  console.log('Escribe tu pregunta en lenguaje natural. "salir" para terminar.\n');
  console.log('Ejemplos:');
  console.log('  > ¿Cómo autentico un usuario?');
  console.log('  > ¿Qué endpoint descarga el reporte de notas?');
  console.log('  > ¿Qué APIs usan Bearer Token?\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('> ', async (question) => {
      if (!question.trim() || question.toLowerCase() === 'salir') {
        console.log('\nHasta luego 👋');
        rl.close();
        return;
      }

      try {
        console.log('\n⏳ Buscando...');
        const { answer, sources } = await ragQuery(question);

        console.log('\n📝 Respuesta:');
        console.log(answer);

        const sistemas = [...new Set(sources.map(s => s.source))];
        console.log(`\n📌 Fuentes consultadas: ${sistemas.join(', ')}`);
        console.log('─'.repeat(60));
      } catch (err) {
        console.error('\n❌ Error:', err.message);
      }

      ask();
    });
  };

  ask();
}

main();
