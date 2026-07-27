import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

import { db } from '../lib/firebase'
import {
  COL,
  CONFIG_DOC,
  TICKET_COUNTER_DOC,
  MASTERCLASS_COUNTER_DOC,
  EMAIL_STATUS,
  ERRORS,
  HOLDER_TYPE,
  RESERVATION_STATUS,
  TICKET_STATUS,
  formatSerial,
  slotId,
} from '../lib/constants'
import { clean, isValidEmail, normalizeName, onlyDigits, toDate, uuid } from '../lib/format'

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
 * Crea una solicitud de reserva a partir de la CÉDULA del cliente.
 *
 * El cliente solo digita su cédula, su correo y el nombre de quien asiste; el resto (empresa,
 * código de cliente y ASESOR) se autocompleta desde la base de clientes (colección `clients`):
 *   · La cédula debe existir en `clients` (si no, se rechaza).
 *   · El asesor se resuelve emparejando el «vendedor» del cliente con el nombre de un asesor activo
 *     (comparación normalizada de nombres). Si aún no hay asesor con ese nombre, la reserva se crea
 *     SIN asesor (`agentId: ''`) y el administrador lo asigna después.
 *   · El slot solo se comprueba/bloquea cuando hay asesor (el bloqueo real ocurre al aprobar).
 *
 * @returns {Promise<string>} id de la reserva creada
 */
export async function createReservation(data) {
  const payload = {
    cedula: onlyDigits(data?.cedula),
    clientCode: '', // se autocompleta desde el cliente
    companyName: '', // se autocompleta desde el cliente (columna «Nombre»)
    fullName: clean(data?.fullName),
    email: clean(data?.email).toLowerCase(),
    hasCompanion: Boolean(data?.hasCompanion),
    companionName: clean(data?.companionName),
    vendedor: '', // nombre del asesor según el Excel (para poder reasignar si aún no existe)
    agentId: '', // se resuelve por nombre; '' si todavía no hay un asesor con ese nombre
    agentName: '',
    day: clean(data?.day),
    hour: clean(data?.hour),
    masterclass: Boolean(data?.masterclass),
    masterclassId: clean(data?.masterclassId),
    masterclassName: '', // se desnormaliza abajo desde config.masterclasses
  }

  try {
    // --- Campos que digita el cliente ---
    if (!payload.cedula) fail('Escribe tu número de cédula.')
    if (!payload.fullName) fail('Escribe el nombre de quien asistirá.')
    if (!payload.email) fail('Escribe tu correo electrónico.')
    if (!isValidEmail(payload.email)) fail('El correo electrónico no es válido.')
    if (!payload.day) fail('Selecciona el día de tu cita.')
    if (!payload.hour) fail('Selecciona la hora de tu cita.')

    // --- Una sola ida a la red: config, cliente (por cédula) y asesores ---
    const [configSnap, clientSnap, agentsSnap] = await Promise.all([
      getDoc(doc(db, COL.CONFIG, CONFIG_DOC)),
      getDoc(doc(db, COL.CLIENTS, payload.cedula)),
      getDocs(collection(db, COL.AGENTS)),
    ])

    if (!configSnap.exists()) {
      fail('La configuración del evento no está disponible. Inténtalo de nuevo en unos minutos.')
    }
    const config = configSnap.data()

    if (config.formOpen === false) {
      fail('El formulario de reservas está cerrado por el momento.')
    }

    // --- La cédula debe existir en la base de clientes ---
    if (!clientSnap.exists()) {
      fail('No encontramos esa cédula en nuestra base de clientes. Verifícala o contacta a tu asesor.')
    }
    const client = clientSnap.data()
    payload.clientCode = clean(client.codigo)
    payload.companyName = clean(client.nombre)
    payload.vendedor = clean(client.vendedor)

    // --- Asesor: se empareja el «vendedor» del cliente con un asesor activo, por nombre ---
    const agents = agentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const match = agents.find(
      (a) => a.active !== false && normalizeName(a.name) === normalizeName(payload.vendedor),
    )
    if (match) {
      payload.agentId = match.id
      payload.agentName = clean(match.name)
    } // si no hay coincidencia: queda sin asesor; el administrador lo asignará luego

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

    // --- Masterclass: si asiste, debe elegir una de las de SU DÍA. Es informativo. ---
    const allMasterclasses = Array.isArray(config.masterclasses) ? config.masterclasses : []
    const dayMasterclasses = allMasterclasses.filter((m) => !m.day || m.day === payload.day)
    if (payload.masterclass && dayMasterclasses.length > 0) {
      const chosen = dayMasterclasses.find((m) => m.id === payload.masterclassId)
      if (!chosen) fail('Selecciona a cuál masterclass asistirás (de las disponibles para tu día).')
      payload.masterclassName = clean(chosen.name)
    } else {
      payload.masterclassId = ''
      payload.masterclassName = ''
    }

    const reservationRef = doc(collection(db, COL.RESERVATIONS))
    const base = {
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
    }

    if (payload.agentId) {
      // Con asesor: comprobamos disponibilidad del slot (la autoridad real es la transacción al aprobar).
      const currentSlotId = slotId(payload.day, payload.hour, payload.agentId)
      await runTransaction(db, async (transaction) => {
        const freshSlot = await transaction.get(doc(db, COL.SLOTS, currentSlotId))
        if (freshSlot.exists()) fail(ERRORS.SLOT_TAKEN)
        transaction.set(reservationRef, base)
      })
    } else {
      // Sin asesor: no hay slot que bloquear todavía; el administrador asigna el asesor después.
      await setDoc(reservationRef, base)
    }

    return reservationRef.id
  } catch (error) {
    rethrow(error, 'No pudimos registrar tu solicitud. Revisa tu conexión e inténtalo de nuevo.')
  }
}

/**
 * Asigna (o reasigna) el asesor de una reserva PENDIENTE. Lo usa el administrador cuando una
 * solicitud entró «sin asesor» (porque el cliente tenía un vendedor sin asesor creado aún).
 *
 * @param {string} reservationId
 * @param {string} agentId  id del asesor a asignar
 * @param {string} adminUid
 */
export async function assignReservationAgent(reservationId, agentId, adminUid) {
  try {
    const [reservationSnap, agentSnap] = await Promise.all([
      getDoc(doc(db, COL.RESERVATIONS, reservationId)),
      getDoc(doc(db, COL.AGENTS, agentId)),
    ])
    if (!reservationSnap.exists()) fail(ERRORS.NOT_FOUND)
    if (!agentSnap.exists()) fail('El asesor seleccionado ya no existe.')

    const reservation = reservationSnap.data()
    if (reservation.status !== RESERVATION_STATUS.PENDING) {
      fail('Solo puedes cambiar el asesor de una solicitud que aún está pendiente.')
    }

    await updateDoc(doc(db, COL.RESERVATIONS, reservationId), {
      agentId,
      agentName: clean(agentSnap.data().name),
      reviewedBy: adminUid || null,
    })
  } catch (error) {
    rethrow(error, 'No pudimos asignar el asesor. Revisa tu conexión e inténtalo de nuevo.')
  }
}

/**
 * Reasigna TODAS las reservas de un asesor a otro (se usa al eliminar un asesor: «migrar sus
 * clientes»). Reasigna agentId/agentName en las reservas y, para las ya aprobadas, también en sus
 * entradas y mueve el bloqueo de horario (slot) al asesor destino cuando ese horario esté libre.
 *
 * @param {string} fromAgentId asesor que se va
 * @param {string} toAgentId   asesor que recibe sus reservas
 * @returns {Promise<{ moved: number, slotConflicts: number }>}
 */
export async function migrateReservationsToAgent(fromAgentId, toAgentId) {
  if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) {
    fail('Elige un asesor destino distinto para migrar las reservas.')
  }

  const toAgentSnap = await getDoc(doc(db, COL.AGENTS, toAgentId))
  if (!toAgentSnap.exists()) fail('El asesor destino ya no existe.')
  const toAgentName = clean(toAgentSnap.data().name)

  const reservationsSnap = await getDocs(
    query(collection(db, COL.RESERVATIONS), where('agentId', '==', fromAgentId)),
  )

  let moved = 0
  let slotConflicts = 0

  for (const resDoc of reservationsSnap.docs) {
    const reservation = resDoc.data()
    const batch = writeBatch(db)

    batch.update(resDoc.ref, { agentId: toAgentId, agentName: toAgentName })

    if (reservation.status === RESERVATION_STATUS.APPROVED) {
      // Mover el slot al asesor destino, solo si ese horario está libre para él.
      const oldSlotId = slotId(reservation.day, reservation.hour, fromAgentId)
      const newSlotId = slotId(reservation.day, reservation.hour, toAgentId)
      const newSlotSnap = await getDoc(doc(db, COL.SLOTS, newSlotId))

      if (newSlotSnap.exists()) {
        slotConflicts += 1 // el destino ya tiene ese horario ocupado: se reasigna la reserva pero no el slot
      } else {
        batch.delete(doc(db, COL.SLOTS, oldSlotId))
        batch.set(doc(db, COL.SLOTS, newSlotId), {
          day: reservation.day,
          hour: reservation.hour,
          agentId: toAgentId,
          reservationId: resDoc.id,
          createdAt: serverTimestamp(),
        })
      }

      // Reasignar el asesor en las entradas emitidas de esta reserva.
      const ids = Array.isArray(reservation.ticketIds) ? reservation.ticketIds : []
      ids.forEach((ticketId) => {
        batch.update(doc(db, COL.TICKETS, ticketId), {
          agentId: toAgentId,
          agentName: toAgentName,
        })
      })
    }

    await batch.commit()
    moved += 1
  }

  return { moved, slotConflicts }
}

/** Borra TODOS los documentos de una colección, en lotes. Devuelve cuántos borró. */
async function deleteEntireCollection(collectionName) {
  const snapshot = await getDocs(collection(db, collectionName))
  let deleted = 0
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = writeBatch(db)
    for (const d of snapshot.docs.slice(i, i + 400)) batch.delete(d.ref)
    await batch.commit()
    deleted += Math.min(400, snapshot.docs.length - i)
  }
  return deleted
}

/**
 * Borra TODAS las reservas y sus datos asociados (entradas, bloqueos de horario y bitácora de
 * escaneos) y reinicia el correlativo de seriales a 1. CONSERVA la configuración, los asesores,
 * los clientes y los usuarios del panel. Pensado para limpiar reservas de prueba sin reiniciar todo.
 *
 * @param {(step: string) => void} [onProgress]
 * @returns {Promise<{ reservations, tickets, slots, scans }>}
 */
export async function deleteAllReservations(onProgress = () => {}) {
  try {
    onProgress('Borrando la bitácora de escaneos…')
    const scans = await deleteEntireCollection(COL.SCANS)

    onProgress('Borrando las entradas y códigos QR…')
    const tickets = await deleteEntireCollection(COL.TICKETS)

    onProgress('Liberando los horarios ocupados…')
    const slots = await deleteEntireCollection(COL.SLOTS)

    onProgress('Borrando las reservas…')
    const reservations = await deleteEntireCollection(COL.RESERVATIONS)

    onProgress('Reiniciando el número de las entradas…')
    await setDoc(doc(db, COL.COUNTERS, TICKET_COUNTER_DOC), { next: 1 })

    // Reinicia el contador de cupos de masterclass (todas las reservas se fueron).
    await setDoc(doc(db, COL.COUNTERS, MASTERCLASS_COUNTER_DOC), {})

    return { reservations, tickets, slots, scans }
  } catch (error) {
    console.error('[reservationsService] deleteAllReservations', error)
    throw new Error(
      'No se pudieron borrar todas las reservas: ' +
        (error?.message || 'error desconocido') +
        '. Puede que se hayan borrado parcialmente; inténtalo de nuevo.',
    )
  }
}

/**
 * Suscripción en tiempo real a las reservas, de la más reciente a la más antigua.
 *
 * @param {(reservations: object[]) => void} cb
 * @param {{ agentId?: string }} [options] si se pasa agentId, solo trae las reservas de ESE agente
 *        (es lo que usa el rol 'agente' para ver únicamente las suyas; las reglas de Firestore
 *        también lo exigen, así que el filtro no es solo cosmético).
 * @returns {() => void} función para cancelar la suscripción
 */
export function subscribeReservations(cb, options = {}) {
  const { agentId } = options

  // Con agentId filtramos por agente pero SIN orderBy en la consulta: combinar where('agentId')
  // con orderBy('createdAt') exigiría un índice compuesto en Firestore (y rompería la vista del
  // agente la primera vez). Como un agente tiene pocas reservas, ordenamos en el cliente.
  const q = agentId
    ? query(collection(db, COL.RESERVATIONS), where('agentId', '==', agentId))
    : query(collection(db, COL.RESERVATIONS), orderBy('createdAt', 'desc'))

  return onSnapshot(
    q,
    (snapshot) => {
      let list = snapshot.docs.map(mapReservation)
      if (agentId) {
        list = list.sort((a, b) => {
          const ta = toDate(a.createdAt)?.getTime() ?? 0
          const tb = toDate(b.createdAt)?.getTime() ?? 0
          return tb - ta
        })
      }
      cb(list)
    },
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

      // Una reserva «sin asesor» no se puede aprobar: primero hay que asignarle uno (hay reservas
      // que entran sin asesor cuando el vendedor del cliente aún no tiene asesor creado).
      if (!reservation.agentId) {
        fail('Esta solicitud no tiene asesor asignado. Asígnale un asesor antes de aprobarla.')
      }

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
        masterclassName: reservation.masterclassName ?? '', // para mostrarla en boleto y correo
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

      // Cupos de masterclass: si esta reserva eligió una, suma 1 al contador público de esa masterclass
      // (lo lee el formulario para el contador de urgencia). increment() no requiere lectura previa.
      if (reservation.masterclassId) {
        transaction.set(
          doc(db, COL.COUNTERS, MASTERCLASS_COUNTER_DOC),
          { [reservation.masterclassId]: increment(1) },
          { merge: true },
        )
      }

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
    // Libera el cupo de masterclass que esta reserva había ocupado al aprobarse.
    if (reservation.masterclassId) {
      batch.set(
        doc(db, COL.COUNTERS, MASTERCLASS_COUNTER_DOC),
        { [reservation.masterclassId]: increment(-1) },
        { merge: true },
      )
    }
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
