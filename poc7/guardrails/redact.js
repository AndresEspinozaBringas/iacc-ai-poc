/**
 * Guardrail de Redacción de Datos Sensibles
 *
 * Actúa sobre el OUTPUT del agente antes de mostrarlo al usuario.
 * Enmascara datos personales según el rol — aunque el agente los haya
 * recibido de una herramienta, no los muestra si el rol no tiene permiso.
 */

const REDACTIONS = [
  // RUT chileno: 12.345.678-9 o 12345678-9 o 12345678-K
  { pattern: /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, label: '[RUT REDACTADO]' },

  // Emails de alumnos IACC
  { pattern: /[\w.+-]+@alumno\.iacc\.cl\b/gi, label: '[EMAIL ALUMNO REDACTADO]' },

  // Números de teléfono chilenos: +56 9 1234 5678 o 09-12345678
  { pattern: /(\+56\s?)?(\(9\)|9)\s?\d{4}[\s-]?\d{4}\b/g, label: '[TELÉFONO REDACTADO]' },

  // Direcciones de correo genéricas que no sean del dominio IACC corporativo
  { pattern: /[\w.+-]+@(?!iacc\.cl\b)[\w.-]+\.[a-z]{2,}\b/gi, label: '[EMAIL REDACTADO]' },
];

/**
 * Redacta datos sensibles del output si el rol no tiene permiso para verlos.
 * @param {string} text       - Respuesta del agente
 * @param {object} roleConfig - Config del rol (de permissions.js)
 * @returns {{ text: string, redacted: boolean, count: number }}
 */
export function redactOutput(text, roleConfig) {
  if (roleConfig.canSeeStudentData) {
    return { text, redacted: false, count: 0 };
  }

  let result  = text;
  let count   = 0;

  for (const { pattern, label } of REDACTIONS) {
    const matches = result.match(pattern);
    if (matches) {
      count  += matches.length;
      result  = result.replace(pattern, label);
    }
  }

  return { text: result, redacted: count > 0, count };
}
