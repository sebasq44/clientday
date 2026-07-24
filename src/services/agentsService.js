import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { COL, RESERVATION_STATUS } from '../lib/constants'
import { clean, isValidEmail } from '../lib/format'

/**
 * CRUD de agentes de venta + compresión de la foto a dataURL base64 (<=200 KB).
 * Todos los errores salen en español, listos para mostrarse al usuario.
 */

/** Tamaño máximo del archivo original que aceptamos del usuario. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024 // 8 MB
/** Tamaño máximo del dataURL resultante que guardamos en Firestore. */
const MAX_OUTPUT_BYTES = 200 * 1024 // 200 KB
/** Calidad mínima a la que estamos dispuestos a bajar. */
const MIN_QUALITY = 0.4

const LOAD_ERROR = 'No se pudieron cargar los asesores. Revisa tu conexión e inténtalo de nuevo.'

const agentsCol = () => collection(db, COL.AGENTS)

/** Peso real en bytes del contenido base64 de un dataURL. */
function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || ''
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function mapAgent(snap) {
  const data = snap.data() || {}
  return {
    id: snap.id,
    name: clean(data.name),
    email: clean(data.email),
    // WhatsApp en 8 dígitos (Costa Rica, +506). Lo usa el escáner para avisar al agente.
    whatsapp: clean(data.whatsapp),
    photoBase64: data.photoBase64 || null,
    active: data.active !== false,
    // Cuenta de acceso al panel (la crea el superadmin desde /admin/agents).
    uid: data.uid ?? null,
    hasAccess: data.hasAccess === true,
    accessEmail: clean(data.accessEmail),
    createdAt: data.createdAt ?? null,
  }
}

/** Valida una foto ya comprimida antes de mandarla a Firestore. */
function sanitizePhoto(photoBase64) {
  if (photoBase64 === null || photoBase64 === undefined || photoBase64 === '') return null
  const value = String(photoBase64)
  if (!value.startsWith('data:image/')) {
    throw new Error('La foto del asesor no tiene un formato válido. Vuelve a seleccionarla.')
  }
  if (dataUrlBytes(value) > MAX_OUTPUT_BYTES) {
    throw new Error('La foto del asesor supera los 200 KB. Vuelve a subirla para que se comprima.')
  }
  return value
}

/**
 * Suscripción en vivo a TODOS los agentes, ordenados por nombre.
 * @param {(agents: object[]) => void} cb
 * @param {(error: Error) => void} [onError] opcional.
 * @returns {() => void} cancela la suscripción.
 */
export function subscribeAgents(cb, onError) {
  const q = query(agentsCol(), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map(mapAgent)),
    (err) => {
      console.error('[agentsService] subscribeAgents', err)
      cb([])
      if (typeof onError === 'function') onError(new Error(LOAD_ERROR))
    },
  )
}

/**
 * Agentes activos, ordenados por nombre. Los filtramos en cliente (son pocos) para no
 * depender de un índice compuesto de Firestore.
 */
export async function listActiveAgents() {
  try {
    const snap = await getDocs(query(agentsCol(), orderBy('name')))
    return snap.docs.map(mapAgent).filter((agent) => agent.active)
  } catch (err) {
    console.error('[agentsService] listActiveAgents', err)
    throw new Error(LOAD_ERROR)
  }
}

/**
 * Normaliza el WhatsApp del agente. Todos los números son de Costa Rica (+506), así que se guardan
 * como 8 dígitos, SIN espacios, guiones ni prefijo. Se acepta que lo peguen con el 506 delante o
 * con separadores: aquí se limpia. Devuelve '' si no hay número.
 * @throws {Error} si el número no tiene 8 dígitos.
 */
export function normalizeWhatsapp(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''

  // Si lo pegaron con el prefijo del país, se lo quitamos.
  const local = digits.startsWith('506') && digits.length > 8 ? digits.slice(3) : digits

  if (local.length !== 8) {
    throw new Error('El WhatsApp debe tener 8 dígitos (formato de Costa Rica, sin espacios ni guiones).')
  }
  return local
}

/** Crea un agente y devuelve su id. */
export async function createAgent({ name, email, whatsapp, photoBase64, active } = {}) {
  const cleanName = clean(name)
  if (!cleanName) throw new Error('El nombre del asesor es obligatorio.')

  const cleanEmail = clean(email)
  if (cleanEmail && !isValidEmail(cleanEmail)) {
    throw new Error('El correo del asesor no es válido.')
  }

  const cleanWhatsapp = normalizeWhatsapp(whatsapp)
  const photo = sanitizePhoto(photoBase64)

  try {
    const ref = await addDoc(agentsCol(), {
      name: cleanName,
      email: cleanEmail,
      whatsapp: cleanWhatsapp,
      photoBase64: photo,
      active: active !== false,
      createdAt: serverTimestamp(),
    })
    return ref.id
  } catch (err) {
    console.error('[agentsService] createAgent', err)
    throw new Error('No se pudo crear el asesor. Revisa tu conexión y tus permisos de administrador.')
  }
}

/** Actualiza los campos indicados de un agente. */
export async function updateAgent(id, patch) {
  const agentId = clean(id)
  if (!agentId) throw new Error('No encontramos el asesor que quieres actualizar.')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('No hay cambios que guardar en el asesor.')
  }

  const payload = {}

  if ('name' in patch) {
    const cleanName = clean(patch.name)
    if (!cleanName) throw new Error('El nombre del asesor es obligatorio.')
    payload.name = cleanName
  }

  if ('email' in patch) {
    const cleanEmail = clean(patch.email)
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      throw new Error('El correo del asesor no es válido.')
    }
    payload.email = cleanEmail
  }

  if ('whatsapp' in patch) payload.whatsapp = normalizeWhatsapp(patch.whatsapp)
  if ('photoBase64' in patch) payload.photoBase64 = sanitizePhoto(patch.photoBase64)
  if ('active' in patch) payload.active = Boolean(patch.active)

  if (Object.keys(payload).length === 0) {
    throw new Error('No hay cambios que guardar en el asesor.')
  }

  try {
    await updateDoc(doc(db, COL.AGENTS, agentId), payload)
  } catch (err) {
    console.error('[agentsService] updateAgent', err)
    throw new Error('No se pudo guardar el asesor. Revisa tu conexión y tus permisos de administrador.')
  }
}

/**
 * Elimina un agente. Si tiene reservas APROBADAS no se puede borrar: se perdería la
 * trazabilidad de las entradas ya emitidas, así que se pide desactivarlo en su lugar.
 * Con reservas solo pendientes/rechazadas sí se permite el borrado.
 */
export async function deleteAgent(id) {
  const agentId = clean(id)
  if (!agentId) throw new Error('No encontramos el asesor que quieres eliminar.')

  let approvedSnap
  try {
    approvedSnap = await getDocs(
      query(
        collection(db, COL.RESERVATIONS),
        where('agentId', '==', agentId),
        where('status', '==', RESERVATION_STATUS.APPROVED),
        limit(1),
      ),
    )
  } catch (err) {
    console.error('[agentsService] deleteAgent (check)', err)
    throw new Error('No se pudo verificar si el asesor tiene reservas aprobadas. Inténtalo de nuevo.')
  }

  if (!approvedSnap.empty) {
    throw new Error(
      'No puedes eliminar este asesor porque tiene reservas aprobadas con entradas ya emitidas. ' +
        'Desactívalo para que deje de aparecer en el formulario público y conserve su historial.',
    )
  }

  try {
    await deleteDoc(doc(db, COL.AGENTS, agentId))
  } catch (err) {
    console.error('[agentsService] deleteAgent', err)
    throw new Error('No se pudo eliminar el asesor. Revisa tu conexión y tus permisos de administrador.')
  }
}

/**
 * Comprime una imagen a un dataURL JPEG completo ('data:image/jpeg;base64,...') de <=200 KB.
 * Reescala a `maxWidth` conservando la proporción y baja la calidad de 0.1 en 0.1 (mínimo 0.4)
 * hasta que el resultado quepa en el límite.
 * @param {File|Blob} file
 * @param {number} [maxWidth=400]
 * @param {number} [quality=0.82]
 * @returns {Promise<string>} dataURL completo.
 */
export function compressImageToBase64(file, maxWidth = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || typeof file !== 'object' || typeof file.type !== 'string') {
      reject(new Error('No se recibió ninguna imagen. Selecciona un archivo.'))
      return
    }
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo seleccionado no es una imagen. Usa un JPG o un PNG.'))
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error('La imagen pesa más de 8 MB. Elige una más liviana.'))
      return
    }

    const reader = new FileReader()

    reader.onerror = () => {
      reject(new Error('No se pudo leer el archivo de imagen. Inténtalo de nuevo.'))
    }

    reader.onload = () => {
      const image = new Image()

      image.onerror = () => {
        reject(new Error('No se pudo procesar la imagen. Puede estar dañada; prueba con otra.'))
      }

      image.onload = () => {
        try {
          const sourceWidth = image.naturalWidth || image.width
          const sourceHeight = image.naturalHeight || image.height
          if (!sourceWidth || !sourceHeight) {
            reject(new Error('No se pudo procesar la imagen. Puede estar dañada; prueba con otra.'))
            return
          }

          const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1
          const width = Math.max(1, Math.round(sourceWidth * scale))
          const height = Math.max(1, Math.round(sourceHeight * scale))

          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height

          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Tu navegador no permite procesar imágenes. Prueba con otro navegador.'))
            return
          }

          // El JPEG no tiene transparencia: pintamos el fondo en blanco para que los PNG
          // con alpha no salgan con manchas negras.
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(image, 0, 0, width, height)

          let currentQuality = Math.min(Math.max(Number(quality) || 0.82, MIN_QUALITY), 1)
          let dataUrl = canvas.toDataURL('image/jpeg', currentQuality)

          while (dataUrlBytes(dataUrl) > MAX_OUTPUT_BYTES && currentQuality > MIN_QUALITY) {
            currentQuality = Math.max(MIN_QUALITY, Math.round((currentQuality - 0.1) * 100) / 100)
            dataUrl = canvas.toDataURL('image/jpeg', currentQuality)
          }

          if (dataUrlBytes(dataUrl) > MAX_OUTPUT_BYTES) {
            reject(
              new Error(
                'No pudimos comprimir la foto por debajo de 200 KB. Prueba con una imagen de menor resolución.',
              ),
            )
            return
          }

          resolve(dataUrl)
        } catch (err) {
          console.error('[agentsService] compressImageToBase64', err)
          reject(new Error('No se pudo procesar la imagen. Inténtalo de nuevo con otro archivo.'))
        }
      }

      image.src = String(reader.result)
    }

    reader.readAsDataURL(file)
  })
}
