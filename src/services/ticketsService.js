import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import QRCode from 'qrcode'

import { db } from '../lib/firebase'
import { COL, ERRORS } from '../lib/constants'
import { clean } from '../lib/format'

/**
 * Opciones del QR. El contenido del código es EXACTAMENTE el qrToken, nada más
 * (ni URLs ni JSON): así el escáner puede resolverlo sin parsear.
 */
const QR_OPTIONS = {
  margin: 1,
  width: 320,
  errorCorrectionLevel: 'M',
  color: { dark: '#1B3B8B', light: '#FFFFFF' },
}

/** Normaliza un snapshot de ticket a objeto plano con id. */
function mapTicket(snapshot) {
  return { id: snapshot.id, ...snapshot.data() }
}

/** Ordena por serial (GEN-0001, GEN-0002…) de forma estable. */
function bySerial(a, b) {
  return String(a.serial ?? '').localeCompare(String(b.serial ?? ''), 'es', { numeric: true })
}

/**
 * Genera el PNG del QR como dataURL completo: 'data:image/png;base64,...'
 * Se usa para pintarlo en pantalla y para imprimir la entrada.
 * @param {string} token qrToken del ticket
 * @returns {Promise<string>}
 */
export async function generateQrDataUrl(token) {
  const value = clean(token)
  if (!value) throw new Error('No se pudo generar el QR: la entrada no tiene token.')

  try {
    return await QRCode.toDataURL(value, QR_OPTIONS)
  } catch (error) {
    console.error('[ticketsService] generateQrDataUrl', error)
    throw new Error('No se pudo generar el código QR de la entrada.')
  }
}

/**
 * El MISMO PNG del QR pero en base64 crudo, sin el prefijo 'data:image/png;base64,'.
 * Es lo que espera Apps Script para incrustar la imagen inline (CID) en el correo (§11).
 * @param {string} token qrToken del ticket
 * @returns {Promise<string>}
 */
export async function generateQrBase64(token) {
  const dataUrl = await generateQrDataUrl(token)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (!base64) throw new Error('No se pudo generar el código QR de la entrada.')
  return base64
}

/**
 * Suscripción en tiempo real a todas las entradas emitidas, ordenadas por serial.
 * @param {(tickets: object[]) => void} cb
 * @returns {() => void} función para cancelar la suscripción
 */
export function subscribeTickets(cb) {
  const q = query(collection(db, COL.TICKETS), orderBy('serial', 'asc'))
  return onSnapshot(
    q,
    (snapshot) => cb(snapshot.docs.map(mapTicket)),
    (error) => {
      console.error('[ticketsService] subscribeTickets', error)
      cb([])
    }
  )
}

/**
 * Entradas de una reserva concreta (1 titular + 0-1 acompañante), ordenadas por serial.
 * @param {string} reservationId
 * @returns {Promise<object[]>}
 */
export async function getTicketsByReservation(reservationId) {
  const id = clean(reservationId)
  if (!id) throw new Error(ERRORS.NOT_FOUND)

  try {
    const snapshot = await getDocs(
      query(collection(db, COL.TICKETS), where('reservationId', '==', id))
    )
    return snapshot.docs.map(mapTicket).sort(bySerial)
  } catch (error) {
    console.error('[ticketsService] getTicketsByReservation', error)
    throw new Error('No se pudieron cargar las entradas de esta reserva.')
  }
}

/**
 * Marca que esta entrada RECIBIÓ un premio en el evento. Se hace a mano desde la lista de
 * Asistencia (no hay QR de premio). `prizeAt` con fecha = ya lo recibió.
 *
 * @param {string} ticketId
 * @param {string} adminUid quién lo entregó
 */
export async function markPrizeAwarded(ticketId, adminUid) {
  const id = clean(ticketId)
  if (!id) throw new Error(ERRORS.NOT_FOUND)

  try {
    await updateDoc(doc(db, COL.TICKETS, id), {
      prizeAt: serverTimestamp(),
      prizeBy: adminUid ?? null,
    })
  } catch (error) {
    console.error('[ticketsService] markPrizeAwarded', error)
    throw new Error('No se pudo registrar el premio. Revisa tu conexión y tus permisos.')
  }
}

/** Deshace la marca de premio (por si se marcó por error). */
export async function removePrizeAwarded(ticketId) {
  const id = clean(ticketId)
  if (!id) throw new Error(ERRORS.NOT_FOUND)

  try {
    await updateDoc(doc(db, COL.TICKETS, id), { prizeAt: null, prizeBy: null })
  } catch (error) {
    console.error('[ticketsService] removePrizeAwarded', error)
    throw new Error('No se pudo quitar el premio. Revisa tu conexión y tus permisos.')
  }
}
