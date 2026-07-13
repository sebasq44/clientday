import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET } from '../lib/firebase'
import { COL, EMAIL_STATUS } from '../lib/constants'
import { dayLabel, dayLetter } from '../lib/format'
import { generateQrBase64 } from './ticketsService'

/**
 * Envío de las entradas por correo.
 *
 * El correo NO se manda desde el navegador: se hace un POST a un Web App de Google Apps Script
 * (ver apps-script/Codigo.gs) que es quien construye el HTML, incrusta los QR y usa GmailApp.
 *
 * Detalle importante: el POST va con Content-Type 'text/plain;charset=utf-8' A PROPÓSITO.
 * Es una "simple request" y por tanto el navegador NO lanza el preflight OPTIONS, que Apps Script
 * no sabe responder. El cuerpo sigue siendo JSON; el script lo parsea con JSON.parse().
 */

const NOT_CONFIGURED_MESSAGE =
  'El envío de correos no está configurado. Despliega apps-script/Codigo.gs como aplicación web y pega la URL resultante en APPS_SCRIPT_URL, dentro de src/lib/firebase.js.'

const UNEXPECTED_RESPONSE_MESSAGE =
  'El servicio de correo devolvió una respuesta inesperada. Revisa que la aplicación web de Apps Script esté desplegada con «Ejecutar como: yo» y «Con acceso: cualquier usuario, incluso anónimo».'

/** ¿Está configurada la URL del Web App de Apps Script? */
export function isEmailConfigured() {
  return typeof APPS_SCRIPT_URL === 'string' && APPS_SCRIPT_URL.trim().length > 0
}

/**
 * Escribe el estado del correo en la reserva. Si esta escritura falla (la reserva se borró,
 * se cayó la red) no tumbamos el envío: lo registramos y seguimos, porque el resultado real
 * del envío ya lo devuelve sendInvitation().
 */
async function setEmailStatus(reservationId, patch) {
  if (!reservationId) return
  try {
    await updateDoc(doc(db, COL.RESERVATIONS, reservationId), patch)
  } catch (error) {
    console.error('No se pudo actualizar el estado del correo de la reserva:', error)
  }
}

/** Cuerpo JSON del §11 del contrato. `qrPng` va en base64 CRUDO, sin el prefijo data:. */
function buildPayload(reservation, tickets, config, qrPngs) {
  return {
    secret: APPS_SCRIPT_SECRET,
    to: String(reservation.email || '').trim(),
    reservation: {
      fullName: String(reservation.fullName || ''),
      companyName: String(reservation.companyName || ''),
      clientCode: String(reservation.clientCode || ''),
      agentName: String(reservation.agentName || ''),
      dayLabel: dayLabel(config, reservation.day),
      dayLetter: dayLetter(config, reservation.day),
      hour: String(reservation.hour || ''),
      masterclass: Boolean(reservation.masterclass),
    },
    tickets: tickets.map((ticket, index) => ({
      serial: String(ticket.serial || ''),
      holderName: String(ticket.holderName || ''),
      holderType: String(ticket.holderType || ''),
      qrPng: qrPngs[index],
    })),
  }
}

/**
 * Envía por correo las entradas de una reserva ya aprobada.
 *
 * Marca reservations/{id}.emailStatus como 'sending' antes de salir a la red y luego lo deja
 * en 'sent' (con emailSentAt) o en 'failed' (con emailError). Nunca lanza: siempre devuelve
 * el resultado, para que el panel pueda ofrecer el botón «Reenviar correo».
 *
 * @param {object} reservation reserva con id (la de Firestore, ya aprobada)
 * @param {object[]} tickets entradas emitidas (con serial y qrToken)
 * @param {object} config config/general (de ahí salen dayLabel y dayLetter)
 * @returns {Promise<{ ok: boolean, sent: number, error: string }>}
 */
export async function sendInvitation(reservation, tickets, config) {
  const reservationId = reservation?.id

  // Sin URL no hay nada que intentar: dejamos la reserva en 'failed' con la instrucción exacta.
  if (!isEmailConfigured()) {
    await setEmailStatus(reservationId, {
      emailStatus: EMAIL_STATUS.FAILED,
      emailError: NOT_CONFIGURED_MESSAGE,
    })
    return { ok: false, sent: 0, error: NOT_CONFIGURED_MESSAGE }
  }

  try {
    if (!reservationId) {
      throw new Error('La reserva no tiene identificador: no podemos enviar el correo.')
    }
    if (!String(reservation.email || '').trim()) {
      throw new Error('La reserva no tiene un correo de destino al que enviar la entrada.')
    }
    if (!Array.isArray(tickets) || tickets.length === 0) {
      throw new Error('Esta reserva todavía no tiene entradas emitidas.')
    }

    await setEmailStatus(reservationId, {
      emailStatus: EMAIL_STATUS.SENDING,
      emailError: '',
    })

    // Los QR se generan aquí, en el navegador, y viajan en base64 crudo dentro del JSON.
    const qrPngs = await Promise.all(tickets.map((ticket) => generateQrBase64(ticket.qrToken)))
    const payload = buildPayload(reservation, tickets, config, qrPngs)

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    })

    const raw = await response.text()

    if (!response.ok) {
      throw new Error(
        `El servicio de correo respondió con un error (HTTP ${response.status}). Revisa el despliegue del Apps Script.`
      )
    }

    let data
    try {
      data = JSON.parse(raw)
    } catch (parseError) {
      console.error('Respuesta no-JSON del Apps Script:', raw, parseError)
      throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
    }

    if (!data || data.ok !== true) {
      throw new Error(data?.error || 'El servicio de correo no pudo enviar la invitación.')
    }

    const sent = Number(data.sent) || tickets.length

    await setEmailStatus(reservationId, {
      emailStatus: EMAIL_STATUS.SENT,
      emailSentAt: serverTimestamp(),
      emailError: '',
    })

    return { ok: true, sent, error: '' }
  } catch (error) {
    const message = error?.message || 'No pudimos enviar el correo con la entrada.'
    await setEmailStatus(reservationId, {
      emailStatus: EMAIL_STATUS.FAILED,
      emailError: message,
    })
    return { ok: false, sent: 0, error: message }
  }
}
