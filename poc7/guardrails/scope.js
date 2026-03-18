/**
 * Guardrail de Scope
 *
 * Verifica que la pregunta esté dentro del dominio IACC usando Claude Haiku
 * como clasificador rápido y barato (~$0.001 por consulta).
 *
 * Rechaza preguntas fuera de dominio: política, deportes, entretenimiento, etc.
 */

import Anthropic from '@anthropic-ai/sdk';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CLASSIFIER_PROMPT = `Eres un clasificador de preguntas para un asistente técnico de IACC (institución educativa chilena).

Tu tarea: determinar si la pregunta está dentro del dominio permitido.

DOMINIO PERMITIDO:
- APIs, endpoints, autenticación, integraciones de sistemas
- Issues y proyectos Jira (CA, KAG, PEE, IDE1CN, EV, TOP, DIBC, RMCH)
- Arquitectura de software, flujos técnicos, documentación
- Datos de alumnos, docentes, matrículas, cursos (contexto técnico)
- Herramientas del equipo de desarrollo (N8N, Docker, AWS, etc.)
- Preguntas generales de programación o tecnología aplicadas al trabajo

FUERA DE DOMINIO:
- Política, deportes, entretenimiento, noticias generales
- Preguntas personales sin relación al trabajo técnico
- Temas que no tienen relación con IACC ni con desarrollo de software

Responde ÚNICAMENTE con JSON válido:
{"in_scope": true/false, "reason": "explicación breve en español"}`;

export async function checkScope(question) {
  try {
    const res = await claude.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 150,
      messages:   [{ role: 'user', content: `${CLASSIFIER_PROMPT}\n\nPregunta: "${question}"` }],
    });

    const text  = res.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { inScope: true }; // si falla el parseo, deja pasar

    const result = JSON.parse(match[0]);
    return { inScope: result.in_scope, reason: result.reason };
  } catch {
    return { inScope: true }; // ante error, no bloquear
  }
}
