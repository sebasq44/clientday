/**
 * usersService — gestión de los usuarios del panel (solo el superadmin la usa).
 *
 * Un "usuario del panel" es un documento en admins/{uid}. Su campo `role` decide qué puede hacer:
 *   - 'superadmin': acceso total (es el admin original; su doc puede no tener `role`).
 *   - 'agente'   : gestiona SUS solicitudes + escáner + asistencia. Lleva `agentId`.
 *   - 'seguridad': solo escáner + ver invitaciones/asistencia.
 *
 * Las cuentas de Firebase Auth se crean con una app secundaria (ver lib/firebaseSecondary.js) para
 * no cerrar la sesión del superadmin. El doc admins/{uid} lo escribe la sesión del superadmin.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

import { db } from '../lib/firebase'
import { createAuthAccount } from '../lib/firebaseSecondary'
import { COL, ROLE } from '../lib/constants'
import { clean, isValidEmail } from '../lib/format'

/**
 * Suscripción en vivo a TODOS los usuarios del panel, ordenados por nombre.
 * @param {(users: object[]) => void} cb
 * @returns {() => void}
 */
export function subscribePanelUsers(cb) {
  const q = query(collection(db, COL.ADMINS), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    (error) => {
      console.error('[usersService] Error escuchando los usuarios del panel:', error)
      cb([])
    },
  )
}

/** Valida correo + contraseña comunes a toda creación de cuenta. Lanza Error en español. */
function assertCredentials(email, password) {
  if (!isValidEmail(email)) throw new Error('El correo no tiene un formato válido.')
  if (!password || String(password).length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.')
  }
}

/**
 * Crea un usuario de tipo Seguridad: cuenta de acceso + su documento admins/{uid}.
 * @returns {Promise<string>} uid creado
 */
export async function createSecurityUser({ email, password, name }) {
  const cleanEmail = clean(email).toLowerCase()
  const cleanName = clean(name)
  assertCredentials(cleanEmail, password)
  if (!cleanName) throw new Error('Escribe el nombre del usuario de seguridad.')

  const uid = await createAuthAccount(cleanEmail, password)
  await setDoc(doc(db, COL.ADMINS, uid), {
    email: cleanEmail,
    name: cleanName,
    role: ROLE.SEGURIDAD,
    agentId: null,
    createdAt: serverTimestamp(),
  })
  return uid
}

/**
 * Da de alta la cuenta de acceso de un AGENTE ya existente: crea la cuenta, su doc admins/{uid}
 * con role 'agente' + agentId, y enlaza el agente (agents/{agentId}.uid / hasAccess).
 * @returns {Promise<string>} uid creado
 */
export async function createAgentAccess({ agentId, agentName, email, password }) {
  const cleanEmail = clean(email).toLowerCase()
  assertCredentials(cleanEmail, password)
  if (!agentId) throw new Error('Falta el identificador del asesor.')

  const uid = await createAuthAccount(cleanEmail, password)

  // 1) Documento de usuario del panel.
  await setDoc(doc(db, COL.ADMINS, uid), {
    email: cleanEmail,
    name: clean(agentName) || cleanEmail,
    role: ROLE.AGENTE,
    agentId,
    createdAt: serverTimestamp(),
  })

  // 2) Enlaza el agente con su cuenta. Guarda también el correo de acceso para mostrarlo.
  await updateDoc(doc(db, COL.AGENTS, agentId), {
    uid,
    hasAccess: true,
    accessEmail: cleanEmail,
  })

  return uid
}

/**
 * Revoca el acceso de un agente: borra su doc admins/{uid} (deja de poder entrar al panel) y
 * desenlaza el agente. La cuenta de Firebase Auth no se elimina desde el cliente —no se puede sin
 * Admin SDK—, pero sin el doc admins/{uid} ya no tiene ningún permiso en el panel.
 */
export async function revokeAgentAccess({ agentId, uid }) {
  if (uid) {
    await deleteDoc(doc(db, COL.ADMINS, uid))
  }
  if (agentId) {
    await updateDoc(doc(db, COL.AGENTS, agentId), {
      uid: null,
      hasAccess: false,
      accessEmail: '',
    })
  }
}

/**
 * Elimina un usuario del panel (p. ej. de Seguridad) quitando su doc admins/{uid}. Si es un agente,
 * usa revokeAgentAccess para además desenlazar el agente. Nunca permite borrarse a uno mismo.
 */
export async function removePanelUser(uid) {
  if (!uid) throw new Error('Falta el usuario a eliminar.')
  await deleteDoc(doc(db, COL.ADMINS, uid))
}
