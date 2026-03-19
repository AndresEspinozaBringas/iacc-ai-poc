#!/usr/bin/env node
/**
 * POC 14 — Configurar MCP Server IACC en Kiro IDE
 * Compatible con Windows, Mac y Linux.
 *
 * Uso:
 *   Windows:  node poc14\setup-kiro.js
 *   Mac/Linux: node poc14/setup-kiro.js
 */

import { writeFileSync, mkdirSync, existsSync, execSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..');
const serverJs   = join(__dirname, 'server.js');
const settingsDir = join(projectDir, '.kiro', 'settings');
const mcpFile    = join(settingsDir, 'mcp.json');

console.log('🔧 Configurando MCP Server IACC para Kiro...');
console.log(`   Proyecto: ${projectDir}`);

// ── Verificar Node.js ────────────────────────────────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`❌ Se requiere Node.js 20+. Versión actual: ${process.version}`);
  console.error('   Descarga desde: https://nodejs.org');
  process.exit(1);
}

// ── Instalar dependencias si faltan ─────────────────────────────────────────
const nodeModules = join(__dirname, 'node_modules');
if (!existsSync(nodeModules)) {
  console.log('📦 Instalando dependencias de poc14...');
  execSync('npm install --silent', { cwd: __dirname, stdio: 'inherit' });
}

// ── Crear directorio .kiro/settings ─────────────────────────────────────────
mkdirSync(settingsDir, { recursive: true });

// ── Generar mcp.json ─────────────────────────────────────────────────────────
// Usar siempre forward slashes — Node.js los acepta en Windows también
const serverPath = serverJs.replace(/\\/g, '/');

const config = {
  mcpServers: {
    'iacc-context': {
      command: 'node',
      args: [serverPath],
      env: {
        CHROMADB_URL: 'http://localhost:8000',
      },
      disabled: false,
      autoApprove: [
        'search_technical_docs',
        'get_api_contracts',
        'get_related_stories',
        'get_coding_standards',
        'get_jira_issue',
        'query_jira',
      ],
    },
  },
};

writeFileSync(mcpFile, JSON.stringify(config, null, 2), 'utf8');
console.log(`   ✅ ${mcpFile}`);

// ── Verificar .env ────────────────────────────────────────────────────────────
const envFile = join(projectDir, '.env');
const requiredVars = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
const missingVars = [];

if (existsSync(envFile)) {
  const { readFileSync } = await import('fs');
  const defined = new Set(
    readFileSync(envFile, 'utf8').split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => l.split('=')[0].trim())
  );
  for (const v of requiredVars) {
    if (!defined.has(v)) missingVars.push(v);
  }
} else {
  missingVars.push(...requiredVars);
}

console.log('');
console.log('═'.repeat(60));
console.log('✅ MCP Server IACC configurado.');
console.log('');

if (missingVars.length > 0) {
  console.log('⚠️  Faltan estas variables en .env:');
  for (const v of missingVars) console.log(`   ${v}=...`);
  console.log('');
  console.log('   Edita el archivo .env en la raíz del proyecto.');
  console.log('');
}

console.log('▶  Recarga Kiro para que detecte el servidor:');
console.log('   Ctrl+Shift+P → Reload Window');
console.log('');
console.log('🧪 Prueba en el chat de Kiro:');
console.log('   "¿Qué dice el ticket CA-248?"');
console.log('   "¿Qué endpoints tiene el módulo de matrícula?"');
