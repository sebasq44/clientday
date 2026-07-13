/** Utilidades de formato. Todo en español (es-CR / es-419). */

/** Convierte un Timestamp de Firestore, Date o millis a Date. Devuelve null si no hay valor. */
export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  if (typeof value === 'number') return new Date(value)
  return null
}

/** 8 sept 2026, 10:32 */
export function formatDateTime(value) {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleString('es-CR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 10:32 a. m. */
export function formatTime(value) {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
}

/** '10:00' -> '10:00 a. m.' — el rango de la cita dura 1 hora. */
export function formatHourRange(hour) {
  if (!hour) return '—'
  const [h, m] = hour.split(':').map(Number)
  const end = (h + 1) % 24
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)} — ${pad(end)}:${pad(m)}`
}

/** Busca la etiqueta legible de un día dentro de config.days */
export function dayLabel(config, dayId) {
  const day = config?.days?.find((d) => d.id === dayId)
  return day?.label ?? dayId ?? '—'
}

/** Busca la letra (M / K) de un día dentro de config.days */
export function dayLetter(config, dayId) {
  const day = config?.days?.find((d) => d.id === dayId)
  return day?.letter ?? ''
}

/** Valida un correo con una expresión razonable (no exhaustiva, pero suficiente). */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim())
}

/** Quita espacios y normaliza a una sola línea. */
export function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

/** Genera un token único para el QR (uuid v4, con respaldo si crypto no está disponible). */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Escapa un valor para exportarlo a CSV. */
export function csvCell(value) {
  const s = String(value ?? '')
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
