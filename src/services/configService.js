import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { COL, CONFIG_DOC } from '../lib/constants'
import { DEFAULT_CONFIG } from '../lib/seed'
import { clean } from '../lib/format'

/**
 * Parámetros del evento: documento único `config/general`.
 * Los mensajes de error salen en español, ya listos para mostrarse en un Toast.
 */

const configRef = () => doc(db, COL.CONFIG, CONFIG_DOC)

const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_ID_RE = /^\d{4}-\d{2}-\d{2}$/

const LOAD_ERROR =
  'No se pudo cargar la configuración del evento. Revisa tu conexión e inténtalo de nuevo.'
const MISSING_ERROR =
  'La configuración del evento aún no existe. Inicia sesión en el panel de administración para crearla.'
const SAVE_ERROR =
  'No se pudo guardar la configuración. Revisa tu conexión y tus permisos de administrador.'

/**
 * Rellena los huecos con los valores por defecto para que ninguna vista reviente
 * si el documento fue editado a mano o le falta un campo nuevo.
 */
function normalizeConfig(data) {
  const raw = data || {}
  const days = Array.isArray(raw.days)
    ? raw.days
        .filter((d) => d && clean(d.id))
        .map((d) => ({
          id: clean(d.id),
          label: clean(d.label) || clean(d.id),
          letter: clean(d.letter).toUpperCase().slice(0, 1),
          enabled: d.enabled !== false,
        }))
    : DEFAULT_CONFIG.days

  const hours = Array.isArray(raw.hours)
    ? raw.hours.map((h) => clean(h)).filter((h) => HOUR_RE.test(h))
    : DEFAULT_CONFIG.hours

  return {
    ...DEFAULT_CONFIG,
    ...raw,
    eventName: clean(raw.eventName) || DEFAULT_CONFIG.eventName,
    eventYear: Number(raw.eventYear) || DEFAULT_CONFIG.eventYear,
    tagline: clean(raw.tagline) || DEFAULT_CONFIG.tagline,
    formOpen: raw.formOpen !== false,
    allowCompanion: raw.allowCompanion !== false,
    masterclassEnabled: raw.masterclassEnabled !== false,
    days,
    hours,
    ticketPrefix: clean(raw.ticketPrefix).toUpperCase() || DEFAULT_CONFIG.ticketPrefix,
    updatedAt: raw.updatedAt ?? null,
  }
}

/** Lectura puntual de la configuración. Lanza Error en español si no existe o falla la red. */
export async function getConfig() {
  let snap
  try {
    snap = await getDoc(configRef())
  } catch (err) {
    console.error('[configService] getConfig', err)
    throw new Error(LOAD_ERROR)
  }
  if (!snap.exists()) throw new Error(MISSING_ERROR)
  return normalizeConfig(snap.data())
}

/**
 * Suscripción en vivo a `config/general`.
 * @param {(config: object|null) => void} cb  recibe la config normalizada, o null si no existe.
 * @param {(error: Error) => void} [onError]  opcional; recibe el fallo ya traducido.
 * @returns {() => void} función para cancelar la suscripción.
 */
export function subscribeConfig(cb, onError) {
  return onSnapshot(
    configRef(),
    (snap) => {
      cb(snap.exists() ? normalizeConfig(snap.data()) : null)
    },
    (err) => {
      console.error('[configService] subscribeConfig', err)
      cb(null)
      if (typeof onError === 'function') onError(new Error(LOAD_ERROR))
    },
  )
}

function sanitizeDays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Debes configurar al menos un día del evento.')
  }
  const seen = new Set()
  return value.map((day) => {
    const id = clean(day?.id)
    const label = clean(day?.label)
    const letter = clean(day?.letter).toUpperCase().slice(0, 1)

    if (!DAY_ID_RE.test(id)) {
      throw new Error('La fecha de cada día debe tener el formato AAAA-MM-DD (por ejemplo 2026-09-08).')
    }
    if (seen.has(id)) {
      throw new Error(`El día ${id} está repetido. Cada fecha solo puede aparecer una vez.`)
    }
    seen.add(id)
    if (!label) {
      throw new Error(`El día ${id} necesita un nombre visible (por ejemplo "8 Septiembre").`)
    }
    if (!letter) {
      throw new Error(`El día "${label}" necesita una letra identificadora (por ejemplo M o K).`)
    }
    return { id, label, letter, enabled: day?.enabled !== false }
  })
}

function sanitizeHours(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Debes configurar al menos una hora de cita.')
  }
  const hours = []
  value.forEach((raw) => {
    const hour = clean(raw)
    if (!HOUR_RE.test(hour)) {
      throw new Error(`La hora "${hour || '(vacía)'}" no es válida. Usa el formato HH:mm, por ejemplo 09:00.`)
    }
    if (!hours.includes(hour)) hours.push(hour)
  })
  return hours.sort()
}

/**
 * Guarda cambios parciales de la configuración (merge) y sella `updatedAt`.
 * Valida cada campo y lanza Error en español si algo no cuadra.
 */
export async function updateConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('No hay cambios que guardar en la configuración.')
  }

  const payload = {}

  if ('eventName' in patch) {
    const eventName = clean(patch.eventName)
    if (!eventName) throw new Error('El nombre del evento no puede quedar vacío.')
    payload.eventName = eventName
  }

  if ('eventYear' in patch) {
    const eventYear = Number(patch.eventYear)
    if (!Number.isInteger(eventYear) || eventYear < 2020 || eventYear > 2100) {
      throw new Error('El año del evento debe ser un número entre 2020 y 2100.')
    }
    payload.eventYear = eventYear
  }

  if ('tagline' in patch) payload.tagline = clean(patch.tagline)
  if ('formOpen' in patch) payload.formOpen = Boolean(patch.formOpen)
  if ('allowCompanion' in patch) payload.allowCompanion = Boolean(patch.allowCompanion)
  if ('masterclassEnabled' in patch) payload.masterclassEnabled = Boolean(patch.masterclassEnabled)
  if ('days' in patch) payload.days = sanitizeDays(patch.days)
  if ('hours' in patch) payload.hours = sanitizeHours(patch.hours)

  if ('ticketPrefix' in patch) {
    const ticketPrefix = clean(patch.ticketPrefix).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!ticketPrefix) {
      throw new Error('El prefijo de la entrada es obligatorio (solo letras y números, por ejemplo GEN).')
    }
    if (ticketPrefix.length > 6) {
      throw new Error('El prefijo de la entrada no puede tener más de 6 caracteres.')
    }
    payload.ticketPrefix = ticketPrefix
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('No hay cambios válidos que guardar en la configuración.')
  }

  payload.updatedAt = serverTimestamp()

  try {
    await setDoc(configRef(), payload, { merge: true })
  } catch (err) {
    console.error('[configService] updateConfig', err)
    throw new Error(SAVE_ERROR)
  }
}
