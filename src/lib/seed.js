import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { COL, CONFIG_DOC, TICKET_COUNTER_DOC } from './constants'

/** Parámetros por defecto del evento. El admin los edita luego en /admin/settings. */
export const DEFAULT_CONFIG = {
  eventName: 'Día del Cliente',
  eventYear: 2026,
  tagline: 'Conexiones que impulsan',
  formOpen: true,
  allowCompanion: true,
  masterclassEnabled: true,
  days: [
    { id: '2026-09-08', label: '8 Septiembre', letter: 'M', enabled: true },
    { id: '2026-09-09', label: '9 Septiembre', letter: 'K', enabled: true },
  ],
  hours: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
  ticketPrefix: 'GEN',
}

/**
 * Crea los documentos base si aún no existen. Es idempotente: se puede llamar en cada arranque
 * del panel admin sin pisar la configuración que el administrador ya haya guardado.
 * Requiere sesión de administrador (las reglas de Firestore bloquean la escritura anónima).
 */
export async function ensureSeedData() {
  const configRef = doc(db, COL.CONFIG, CONFIG_DOC)
  const counterRef = doc(db, COL.COUNTERS, TICKET_COUNTER_DOC)

  const [configSnap, counterSnap] = await Promise.all([getDoc(configRef), getDoc(counterRef)])

  if (!configSnap.exists()) {
    await setDoc(configRef, { ...DEFAULT_CONFIG, updatedAt: serverTimestamp() })
  }
  if (!counterSnap.exists()) {
    await setDoc(counterRef, { next: 1 })
  }
}
