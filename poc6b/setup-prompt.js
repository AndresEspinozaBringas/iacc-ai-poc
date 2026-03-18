/**
 * POC 6b — Langfuse Prompt Management
 *
 * Sube el prompt ganador (v3-estructurado) a Langfuse como prompt versionado.
 * Una vez subido, el agente (poc4/agent.js) lo leerá desde Langfuse en lugar
 * de tenerlo hardcodeado — lo que permite cambiar el prompt desde la UI sin
 * tocar código ni hacer deploy.
 *
 * Uso: npm run setup
 *
 * Después de correr este script:
 *   1. Verifica el prompt en: http://localhost:3000 → Prompts → agent-system
 *   2. Edita el prompt desde la UI si lo necesitas
 *   3. El agente (poc4) usará siempre la versión con label "production"
 */

import { Langfuse } from 'langfuse';

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl:    process.env.LANGFUSE_BASE_URL,
});

// Prompt ganador de POC 6 — v3-estructurado (3.96/5)
const WINNING_PROMPT = `Eres un asistente técnico de IACC. Estructura SIEMPRE tu respuesta con este formato:

**Respuesta:**
[Información directa en 2-4 oraciones concisas]

**Fuentes consultadas:**
[Lista las herramientas que usaste y qué aportó cada una]

Herramientas disponibles:
- search_knowledge_base → APIs y endpoints (búsqueda semántica)
- search_wiki → arquitectura, flujos, reglas de negocio, documentación técnica
- query_jira → filtros JQL exactos: fechas, estados, proyectos, asignados
- get_jira_issue → detalle completo de un issue específico (ej: EV-1316)

Usa herramientas antes de responder. Si necesitas múltiples fuentes, combínalas.
Responde en español con precisión técnica.`;

async function main() {
  console.log('\n📤 POC 6b — Subiendo prompt ganador a Langfuse Prompt Management');
  console.log('─'.repeat(60));

  try {
    const prompt = await langfuse.createPrompt({
      name:   'agent-system',
      prompt: WINNING_PROMPT,
      labels: ['production'],        // label que usará el agente al hacer getPrompt()
      config: {
        model:    'claude-sonnet-4-6',
        origin:   'poc6-experiment',
        variante: 'v3-estructurado',
        score:    '3.96/5',
      },
    });

    console.log(`✅ Prompt creado:`);
    console.log(`   Nombre:  ${prompt.name}`);
    console.log(`   Versión: ${prompt.version}`);
    console.log(`   Labels:  ${prompt.labels.join(', ')}`);
    console.log('');
    console.log('🔗 Verifica en Langfuse:');
    console.log(`   ${process.env.LANGFUSE_BASE_URL} → Prompts → agent-system`);
    console.log('');
    console.log('📌 El agente (poc4) ya está configurado para leer este prompt.');
    console.log('   Para cambiar el prompt: edítalo en la UI y el agente usará');
    console.log('   la nueva versión en la próxima consulta, sin reiniciar nada.');
  } catch (err) {
    if (err.message?.includes('already exists') || err.status === 409) {
      console.log('ℹ️  El prompt "agent-system" ya existe en Langfuse.');
      console.log('   Para actualizarlo, edítalo directamente en la UI:');
      console.log(`   ${process.env.LANGFUSE_BASE_URL} → Prompts → agent-system`);
    } else {
      throw err;
    }
  }

  await langfuse.flushAsync();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
