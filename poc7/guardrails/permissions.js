/**
 * Matriz de roles y permisos IACC
 *
 * Define qué herramientas puede usar cada rol y qué datos puede ver.
 * En producción esto vendría de Azure AD / base de datos de roles.
 */

export const ROLES = {
  'director-ti': {
    label: 'Director de TI',
    tools: ['search_knowledge_base', 'search_wiki', 'query_jira', 'get_jira_issue', 'get_student_data'],
    canSeeStudentData:    true,
    canSeeAdminEndpoints: true,
    canSeeMetrics:        true,
  },
  'jefe-desarrollo': {
    label: 'Jefe de Desarrollo',
    tools: ['search_knowledge_base', 'search_wiki', 'query_jira', 'get_jira_issue', 'get_student_data'],
    canSeeStudentData:    true,
    canSeeAdminEndpoints: false,
    canSeeMetrics:        true,
  },
  'lider-tecnico': {
    label: 'Líder Técnico',
    tools: ['search_knowledge_base', 'search_wiki', 'query_jira', 'get_jira_issue'],
    canSeeStudentData:    false,
    canSeeAdminEndpoints: false,
    canSeeMetrics:        false,
  },
  'desarrollador-fullstack': {
    label: 'Desarrollador Fullstack',
    tools: ['search_knowledge_base', 'search_wiki', 'query_jira', 'get_jira_issue'],
    canSeeStudentData:    false,
    canSeeAdminEndpoints: false,
    canSeeMetrics:        false,
  },
};

export function getRoleConfig(rol) {
  return ROLES[rol] ?? null;
}

export function canUseTool(rol, toolName) {
  return ROLES[rol]?.tools.includes(toolName) ?? false;
}

// Tabla legible para mostrar en consola al arrancar
export function printPermissionsTable(rol) {
  const config = ROLES[rol];
  if (!config) return;

  const check = (v) => v ? '✅' : '❌';
  console.log(`\n   Rol activo: ${config.label}`);
  console.log(`   Herramientas disponibles: ${config.tools.join(', ')}`);
  console.log(`   Ver datos de alumnos:     ${check(config.canSeeStudentData)}`);
  console.log(`   Ver endpoints de admin:   ${check(config.canSeeAdminEndpoints)}`);
  console.log(`   Ver métricas/costos:      ${check(config.canSeeMetrics)}`);
}
