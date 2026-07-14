// Colecciones de Firestore — usa SIEMPRE estas constantes, nunca strings sueltos.
export const COL = {
  CONFIG: 'config',
  AGENTS: 'agents',
  RESERVATIONS: 'reservations',
  SLOTS: 'slots',
  TICKETS: 'tickets',
  COUNTERS: 'counters',
  SCANS: 'scans',
  ADMINS: 'admins',
}

export const CONFIG_DOC = 'general'
export const TICKET_COUNTER_DOC = 'tickets'

// --- Roles de los usuarios del panel ---
// El documento admins/{uid} representa a CUALQUIER usuario del panel; su campo `role` decide qué
// puede hacer. Un doc sin `role` se trata como 'superadmin' (compatibilidad con el admin original).
export const ROLE = {
  SUPERADMIN: 'superadmin', // el administrador general: acceso total, crea usuarios
  AGENTE: 'agente', // agente de ventas: gestiona SUS solicitudes + escáner + asistencia
  SEGURIDAD: 'seguridad', // control de acceso: solo escáner + ver invitaciones/asistencia
}

export const ROLE_LABEL = {
  superadmin: 'Administrador',
  agente: 'Agente',
  seguridad: 'Seguridad',
}

// A dónde cae cada rol al entrar (su pantalla principal).
export const ROLE_HOME = {
  superadmin: '/admin',
  agente: '/admin/reservations',
  seguridad: '/admin/scanner',
}

// --- Estados de la reserva ---
export const RESERVATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
}

export const RESERVATION_STATUS_LABEL = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
}

// --- Estados del correo ---
export const EMAIL_STATUS = {
  NOT_SENT: 'not_sent',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
}

export const EMAIL_STATUS_LABEL = {
  not_sent: 'Sin enviar',
  sending: 'Enviando…',
  sent: 'Enviado',
  failed: 'Falló',
}

// --- Estados del ticket / QR ---
export const TICKET_STATUS = {
  VALID: 'valid', // emitido, aún no ha entrado
  INSIDE: 'inside', // escaneó entrada
  EXITED: 'exited', // escaneó salida — cualquier escaneo posterior es inválido
}

export const TICKET_STATUS_LABEL = {
  valid: 'No ha asistido',
  inside: 'Dentro del evento',
  exited: 'Ya salió',
}

export const HOLDER_TYPE = {
  TITULAR: 'titular',
  COMPANION: 'acompanante',
}

export const HOLDER_TYPE_LABEL = {
  titular: 'Titular',
  acompanante: 'Acompañante',
}

// --- Acciones registradas en la bitácora de escaneos ---
export const SCAN_ACTION = {
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
  REJECTED: 'rejected',
}

// Clases Tailwind por estado. Fuente única de verdad para los badges.
export const STATUS_STYLES = {
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  sent: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  inside: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  rejected: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  failed: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  exited: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  valid: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  not_sent: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  sending: 'bg-belen-blue/5 text-belen-blue ring-1 ring-belen-blue/20',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
}

// Errores de negocio con mensaje ya listo para mostrar al usuario.
export const ERRORS = {
  SLOT_TAKEN:
    'Ese agente ya tiene una cita confirmada en ese día y hora. Elige otro horario u otro agente.',
  ALREADY_REVIEWED: 'Esta solicitud ya fue revisada por otro administrador. Actualiza la página.',
  NOT_FOUND: 'No encontramos el registro solicitado.',
  QR_INVALID: 'QR inválido: esta entrada no existe en el sistema.',
  QR_ALREADY_USED: 'Entrada ya utilizada: este QR ya registró entrada y salida.',
  NOT_ADMIN: 'Tu cuenta no tiene permisos de administrador.',
}

/** Construye el id determinista del documento de bloqueo de slot. */
export const slotId = (day, hour, agentId) => `${day}_${hour}_${agentId}`

/** Formatea el serial correlativo de la entrada: GEN-0001 */
export const formatSerial = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`
