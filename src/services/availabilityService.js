import { collection, getDocs, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { COL, slotId } from '../lib/constants'

/**
 * Disponibilidad = colección `slots`. La sola existencia del documento
 * `${day}_${hour}_${agentId}` significa OCUPADO (el id ya es esa clave, así que no hace
 * falta leer los campos del documento).
 */

const LOAD_ERROR =
  'No se pudo cargar la disponibilidad de los agentes. Revisa tu conexión e inténtalo de nuevo.'

const slotsCol = () => collection(db, COL.SLOTS)

/**
 * Suscripción en vivo a los slots ocupados.
 * @param {(occupied: Set<string>) => void} cb  recibe un Set con los slotId ocupados.
 * @param {(error: Error) => void} [onError] opcional.
 * @returns {() => void} cancela la suscripción.
 */
export function subscribeOccupiedSlots(cb, onError) {
  return onSnapshot(
    slotsCol(),
    (snap) => cb(new Set(snap.docs.map((d) => d.id))),
    (err) => {
      console.error('[availabilityService] subscribeOccupiedSlots', err)
      cb(new Set())
      if (typeof onError === 'function') onError(new Error(LOAD_ERROR))
    },
  )
}

/** Lectura puntual de los slots ocupados. */
export async function getOccupiedSlots() {
  try {
    const snap = await getDocs(slotsCol())
    return new Set(snap.docs.map((d) => d.id))
  } catch (err) {
    console.error('[availabilityService] getOccupiedSlots', err)
    throw new Error(LOAD_ERROR)
  }
}

/** ¿Está ocupado ese (día, hora, agente) dentro del Set devuelto por las funciones de arriba? */
export function isSlotOccupied(occupied, day, hour, agentId) {
  if (!occupied || !day || !hour || !agentId) return false
  return occupied.has(slotId(day, hour, agentId))
}
