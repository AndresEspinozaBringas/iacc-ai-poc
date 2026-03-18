/**
 * POC 9 — Test del Gateway LiteLLM
 *
 * Verifica que el gateway funciona correctamente:
 *   1. Health check del gateway
 *   2. Lista de modelos disponibles
 *   3. Llamada real con el alias "agente-iacc"
 *   4. Test de límite de presupuesto (key inválida)
 *
 * Uso: npm run test
 */

const GATEWAY = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
const MASTER  = process.env.LITELLM_MASTER_KEY;

async function get(path) {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: { 'Authorization': `Bearer ${MASTER}` },
  });
  return res.json();
}

async function chat(model, message, apiKey = MASTER) {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [{ role: 'user', content: message }],
    }),
  });
  return res.json();
}

async function main() {
  console.log('\n🧪 POC 9 — Test del Gateway LiteLLM');
  console.log(`   Gateway: ${GATEWAY}`);
  console.log('─'.repeat(55));

  // 1. Health check
  console.log('\n1️⃣  Health check:');
  try {
    const health = await fetch(`${GATEWAY}/health`);
    console.log(`   ${health.ok ? '✅' : '❌'} Status: ${health.status}`);
  } catch {
    console.log('   ❌ Gateway no responde — ¿está corriendo? docker compose ps litellm');
    process.exit(1);
  }

  // 2. Modelos disponibles
  console.log('\n2️⃣  Modelos registrados:');
  const models = await get('/models');
  (models.data || []).forEach(m => {
    console.log(`   ✅ ${m.id}`);
  });

  // 3. Llamada real con alias agente-iacc
  console.log('\n3️⃣  Llamada real → alias "agente-iacc":');
  const resp = await chat('agente-iacc', '¿Cuál es tu función en IACC? Responde en una oración.');
  if (resp.choices?.[0]?.message?.content) {
    const text   = resp.choices[0].message.content;
    const tokens = resp.usage?.total_tokens || '?';
    const model  = resp.model || 'agente-iacc';
    console.log(`   ✅ Respuesta (${tokens} tokens, modelo real: ${model}):`);
    console.log(`   "${text.slice(0, 120)}"`);
  } else {
    console.log('   ❌ Sin respuesta válida:', JSON.stringify(resp).slice(0, 200));
  }

  // 4. Llamada con key inválida
  console.log('\n4️⃣  Test key inválida (debe rechazar):');
  const badResp = await chat('agente-iacc', 'test', 'sk-key-invalida-123');
  if (badResp.error || badResp.code === 401) {
    console.log('   ✅ Rechazada correctamente — el gateway protege el acceso');
  } else {
    console.log('   ⚠️  Respuesta inesperada:', JSON.stringify(badResp).slice(0, 100));
  }

  // 5. Resumen de spend
  console.log('\n5️⃣  Uso acumulado (todas las keys):');
  try {
    const spend = await get('/spend/logs?limit=5');
    const logs  = spend.response || [];
    if (logs.length === 0) {
      console.log('   ℹ️  Sin registros aún (normal en primera ejecución)');
    } else {
      logs.forEach(l => {
        console.log(`   ${l.api_key?.slice(0, 20)}... | $${l.spend?.toFixed(4)} | ${l.model}`);
      });
    }
  } catch {
    console.log('   ℹ️  Spend logs no disponibles aún');
  }

  console.log('\n' + '═'.repeat(55));
  console.log('✅ Gateway operativo.');
  console.log('🔗 Dashboard: http://localhost:4000/ui');
  console.log('   Usa la LITELLM_MASTER_KEY como contraseña\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
