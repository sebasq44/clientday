/**
 * resetService — «Reiniciar Día del Cliente».
 *
 * Deja el sistema como recién instalado, para poder organizar el evento del año siguiente:
 *   · BORRA: reservas, entradas (tickets), bloqueos de horario (slots), bitácora de escaneos,
 *            agentes de venta, y TODOS los usuarios del panel EXCEPTO el superadmin que ejecuta.
 *   · REINICIA: la configuración del evento a sus valores por defecto y el correlativo de
 *               seriales a 1.
 *
 * OPERACIÓN IRREVERSIBLE. No hay papelera ni deshacer: quien la llame debe haber confirmado dos veces.
 *
 * LÍMITE CONOCIDO: las cuentas de Firebase Authentication (correo/contraseña) de agentes y de
 * seguridad NO se pueden eliminar desde el navegador (haría falta el Admin SDK en un servidor).
 * Al borrar su documento de `admins` se quedan SIN NINGÚN PERMISO —no pueden entrar al panel—,
 * pero la cuenta sigue existiendo en la consola de Firebase. Si se quiere limpiar del todo, hay
 * que borrarlas a mano en Authentication > Users.
 */
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'

import { db } from '../lib/firebase'
import { COL, CONFIG_DOC, TICKET_COUNTER_DOC } from '../lib/constants'
import { DEFAULT_CONFIG } from '../lib/seed'

/** Un lote de Firestore admite 500 operaciones. Dejamos margen. */
const BATCH_SIZE = 400

/** Palabra que el administrador debe teclear para confirmar. */
export const RESET_CONFIRMATION_WORD = 'REINICIAR'

/**
 * Borra todos los documentos de una colección, en lotes.
 * @param {string} collectionName
 * @param {(id: string) => boolean} [keep] devuelve true para CONSERVAR ese documento
 * @returns {Promise<number>} cuántos documentos se borraron
 */
async function deleteCollection(collectionName, keep) {
  const snapshot = await getDocs(collection(db, collectionName))

  const targets = snapshot.docs.filter((d) => (keep ? !keep(d.id) : true))
  let deleted = 0

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const target of targets.slice(i, i + BATCH_SIZE)) {
      batch.delete(target.ref)
    }
    await batch.commit()
    deleted += Math.min(BATCH_SIZE, targets.length - i)
  }

  return deleted
}

/**
 * Reinicia el evento por completo.
 *
 * @param {string} currentUid uid del superadmin que ejecuta (su cuenta NO se toca)
 * @param {(step: string) => void} [onProgress] para ir informando en la interfaz
 * @returns {Promise<{reservations:number, tickets:number, slots:number, scans:number, agents:number, users:number}>}
 */
export async function resetEvent(currentUid, onProgress = () => {}) {
  if (!currentUid) {
    throw new Error('No se pudo identificar tu sesión. Vuelve a iniciar sesión e inténtalo de nuevo.')
  }

  const result = { reservations: 0, tickets: 0, slots: 0, scans: 0, agents: 0, users: 0 }

  try {
    // El orden importa poco (no hay integridad referencial), pero borramos primero lo que más
    // crece, para que si algo falla a medias el sistema quede en un estado más limpio.
    onProgress('Borrando entradas y códigos QR…')
    result.tickets = await deleteCollection(COL.TICKETS)

    onProgress('Borrando la bitácora de escaneos…')
    result.scans = await deleteCollection(COL.SCANS)

    onProgress('Borrando las reservas…')
    result.reservations = await deleteCollection(COL.RESERVATIONS)

    onProgress('Liberando los horarios ocupados…')
    result.slots = await deleteCollection(COL.SLOTS)

    onProgress('Borrando los asesores comerciales…')
    result.agents = await deleteCollection(COL.AGENTS)

    // Los usuarios del panel: se borran TODOS menos el superadmin que está ejecutando esto.
    onProgress('Borrando las cuentas de asesores y de seguridad…')
    result.users = await deleteCollection(COL.ADMINS, (id) => id === currentUid)

    onProgress('Restaurando la configuración del evento…')
    await setDoc(doc(db, COL.CONFIG, CONFIG_DOC), {
      ...DEFAULT_CONFIG,
      updatedAt: serverTimestamp(),
    })

    onProgress('Reiniciando el número de las entradas…')
    await setDoc(doc(db, COL.COUNTERS, TICKET_COUNTER_DOC), { next: 1 })

    onProgress('Listo.')
    return result
  } catch (error) {
    console.error('[resetService] resetEvent', error)
    throw new Error(
      'El reinicio se interrumpió: ' +
        (error?.message || 'error desconocido') +
        '. Puede que se hayan borrado datos parcialmente. Revisa e inténtalo de nuevo.',
    )
  }
}
