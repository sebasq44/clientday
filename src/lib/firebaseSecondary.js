import { initializeApp, deleteApp, getApps } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth'

/**
 * Crear una cuenta con createUserWithEmailAndPassword en la app PRINCIPAL tiene un efecto no
 * deseado: Firebase inicia sesión automáticamente como el usuario recién creado, expulsando al
 * administrador que estaba dentro. Para evitarlo, creamos la cuenta en una app SECUNDARIA y
 * efímera de Firebase: su estado de sesión es independiente, así que la sesión del admin en la
 * app principal queda intacta.
 *
 * Es el patrón estándar para crear usuarios desde el cliente sin un backend con Admin SDK.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyBXK3SAgnoVA_EEXI_SSBTFyHm83ekBUdY',
  authDomain: 'client-day.firebaseapp.com',
  projectId: 'client-day',
  storageBucket: 'client-day.firebasestorage.app',
  messagingSenderId: '997429601798',
  appId: '1:997429601798:web:8132c572d04e097ea68587',
}

const SECONDARY_NAME = 'user-creator'

/**
 * Crea una cuenta de Firebase Auth (correo + contraseña) SIN tocar la sesión del administrador.
 * Devuelve el uid de la cuenta creada.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<string>} uid de la nueva cuenta
 * @throws {Error} con mensaje en español si el correo ya existe o la contraseña es débil.
 */
export async function createAuthAccount(email, password) {
  // Reutiliza la app secundaria si ya existe (p. ej. tras un fallo previo).
  const existing = getApps().find((a) => a.name === SECONDARY_NAME)
  const secondaryApp = existing ?? initializeApp(firebaseConfig, SECONDARY_NAME)
  const secondaryAuth = getAuth(secondaryApp)

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      String(email).trim(),
      password,
    )
    return credential.user.uid
  } catch (error) {
    throw new Error(translateAuthError(error))
  } finally {
    // Cierra la sesión secundaria y desecha la app: no debe quedar ningún estado colgando.
    try {
      await signOut(secondaryAuth)
    } catch {
      // sin sesión que cerrar: no pasa nada
    }
    try {
      await deleteApp(secondaryApp)
    } catch {
      // ya estaba desechada: no pasa nada
    }
  }
}

/** Traduce los códigos de error de Firebase Auth a mensajes claros en español. */
function translateAuthError(error) {
  const code = error?.code || ''
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Ese correo ya tiene una cuenta. Usa otro o revoca el acceso anterior.'
    case 'auth/invalid-email':
      return 'El correo no tiene un formato válido.'
    case 'auth/weak-password':
      return 'La contraseña es muy débil: usa al menos 6 caracteres.'
    case 'auth/operation-not-allowed':
      return 'El método de correo y contraseña no está habilitado en Firebase Authentication.'
    default:
      return error?.message || 'No se pudo crear la cuenta de acceso.'
  }
}
