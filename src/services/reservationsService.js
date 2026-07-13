import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'

import { db } from '../lib/firebase'
import {
  COL,
  CONFIG_DOC,
  TICKET_COUNTER_DOC,
  EMAIL_STATUS,
  ERRORS,
  HOLDER_TYPE,
  RESERVATION_STATUS,
  TICKET_STATUS,
  formatSerial,
  slotId,
} from '../lib/constants'
import { clean, isValidEmail, uuid } from '../lib/format'

/** Prefijo de respaldo si config/general aún no tiene ticketPrefix. */
const FALLBACK_PREFIX = 'GEN'

/** Mensajes de negocio ya listos para mostrar: no se enmascaran con el error genérico. */
const BUSINESS_MESSAGES = new Set(Object.values(ERRORS))

/** Errores propios (validación en español) que tampoco deben enmascararse. */
class BusinessError extends Error {}

/** Lanza un Error en español. Los de negocio pasan tal cual; el resto se traduce. */
function rethrow(error, fallbackMessage) {
  if (error instanceof BusinessError) throw error
  if (error instanceof Error && BUSINESS_MESSAGES.has(error.message)) throw error
  console.error('[reservationsService]', error)
  throw new Error(fallbackMessage)
}

function fail(message) {
  throw new BusinessError(message)
}

/** Normaliza un snapshot de reserva a objeto plano con id. */
function mapReservation(snapshot) {
  return { id: snapshot.id, ...snapshot.data() }
}

/** Lee config/general con getDoc normal. Nunca dentro de una runTransaction. */
async function readConfig() {
  const snapshot = await getDoc(doc(db, COL.CONFIG, CONFIG_DOC))
  if (!snapshot.exists()) {
    fail('La configuración del evento no está disponible. Inténtalo de nuevo en unos minutos.')
  }
  return snapshot.data()
}

/**
 * Crea una solicitud de reserva. Valida TODO en el cliente y desnormaliza el nombre del agente.
 * NO crea el slot: el bloqueo de disponibilidad solo ocurre al aprobar (ver §6 de ARCHITECTURE.md).
 * @returns {Promise<string>} id de la reserva creada
 */
export async function createReservation(data) {
  const payload = {
    clientCode: clean(data?.clientCode),
    fullName: clean(data?.fullName),
    companyName: clean(data?.companyName),
    email: clean(data?.email).toLowerCase(),
    phone: clean(data?.phone),
    hasCompanion: Boolean(data?.hasCompanion),
    companionName: clean(data?.companionName),
    agentId: clean(data?.agentId),
    agentName: '',
    day: clean(data?.day),
    hour: clean(data?.hour),
    masterclass: Boolean(data?.masterclass),
  }

  try {
    // --- Campos obligatorios ---
    if (!payload.clientCode) fail('Escribe tu código de cliente.')
    if (!payload.fullName) fail('Escribe tu nombre completo.')
    if (!payload.companyName) fail('Escribe el nombre de tu empresa.')
    if (!payload.email) fail('Escribe tu correo electrónico.')
    if (!isValidEmail(payload.email)) fail('El correo electrónico no es válido.')
    if (!payload.agentId) fail('Selecciona el agente de ventas que te acompañará.')
    if (!payload.day) fail('Selecciona el día de tu cita.')
    if (!payload.hour) fail('Selecciona la hora de tu cita.')

    // --- Una sola ida a la red para config, agente y disponibilidad del slot ---
    const currentSlotId = slotId(payload.day, payload.hour, payload.agentId)
    const [configSnap, agentSnap, slotSnap] = await Promise.all([
      getDoc(doc(db, COL.CONFIG, CONFIG_DOC)),
      getDoc(doc(db, COL.AGENTS, payload.agentId)),
      getDoc(doc(db, COL.SLOTS, currentSlotId)),
    ])

    if (!configSnap.exists()) {
      fail('La configuración del evento no está disponible. Inténtalo de nuevo en unos minutos.')
    }
    const config = configSnap.data()

    if (config.formOpen === false) {
      fail('El formulario de reservas está cerrado por el momento.')
    }

    // --- El día y la hora deben existir (y estar habilitados) en la configuración ---
    const day = (config.days || []).find((d) => d.id === payload.day)
    if (!day || day.enabled === false) fail('El día seleccionado ya no está disponible.')
    if (!(config.hours || []).includes(payload.hour)) {
      fail('La hora seleccionada ya no está disponible.')
    }

    // --- Bloques opcionales según la configuración del evento ---
    if (config.allowCompanion === false) {
      payload.hasCompanion = false
      payload.companionName = ''
    }
    if (config.masterclassEnabled === false) {
      payload.masterclass = false
    }
    if (payload.hasCompanion && !payload.companionName) {
      fail('Escribe el nombre de tu acompañante.')
    }
    if (!payload.hasCompanion) payload.companionName = ''

    // --- El agente debe existir y estar activo ---
    if (!agentSnap.exists()) fail('El agente de ventas seleccionado ya no existe.')
    const agent = agentSnap.data()
    if (agent.active === false) fail('El agente de ventas seleccionado ya no está disponible.')
    payload.agentName = clean(agent.name)

    // --- Comprobación previa de disponibilidad (la autoridad real es la transacción al aprobar) ---
    if (slotSnap.exists()) fail(ERRORS.SLOT_TAKEN)

    const reservationRef = doc(collection(db, COL.RESERVATIONS))
    await runTransaction(db, async (transaction) => {
      // Relectura del slot dentro de la transacción: evita crear una solicitud para un
      // horario que se acaba de ocupar entre la comprobación previa y este momento.
      const freshSlot = await transaction.get(doc(db, COL.SLOTS, currentSlotId))
      if (freshSlot.exists()) fail(ERRORS.SLOT_TAKEN)

      transaction.set(reservationRef, {
        ...payload,
        status: RESERVATION_STATUS.PENDING,
        rejectionReason: '',
        emailStatus: EMAIL_STATUS.NOT_SENT,
        emailError: '',
        emailSentAt: null,
        ticketIds: [],
        createdAt: serverTimestamp(),
        approvedAt: null,
        reviewedBy: null,
      })
    })

    return reservationRef.id
  } catch (error) {
    rethrow(error, 'No pudimos registrar tu solicitud. Revisa tu conexión e inténtalo de nuevo.')
  }
}

/**
 * Suscripción en tiempo real a todas las reservas, de la más reciente a la más antigua.
 * @param {(reservations: object[]) => void} cb
 * @returns {() => void} función para cancelar la suscripción
 */
export function subscribeReservations(cb) {
  const q = query(collection(db, COL.RESERVATIONS), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snapshot) => cb(snapshot.docs.map(mapReservation)),
    (error) => {
      console.error('[reservationsService] subscribeReservations', error)
      cb([])
    }
  )
}

/**
 * Aprueba una reserva de forma ATÓMICA: bloquea el slot, emite 1 ó 2 entradas con serial
 * correlativo y sube el contador, todo en una sola runTransaction.
 *
 * Orden obligatorio dentro de la transacción: TODAS las lecturas primero, luego las escrituras.
 * config/general se lee FUERA (Firestore no permite getDoc/queries sueltos dentro de la transacción).
 *
 * @returns {Promise<{ reservation: object, tickets: object[] }>} datos ya resueltos, listos para
 *          enviar el correo sin volver a leer de la red.
 */
export async function approveReservation(reservationId, adminUid) {
  const id = clean(reservationId)
  if (!id) throw new Error(ERRORS.NOT_FOUND)

  try {
    // 1) FUERA de la transacción: prefijo del serial.
    const config = await readConfig()
    const prefix = clean(config.ticketPrefix) || FALLBACK_PREFIX

    const reservationRef = doc(db, COL.RESERVATIONS, id)
    const counterRef = doc(db, COL.COUNTERS, TICKET_COUNTER_DOC)

    // 2) Ids de los tickets generados ANTES de la transacción para poder devolverlos resueltos.
    //    Como máximo se emiten 2 entradas (titular + acompañante).
    const ticketRefs = [doc(collection(db, COL.TICKETS)), doc(collection(db, COL.TICKETS))]

    return await runTransaction(db, async (transaction) => {
      // ---------- LECTURAS (todas antes de cualquier escritura) ----------
      const reservationSnap = await transaction.get(reservationRef)
      if (!reservationSnap.exists()) fail(ERRORS.NOT_FOUND)
      const reservation = reservationSnap.data()

      const currentSlotId = slotId(reservation.day, reservation.hour, reservation.agentId)
      const slotRef = doc(db, COL.SLOTS, currentSlotId)
      const slotSnap = await transaction.get(slotRef)
      const counterSnap = await transaction.get(counterRef)

      // ---------- VALIDACIONES ----------
      if (reservation.status !== RESERVATION_STATUS.PENDING) fail(ERRORS.ALREADY_REVIEWED)
      if (slotSnap.exists()) fail(ERRORS.SLOT_TAKEN)

      // Si el contador no existe (o viene corrupto), arranca en 1. Los seriales nunca se reutilizan.
      const rawNext = Number(counterSnap.exists() ? counterSnap.data()?.next : 1)
      const next = Number.isFinite(rawNext) && rawNext >= 1 ? Math.floor(rawNext) : 1

      // ---------- DATOS DE LAS ENTRADAS ----------
      const companionName = clean(reservation.companionName)
      const holders = [
        { holderName: clean(reservation.fullName), holderType: HOLDER_TYPE.TITULAR },
      ]
      if (reservation.hasCompanion && companionName) {
        holders.push({ holderName: companionName, holderType: HOLDER_TYPE.COMPANION })
      }

      const tickets = holders.map((holder, index) => ({
        id: ticketRefs[index].id,
        serial: formatSerial(prefix, next + index),
        qrToken: uuid(),
        reservationId: id,
        holderName: holder.holderName,
        holderType: holder.holderType,
        clientCode: reservation.clientCode ?? '',
        companyName: reservation.companyName ?? '',
        agentId: reservation.agentId ?? '',
        agentName: reservation.agentName ?? '',
        day: reservation.day ?? '',
        hour: reservation.hour ?? '',
        masterclass: Boolean(reservation.masterclass),
        status: TICKET_STATUS.VALID,
        checkInAt: null,
        checkOutAt: null,
      }))
      const ticketIds = tickets.map((ticket) => ticket.id)

      // ---------- ESCRITURAS ----------
      transaction.set(slotRef, {
        day: reservation.day,
        hour: reservation.hour,
        agentId: reservation.agentId,
        reservationId: id,
        createdAt: serverTimestamp(),
      })

      tickets.forEach((ticket, index) => {
        const { id: ticketId, ...ticketData } = ticket
        void ticketId
        transaction.set(ticketRefs[index], { ...ticketData, createdAt: serverTimestamp() })
      })

      transaction.set(counterRef, { next: next + tickets.length }, { merge: true })

      const reservationPatch = {
        status: RESERVATION_STATUS.APPROVED,
        approvedAt: serverTimestamp(),
        reviewedBy: adminUid || null,
        ticketIds,
        rejectionReason: '',
        emailStatus: EMAIL_STATUS.NOT_SENT,
        emailError: '',
        emailSentAt: null,
      }
      transaction.update(reservationRef, reservationPatch)

      // Se devuelve todo ya resuelto (con fechas de cliente en vez de serverTimestamp) para que
      // quien llame pueda mandar el correo de inmediato sin releer de la red.
      const now = new Date()
      return {
        reservation: { ...reservation, ...reservationPatch, approvedAt: now, id },
        tickets: tickets.map((ticket) => ({ ...ticket, createdAt: now })),
      }
    })
  } catch (error) {
    return rethrow(error, 'No se pudo aprobar la reserva. Revisa tu conexión e inténtalo de nuevo.')
  }
}

/** Rechaza una solicitud pendiente y guarda el motivo. */
export async function rejectReservation(id, reason, adminUid) {
  const reservationId = clean(id)
  if (!reservationId) throw new Error(ERRORS.NOT_FOUND)

  const reason_ = clean(reason)
  if (!reason_) throw new BusinessError('Escribe el motivo del rechazo.')

  try {
    const reservationRef = doc(db, COL.RESERVATIONS, reservationId)

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reservationRef)
      if (!snapshot.exists()) fail(ERRORS.NOT_FOUND)
      if (snapshot.data().status !== RESERVATION_STATUS.PENDING) fail(ERRORS.ALREADY_REVIEWED)

      transaction.update(reservationRef, {
        status: RESERVATION_STATUS.REJECTED,
        rejectionReason: reason_,
        reviewedBy: adminUid || null,
      })
    })
  } catch (error) {
    rethrow(error, 'No se pudo rechazar la solicitud. Revisa tu conexión e inténtalo de nuevo.')
  }
}

/**
 * Cancela una reserva ya aprobada: libera el slot, BORRA sus entradas (el serial se pierde y
 * nunca se reutiliza) y marca la reserva como 'cancelled'. Todo en un solo batch.
 */
export async function cancelReservation(id, adminUid) {
  const reservationId = clean(id)
  if (!reservationId) throw new Error(ERRORS.NOT_FOUND)

  try {
    const reservationRef = doc(db, COL.RESERVATIONS, reservationId)
    const snapshot = await getDoc(reservationRef)
    if (!snapshot.exists()) fail(ERRORS.NOT_FOUND)

    const reservation = snapshot.data()
    if (reservation.status !== RESERVATION_STATUS.APPROVED) {
      fail('Solo se pueden cancelar reservas aprobadas.')
    }

    // Ids de las entradas: los de la reserva más los que apunten a ella (por si quedó alguno
    // huérfano). Así no sobrevive ningún QR escaneable de una reserva cancelada.
    const orphanSnap = await getDocs(
      query(collection(db, COL.TICKETS), where('reservationId', '==', reservationId))
    )
    const ticketIds = [
      ...new Set([
        ...(Array.isArray(reservation.ticketIds) ? reservation.ticketIds : []),
        ...orphanSnap.docs.map((d) => d.id),
      ]),
    ].filter(Boolean)

    const batch = writeBatch(db)
    batch.delete(doc(db, COL.SLOTS, slotId(reservation.day, reservation.hour, reservation.agentId)))
    ticketIds.forEach((ticketId) => batch.delete(doc(db, COL.TICKETS, ticketId)))
    batch.update(reservationRef, {
      status: RESERVATION_STATUS.CANCELLED,
      ticketIds: [],
      reviewedBy: adminUid || null,
    })

    await batch.commit()
  } catch (error) {
    rethrow(error, 'No se pudo cancelar la reserva. Revisa tu conexión e inténtalo de nuevo.')
  }
}
