/**
 * scanService — control de acceso en la puerta del evento.
 *
 * Máquina de estados del ticket (§5 de ARCHITECTURE.md):
 *   valid  --1er escaneo-->  inside   (check_in,  checkInAt)
 *   inside --2º  escaneo-->  exited   (check_out, checkOutAt)
 *   exited --3er escaneo-->  RECHAZADO (el ticket NO cambia, solo se registra el intento)
 *   QR que no existe      ->  RECHAZADO ("QR inválido")
 *
 * Todo intento —válido o no— queda registrado en la colección `scans` para auditoría.
 */
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'

import { db } from '../lib/firebase'
import { COL, ERRORS, SCAN_ACTION, TICKET_STATUS } from '../lib/constants'
import { toDate } from '../lib/format'

/** Cuántos escaneos muestra la bitácora en vivo. */
const SCAN_LOG_LIMIT = 50

/**
 * Ventana de gracia tras un ingreso. Si un QR que acaba de registrar ENTRADA se vuelve a escanear
 * dentro de este lapso, NO se interpreta como salida: es el mismo evento físico leído dos veces
 * (dos porteros / dos teléfonos, o un doble disparo de la cámara). Sin esto, cuando dos lecturas
 * casi simultáneas del mismo QR válido chocan, Firestore reejecuta la 2ª transacción, que ya ve
 * 'inside' y convertiría el ingreso recién hecho en una salida espuria.
 */
const REENTRY_GUARD_MS = 8000

/** Motivos de rechazo tal como quedan escritos en `scans.reason`. */
const REASON = {
  EMPTY: 'QR vacío',
  NOT_FOUND: 'QR no encontrado',
  ALREADY_USED: ERRORS.QR_ALREADY_USED,
  UNKNOWN_STATUS: 'Estado de entrada desconocido',
  JUST_CHECKED_IN: 'La entrada acaba de registrar ingreso',
  MEAL_ALREADY_TAKEN: 'Ya retiró su comida',
  MEAL_NOT_INSIDE: 'No ha registrado su entrada al evento',
  MEAL_EXITED: 'Ya salió del evento',
}

/** Mensaje que ve el portero cuando el QR ya registró ingreso hace apenas unos segundos. */
const JUST_CHECKED_IN_MESSAGE = 'La entrada ya registró ingreso hace un momento.'

/** Mensaje que ve el portero cuando falla la red o las reglas de Firestore. */
const SCAN_FAILURE_MESSAGE =
  'No se pudo procesar el escaneo. Revisa la conexión e inténtalo de nuevo.'

/**
 * Tope de espera para resolver un escaneo. Si Firestore no responde en este lapso (WiFi del local
 * saturado, reintentos internos de la transacción), cortamos y mostramos un mensaje claro en vez de
 * dejar al portero mirando el spinner 30 segundos. La operación de fondo puede completarse después:
 * la máquina de estados del ticket es atómica, así que no se corrompe nada, y la lista en vivo se
 * actualiza sola cuando llegue.
 */
const SCAN_TIMEOUT_MS = 12000

/** Mensaje cuando el escaneo tardó más de SCAN_TIMEOUT_MS. */
const SCAN_SLOW_MESSAGE =
  'La conexión está lenta y no respondió a tiempo. Vuelve a escanear el código.'

/**
 * Corre `promise` contra un reloj. Si vence primero, resuelve con { __timedOut: true } (nunca
 * rechaza). No cancela la promesa original —Firestore no es cancelable—, solo deja de esperarla.
 */
function withTimeout(promise, ms) {
  let timer
  const clock = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), ms)
  })
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer))
}

/** Los lectores de QR suelen devolver espacios o saltos de línea alrededor del token. */
function normalizeToken(qrToken) {
  return String(qrToken ?? '').trim()
}

/** Da forma al ticket que consume la UI (documento + id). */
function mapTicket(id, data) {
  return { id, ...data }
}

/**
 * Escribe un intento de escaneo en la bitácora. Se usa solo en los caminos que NO pasan por la
 * transacción (QR vacío o inexistente); dentro de la transacción el scan se escribe con el mismo
 * `tx` para que ticket y bitácora queden atómicamente sincronizados.
 * Nunca hace fallar el escaneo: la auditoría no debe bloquear la puerta.
 */
async function logScanAttempt({ ticketId, serial, action, reason, scannedBy }) {
  try {
    await addDoc(collection(db, COL.SCANS), {
      ticketId: ticketId ?? null,
      serial: serial ?? '',
      action,
      reason: reason ?? '',
      scannedAt: serverTimestamp(),
      scannedBy: scannedBy ?? null,
    })
  } catch (error) {
    console.error('[scanService] No se pudo registrar el escaneo en la bitácora:', error)
  }
}

/**
 * Resuelve un QR: registra entrada, registra salida o rechaza.
 *
 * @param {string} qrToken  contenido crudo del QR (el uuid del ticket, nada más)
 * @param {string} adminUid uid del administrador que escanea
 * @returns {Promise<{ ok: boolean, action: 'check_in'|'check_out'|'rejected', ticket: object|null, message: string }>}
 */
export async function processScan(qrToken, adminUid) {
  const token = normalizeToken(qrToken)
  const scannedBy = adminUid ?? null

  // 0) QR vacío: ni siquiera hay que ir a la base de datos.
  if (!token) {
    await logScanAttempt({
      ticketId: null,
      serial: '',
      action: SCAN_ACTION.REJECTED,
      reason: REASON.EMPTY,
      scannedBy,
    })
    return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: ERRORS.QR_INVALID }
  }

  try {
    // Toda la resolución (query + transacción) corre contra un reloj: si el local tiene la red
    // saturada, cortamos en SCAN_TIMEOUT_MS en vez de colgarnos medio minuto.
    const outcome = await withTimeout(resolveScanFromDb(token, scannedBy), SCAN_TIMEOUT_MS)

    if (outcome.__timedOut) {
      // No esperamos a la bitácora: registrar el timeout no debe, a su vez, colgarse.
      logScanAttempt({
        ticketId: null,
        serial: '',
        action: SCAN_ACTION.REJECTED,
        reason: 'Tiempo de espera agotado',
        scannedBy,
      })
      return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: SCAN_SLOW_MESSAGE }
    }

    return outcome
  } catch (error) {
    // Fallo de infraestructura (red, permisos, transacción agotada). No rompemos la fila de la
    // puerta con una excepción: devolvemos un rechazo explicable y dejamos rastro en la bitácora.
    console.error('[scanService] Error procesando el escaneo:', error)
    await logScanAttempt({
      ticketId: null,
      serial: '',
      action: SCAN_ACTION.REJECTED,
      reason: `Error técnico: ${error?.message || 'desconocido'}`,
      scannedBy,
    })
    return {
      ok: false,
      action: SCAN_ACTION.REJECTED,
      ticket: null,
      message: SCAN_FAILURE_MESSAGE,
    }
  }
}

/**
 * Resuelve el escaneo contra Firestore: busca el ticket por su qrToken y aplica la máquina de
 * estados dentro de una transacción. Devuelve SIEMPRE el objeto-resultado que consume la UI
 * (nunca lanza para los casos previsibles; los de infraestructura suben al catch de processScan).
 */
async function resolveScanFromDb(token, scannedBy) {
  {
    // 1) Las queries NO se permiten dentro de una transacción: resolvemos el id aquí fuera.
    const snap = await getDocs(
      query(collection(db, COL.TICKETS), where('qrToken', '==', token), limit(1))
    )

    if (snap.empty) {
      await logScanAttempt({
        ticketId: null,
        serial: '',
        action: SCAN_ACTION.REJECTED,
        reason: REASON.NOT_FOUND,
        scannedBy,
      })
      return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: ERRORS.QR_INVALID }
    }

    const ticketId = snap.docs[0].id
    const ticketRef = doc(db, COL.TICKETS, ticketId)

    // 2) Con el id ya resuelto, la transacción vuelve a leer el ticket y decide.
    //    Releer DENTRO de la transacción es lo que impide que dos porteros escaneando el mismo QR
    //    a la vez lo marquen dos veces: el segundo reintenta y ve el estado ya avanzado.
    const outcome = await runTransaction(db, async (tx) => {
      // --- LECTURAS ---
      const ticketSnap = await tx.get(ticketRef)

      // El ticket pudo borrarse (reserva cancelada) entre la query y la transacción.
      if (!ticketSnap.exists()) {
        return { action: SCAN_ACTION.REJECTED, missing: true }
      }

      const data = ticketSnap.data()
      const status = data.status
      const holderName = data.holderName || 'Invitado'
      const serial = data.serial || ''

      // --- DECISIÓN + ESCRITURAS (siempre después de las lecturas) ---
      const scanRef = doc(collection(db, COL.SCANS))
      const writeScan = (action, reason) =>
        tx.set(scanRef, {
          ticketId,
          serial,
          action,
          reason: reason ?? '',
          scannedAt: serverTimestamp(),
          scannedBy,
        })

      if (status === TICKET_STATUS.VALID) {
        const checkInAt = new Date()
        tx.update(ticketRef, { status: TICKET_STATUS.INSIDE, checkInAt: serverTimestamp() })
        writeScan(SCAN_ACTION.CHECK_IN, '')
        return {
          action: SCAN_ACTION.CHECK_IN,
          ok: true,
          message: `Entrada registrada — ${holderName}`,
          ticket: mapTicket(ticketId, { ...data, status: TICKET_STATUS.INSIDE, checkInAt }),
        }
      }

      if (status === TICKET_STATUS.INSIDE) {
        // Guarda contra dos lecturas casi simultáneas del MISMO ingreso: si el check-in fue hace
        // apenas unos segundos, esta lectura es una repetición, no una salida. Rechazamos en vez de
        // marcar 'exited' para no anular un ingreso recién hecho ni inutilizar el QR.
        const checkInDate = toDate(data.checkInAt)
        const elapsedMs = checkInDate ? Date.now() - checkInDate.getTime() : Infinity
        if (elapsedMs < REENTRY_GUARD_MS) {
          writeScan(SCAN_ACTION.REJECTED, REASON.JUST_CHECKED_IN)
          return {
            action: SCAN_ACTION.REJECTED,
            ok: false,
            message: JUST_CHECKED_IN_MESSAGE,
            ticket: mapTicket(ticketId, data),
          }
        }

        const checkOutAt = new Date()
        tx.update(ticketRef, { status: TICKET_STATUS.EXITED, checkOutAt: serverTimestamp() })
        writeScan(SCAN_ACTION.CHECK_OUT, '')
        return {
          action: SCAN_ACTION.CHECK_OUT,
          ok: true,
          message: `Salida registrada — ${holderName}`,
          ticket: mapTicket(ticketId, { ...data, status: TICKET_STATUS.EXITED, checkOutAt }),
        }
      }

      // 'exited' (ya entró y salió) o cualquier estado inesperado: el ticket NO se modifica.
      const isExited = status === TICKET_STATUS.EXITED
      const reason = isExited ? REASON.ALREADY_USED : REASON.UNKNOWN_STATUS
      writeScan(SCAN_ACTION.REJECTED, reason)
      return {
        action: SCAN_ACTION.REJECTED,
        ok: false,
        message: isExited ? ERRORS.QR_ALREADY_USED : ERRORS.QR_INVALID,
        ticket: mapTicket(ticketId, data),
      }
    })

    // El ticket ya no existía al entrar en la transacción: se registra fuera de ella.
    if (outcome.missing) {
      await logScanAttempt({
        ticketId,
        serial: '',
        action: SCAN_ACTION.REJECTED,
        reason: REASON.NOT_FOUND,
        scannedBy,
      })
      return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: ERRORS.QR_INVALID }
    }

    return {
      ok: outcome.ok,
      action: outcome.action,
      ticket: outcome.ticket,
      message: outcome.message,
    }
  }
}

/**
 * Vista PREVIA de un escaneo de entrada/salida: lee el ticket SIN escribir nada, para saber qué
 * pasaría. Sirve para pedir confirmación antes de registrar una SALIDA (que es irreversible en la
 * práctica). NO reemplaza a processScan: la decisión y el registro reales se hacen ahí, dentro de
 * la transacción. Si esta lectura falla, devolvemos wouldBe:'unknown' para no bloquear la puerta.
 *
 * @returns {Promise<{ wouldBe:'check_in'|'check_out'|'rejected'|'unknown', ticket: object|null }>}
 */
export async function peekScanAction(qrToken) {
  const token = normalizeToken(qrToken)
  if (!token) return { wouldBe: 'rejected', ticket: null }

  try {
    const snap = await withTimeout(
      getDocs(query(collection(db, COL.TICKETS), where('qrToken', '==', token), limit(1))),
      SCAN_TIMEOUT_MS,
    )
    if (snap.__timedOut) return { wouldBe: 'unknown', ticket: null }
    if (snap.empty) return { wouldBe: 'rejected', ticket: null }

    const d = snap.docs[0]
    const ticket = mapTicket(d.id, d.data())

    if (ticket.status === TICKET_STATUS.VALID) return { wouldBe: 'check_in', ticket }
    if (ticket.status === TICKET_STATUS.INSIDE) return { wouldBe: 'check_out', ticket }
    return { wouldBe: 'rejected', ticket }
  } catch (error) {
    console.error('[scanService] peekScanAction', error)
    return { wouldBe: 'unknown', ticket: null }
  }
}

/* ================================================================================================
 * COMIDA — el mismo QR de la invitación sirve para retirar el plato, UNA sola vez.
 *
 * Reglas (§ pedidas por el negocio):
 *   · Solo puede retirar comida quien está DENTRO del evento (ticket.status === 'inside').
 *     Si aún no registró su entrada, o si ya salió, se rechaza.
 *   · Una vez retirada (ticket.mealAt con fecha), cualquier intento posterior se rechaza.
 * El estado de entrada/salida NO se toca aquí: comida es un extra independiente.
 * ============================================================================================== */

/**
 * Canjea la comida de una entrada.
 *
 * @param {string} qrToken  contenido crudo del QR (el mismo de la invitación)
 * @param {string} adminUid uid de quien escanea (seguridad o administrador)
 * @returns {Promise<{ ok: boolean, action: 'meal'|'rejected', ticket: object|null, message: string }>}
 */
export async function processMealScan(qrToken, adminUid) {
  const token = normalizeToken(qrToken)
  const scannedBy = adminUid ?? null

  if (!token) {
    await logScanAttempt({
      ticketId: null,
      serial: '',
      action: SCAN_ACTION.REJECTED,
      reason: REASON.EMPTY,
      scannedBy,
    })
    return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: ERRORS.QR_INVALID }
  }

  try {
    const outcome = await withTimeout(resolveMealFromDb(token, scannedBy), SCAN_TIMEOUT_MS)

    if (outcome.__timedOut) {
      logScanAttempt({
        ticketId: null,
        serial: '',
        action: SCAN_ACTION.REJECTED,
        reason: 'Tiempo de espera agotado (comida)',
        scannedBy,
      })
      return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: SCAN_SLOW_MESSAGE }
    }

    return outcome
  } catch (error) {
    console.error('[scanService] Error procesando el escaneo de comida:', error)
    await logScanAttempt({
      ticketId: null,
      serial: '',
      action: SCAN_ACTION.REJECTED,
      reason: `Error técnico (comida): ${error?.message || 'desconocido'}`,
      scannedBy,
    })
    return {
      ok: false,
      action: SCAN_ACTION.REJECTED,
      ticket: null,
      message: SCAN_FAILURE_MESSAGE,
    }
  }
}

/** Resuelve el canje de comida contra Firestore, dentro de una transacción. */
async function resolveMealFromDb(token, scannedBy) {
  const snap = await getDocs(
    query(collection(db, COL.TICKETS), where('qrToken', '==', token), limit(1))
  )

  if (snap.empty) {
    await logScanAttempt({
      ticketId: null,
      serial: '',
      action: SCAN_ACTION.REJECTED,
      reason: REASON.NOT_FOUND,
      scannedBy,
    })
    return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: ERRORS.QR_INVALID }
  }

  const ticketId = snap.docs[0].id
  const ticketRef = doc(db, COL.TICKETS, ticketId)

  const outcome = await runTransaction(db, async (tx) => {
    // --- LECTURAS ---
    const ticketSnap = await tx.get(ticketRef)
    if (!ticketSnap.exists()) return { missing: true }

    const data = ticketSnap.data()
    const serial = data.serial || ''
    const holderName = data.holderName || 'Invitado'

    const scanRef = doc(collection(db, COL.SCANS))
    const writeScan = (action, reason) =>
      tx.set(scanRef, {
        ticketId,
        serial,
        action,
        reason: reason ?? '',
        scannedAt: serverTimestamp(),
        scannedBy,
      })

    // --- 1) ¿Ya retiró su comida? Se relee DENTRO de la transacción: si dos puestos escanean
    //        el mismo QR a la vez, el segundo reintenta y ve el mealAt ya escrito. Sin doble plato.
    if (data.mealAt) {
      writeScan(SCAN_ACTION.REJECTED, REASON.MEAL_ALREADY_TAKEN)
      return {
        ok: false,
        action: SCAN_ACTION.REJECTED,
        message: ERRORS.MEAL_ALREADY_TAKEN,
        ticket: mapTicket(ticketId, data),
      }
    }

    // --- 2) Debe estar DENTRO del evento.
    if (data.status !== TICKET_STATUS.INSIDE) {
      const exited = data.status === TICKET_STATUS.EXITED
      writeScan(SCAN_ACTION.REJECTED, exited ? REASON.MEAL_EXITED : REASON.MEAL_NOT_INSIDE)
      return {
        ok: false,
        action: SCAN_ACTION.REJECTED,
        message: exited ? ERRORS.MEAL_EXITED : ERRORS.MEAL_NOT_INSIDE,
        ticket: mapTicket(ticketId, data),
      }
    }

    // --- 3) Canje válido. El estado de entrada/salida NO cambia.
    const mealAt = new Date()
    tx.update(ticketRef, { mealAt: serverTimestamp(), mealBy: scannedBy })
    writeScan(SCAN_ACTION.MEAL, '')

    return {
      ok: true,
      action: SCAN_ACTION.MEAL,
      message: `Comida entregada — ${holderName}`,
      ticket: mapTicket(ticketId, { ...data, mealAt }),
    }
  })

  if (outcome.missing) {
    await logScanAttempt({
      ticketId,
      serial: '',
      action: SCAN_ACTION.REJECTED,
      reason: REASON.NOT_FOUND,
      scannedBy,
    })
    return { ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message: ERRORS.QR_INVALID }
  }

  return outcome
}

/**
 * Bitácora en vivo: los últimos 50 escaneos, del más reciente al más antiguo.
 * @param {(scans: object[]) => void} cb
 * @returns {() => void} función para cancelar la suscripción
 */
export function subscribeScans(cb) {
  const q = query(
    collection(db, COL.SCANS),
    orderBy('scannedAt', 'desc'),
    limit(SCAN_LOG_LIMIT)
  )

  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    },
    (error) => {
      console.error('[scanService] Error escuchando la bitácora de escaneos:', error)
      cb([])
    }
  )
}
