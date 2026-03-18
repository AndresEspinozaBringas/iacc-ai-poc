/**
 * POC 5 — Evaluación en batch sobre el dataset IACC
 *
 * Corre todas las preguntas del dataset.json, evalúa cada una con el juez
 * y muestra un reporte final con scores por dimensión y por tipo de pregunta.
 * Todos los scores quedan guardados en Langfuse para seguimiento histórico.
 */

import { readFileSync } from 'fs';
import { Langfuse } from 'langfuse';
import { evaluateQuestion } from './evaluator.js';

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl:    process.env.LANGFUSE_BASE_URL,
});

const dataset = JSON.parse(readFileSync('./dataset.json', 'utf8'));

async function main() {
  console.log('\n⚖️  IACC LLM-as-Judge — Evaluación en Batch');
  console.log(`📋 Dataset: ${dataset.length} preguntas`);
  console.log('─'.repeat(60));

  const results = [];

  for (const item of dataset) {
    try {
      const result = await evaluateQuestion(item.pregunta, item.herramientas_esperadas);
      results.push({ ...result, id: item.id, tipo: item.tipo, tema: item.tema,
        herramientas_esperadas: item.herramientas_esperadas });

      // Pequeña pausa entre evaluaciones para no saturar la API
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`\n❌ Error en ${item.id}: ${err.message}`);
    }
  }

  // ── Reporte final ───────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('📊 REPORTE FINAL');
  console.log('═'.repeat(60));

  // Tabla de resultados individuales
  console.log('\n┌─────┬──────────────────────────────────┬──────┬──────┬──────┬──────┬───────┐');
  console.log('│ ID  │ Tipo          │ Herram.OK │ Corr │ Tool │ Conc │ Aluc │ Prom  │');
  console.log('├─────┼──────────────────────────────────┼──────┼──────┼──────┼──────┼───────┤');
  results.forEach(r => {
    const ok  = r.toolsOk ? '✅' : '❌';
    const s   = r.scores;
    console.log(
      `│ ${r.id} │ ${r.tipo.padEnd(13)} │    ${ok}    │  ${s.correctitud}   │  ${s.uso_herramientas}   │  ${s.concision}   │  ${s.sin_alucinaciones}   │  ${r.promedio}  │`
    );
  });
  console.log('└─────┴──────────────────────────────────┴──────┴──────┴──────┴──────┴───────┘');

  // Promedios globales
  const avg = dim => {
    const vals = results.map(r => r.scores[dim]).filter(Boolean);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '-';
  };

  console.log('\n📈 Promedios globales:');
  console.log(`   Correctitud:       ${avg('correctitud')}/5`);
  console.log(`   Uso herramientas:  ${avg('uso_herramientas')}/5`);
  console.log(`   Concisión:         ${avg('concision')}/5`);
  console.log(`   Sin alucinaciones: ${avg('sin_alucinaciones')}/5`);
  console.log(`   Herramientas OK:   ${results.filter(r => r.toolsOk).length}/${results.length}`);

  // Promedios por tipo
  const tipos = [...new Set(results.map(r => r.tipo))];
  console.log('\n📊 Promedio por tipo de pregunta:');
  tipos.forEach(tipo => {
    const grupo = results.filter(r => r.tipo === tipo);
    const prom  = (grupo.reduce((a, r) => a + r.promedio, 0) / grupo.length).toFixed(1);
    console.log(`   ${tipo.padEnd(12)}: ${prom}/5 (${grupo.length} preguntas)`);
  });

  // Pregunta con mejor y peor score
  const sorted = [...results].sort((a, b) => b.promedio - a.promedio);
  console.log(`\n🏆 Mejor respuesta:  ${sorted[0].id} (${sorted[0].promedio}/5) — ${sorted[0].pregunta.slice(0, 60)}`);
  console.log(`⚠️  Peor respuesta:   ${sorted.at(-1).id} (${sorted.at(-1).promedio}/5) — ${sorted.at(-1).pregunta.slice(0, 60)}`);

  console.log(`\n🔗 Ver todos los scores en: ${process.env.LANGFUSE_BASE_URL}`);
  console.log('   Menú: Traces → filtrar por nombre "agent-query" → ver scores\n');

  await langfuse.flushAsync();
}

main().catch(console.error);
