/**
 * POC 9 — Setup de Virtual Keys en LiteLLM
 *
 * Crea una clave API por proyecto y por desarrollador del equipo.
 * Cada clave tiene un límite de gasto mensual independiente.
 *
 * Uso: npm run setup-keys
 *
 * Las claves generadas se muestran en consola — agrégalas al .env
 * de cada proyecto o compártelas con cada desarrollador.
 */

const GATEWAY = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
const MASTER  = process.env.LITELLM_MASTER_KEY;

async function createKey({ alias, budget, models, metadata }) {
  const res = await fetch(`${GATEWAY}/key/generate`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${MASTER}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      key_alias:  alias,
      max_budget: budget,          // límite en USD
      budget_duration: 'monthly',  // se resetea cada mes
      models,                      // modelos permitidos para esta key
      metadata,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error creando key "${alias}": ${err}`);
  }

  return res.json();
}

async function main() {
  console.log('\n🔑 POC 9 — Creando Virtual Keys en LiteLLM Gateway');
  console.log(`   Gateway: ${GATEWAY}`);
  console.log('─'.repeat(60));

  // ── Keys por proyecto ──────────────────────────────────────────
  const PROJECT_KEYS = [
    {
      alias:   'poc4-agente',
      budget:  10,
      models:  ['agente-iacc'],
      metadata: { proyecto: 'POC 4 — Agente RAG', equipo: 'desarrollo' },
    },
    {
      alias:   'poc5-juez',
      budget:  5,
      models:  ['juez-iacc'],
      metadata: { proyecto: 'POC 5 — LLM-as-Judge', equipo: 'desarrollo' },
    },
    {
      alias:   'poc6-experiments',
      budget:  8,
      models:  ['agente-iacc', 'juez-iacc'],
      metadata: { proyecto: 'POC 6 — Prompt Experiments', equipo: 'desarrollo' },
    },
    {
      alias:   'poc7-guardrails',
      budget:  10,
      models:  ['agente-iacc', 'juez-iacc'],
      metadata: { proyecto: 'POC 7 — Guardrails RBAC', equipo: 'desarrollo' },
    },
    {
      alias:   'poc8-teams',
      budget:  15,
      models:  ['agente-iacc'],
      metadata: { proyecto: 'POC 8 — Teams Bot', equipo: 'desarrollo' },
    },
  ];

  // ── Keys por desarrollador ─────────────────────────────────────
  const DEV_KEYS = [
    {
      alias:   'dev-andres-espinoza',
      budget:  20,
      models:  ['agente-iacc', 'juez-iacc', 'rag-iacc'],
      metadata: { usuario: 'andres.espinoza@iacc.cl', rol: 'jefe-desarrollo' },
    },
    {
      alias:   'dev-alejandro-opazo',
      budget:  10,
      models:  ['agente-iacc', 'rag-iacc'],
      metadata: { usuario: 'alejandro.opazo@iacc.cl', rol: 'desarrollador-fullstack' },
    },
    {
      alias:   'dev-mauricio-mendoza',
      budget:  10,
      models:  ['agente-iacc', 'rag-iacc'],
      metadata: { usuario: 'mauricio.mendoza@iacc.cl', rol: 'desarrollador-fullstack' },
    },
    {
      alias:   'dev-alejandro-lucero',
      budget:  10,
      models:  ['agente-iacc', 'rag-iacc'],
      metadata: { usuario: 'alejandro.lucero@iacc.cl', rol: 'lider-tecnico' },
    },
  ];

  const allKeys = [...PROJECT_KEYS, ...DEV_KEYS];
  const created = [];

  for (const keyConfig of allKeys) {
    try {
      const result = await createKey(keyConfig);
      created.push({ alias: keyConfig.alias, key: result.key, budget: keyConfig.budget });
      console.log(`✅ ${keyConfig.alias.padEnd(28)} $${keyConfig.budget}/mes`);
    } catch (err) {
      console.log(`❌ ${keyConfig.alias.padEnd(28)} ${err.message}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📋 CLAVES GENERADAS — guárdalas en .env o compártelas:');
  console.log('═'.repeat(60));

  const projects = created.filter(k => k.alias.startsWith('poc'));
  const devs     = created.filter(k => k.alias.startsWith('dev'));

  if (projects.length) {
    console.log('\n🗂️  Por proyecto:');
    projects.forEach(({ alias, key, budget }) => {
      console.log(`   ${alias.padEnd(28)} $${budget}/mes → ${key}`);
    });
  }

  if (devs.length) {
    console.log('\n👤 Por desarrollador:');
    devs.forEach(({ alias, key, budget }) => {
      console.log(`   ${alias.padEnd(28)} $${budget}/mes → ${key}`);
    });
  }

  console.log('\n🔗 Dashboard: http://localhost:4000/ui');
  console.log('   (Inicia sesión con la LITELLM_MASTER_KEY del .env)\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  console.error('   ¿Está LiteLLM corriendo? Verifica: docker compose ps litellm');
  process.exit(1);
});
