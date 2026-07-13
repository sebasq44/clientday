import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

// Configuración pública del cliente. No es un secreto: la seguridad real la aplican
// las reglas de Firestore (ver FIRESTORE_RULES.txt).
const firebaseConfig = {
  apiKey: 'AIzaSyBXK3SAgnoVA_EEXI_SSBTFyHm83ekBUdY',
  authDomain: 'client-day.firebaseapp.com',
  projectId: 'client-day',
  storageBucket: 'client-day.firebasestorage.app',
  messagingSenderId: '997429601798',
  appId: '1:997429601798:web:8132c572d04e097ea68587',
}

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

/**
 * URL del Web App de Google Apps Script que envía los correos con las entradas.
 * Se rellena tras desplegar el script (ver apps-script/Codigo.gs y README.md).
 */
export const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzC9NntkQQEufgY7xn78H1o7HiEkvMdZQWi4SSJH4nYxcWg9wLKC4ajU2S2GOf5deAE/exec'

/** Debe coincidir con SHARED_SECRET dentro de apps-script/Codigo.gs */
export const APPS_SCRIPT_SECRET = 'belen-dia-del-cliente-2026'
