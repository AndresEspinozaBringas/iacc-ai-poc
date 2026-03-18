/**
 * POC 8 — Teams Bot: Servidor Express + Bot Framework
 *
 * Expone el endpoint /api/messages que Teams usa para enviar mensajes al bot.
 * El túnel (localtunnel) hace accesible este servidor desde internet.
 *
 * Uso:
 *   Terminal 1: npm run start    ← levanta el servidor en puerto 3978
 *   Terminal 2: npm run tunnel   ← expone https://iacc-bot-poc.loca.lt → localhost:3978
 */

import express              from 'express';
import { BotFrameworkAdapter, MemoryStorage, ConversationState } from 'botbuilder';
import { IACCBot }          from './bot.js';

const app     = express();
app.use(express.json());

// ── Adaptador Bot Framework ───────────────────────────────────────────────────
const adapter = new BotFrameworkAdapter({
  appId:       process.env.CLIENT_ID,
  appPassword: process.env.CLIENT_SECRET,
});

adapter.onTurnError = async (context, error) => {
  console.error('[BotError]', error);
  await context.sendActivity('Ocurrió un error interno. Por favor intenta nuevamente.');
};

// ── Estado de conversación (en memoria — válido para POC) ─────────────────────
const memoryStorage      = new MemoryStorage();
const conversationState  = new ConversationState(memoryStorage);
const bot                = new IACCBot(conversationState);

// ── Endpoint principal que Teams llama ───────────────────────────────────────
app.post('/api/messages', (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    await bot.run(context);
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({ status: 'IACC Bot corriendo', port: 3978 }));

const PORT = process.env.BOT_PORT || 3978;
app.listen(PORT, () => {
  console.log(`\n🤖 IACC Teams Bot — POC 8`);
  console.log(`   Servidor: http://localhost:${PORT}`);
  console.log(`   Endpoint: http://localhost:${PORT}/api/messages`);
  console.log(`\n   En otra terminal ejecuta: npm run tunnel`);
  console.log(`   Luego configura en Azure Bot: https://iacc-bot-poc.loca.lt/api/messages\n`);
});
