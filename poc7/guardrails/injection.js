/**
 * Guardrail de Prompt Injection
 *
 * Detecta intentos de manipular al agente mediante patrones regex.
 * Es la primera línea de defensa — rápida, sin llamada a API.
 */

const INJECTION_PATTERNS = [
  // Español
  /ignora(r)?\s+(tus\s+)?(instrucciones|reglas|restricciones|sistema)/i,
  /olvida\s+(todo|tus\s+instrucciones|el\s+sistema)/i,
  /act[uú]a\s+como\s+si/i,
  /eres\s+ahora\s+un/i,
  /nuevo\s+(rol|prompt|sistema|modo)/i,
  /simula\s+ser/i,
  /finge\s+que\s+eres/i,
  /tus\s+nuevas\s+instrucciones/i,
  /modo\s+(sin\s+restricciones|libre|jailbreak)/i,

  // Inglés
  /ignore\s+(your\s+)?(instructions|rules|restrictions|system)/i,
  /forget\s+(everything|your\s+instructions|the\s+system)/i,
  /act\s+as\s+if/i,
  /you\s+are\s+now\s+a/i,
  /new\s+(role|prompt|system|mode)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /your\s+new\s+instructions/i,
  /jailbreak/i,
  /DAN\s+mode/i,

  // Intentos de inyectar roles o contexto
  /\[SYSTEM\]/i,
  /\[INSTRUCCIÓN\]/i,
  /<system>/i,
  /system\s*:\s*\n/i,
];

export function checkInjection(question) {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(question)) {
      return {
        isInjection: true,
        pattern:     pattern.source,
      };
    }
  }
  return { isInjection: false };
}
