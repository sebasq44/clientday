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
  // Lista de masterclasses que el cliente elige en el formulario si asiste. Es informativa
  // (aparece en el boleto y el correo); no impone bloqueos. La administra el superadmin en Ajustes.
  masterclasses: [
    { id: 'mc-1', name: 'Empaque sostenible', startTime: '10:00', endTime: '11:00' },
    { id: 'mc-2', name: 'Tendencias de mercado', startTime: '12:00', endTime: '13:00' },
  ],
  days: [
    { id: '2026-09-08', label: '8 Septiembre', letter: 'M', enabled: true },
    { id: '2026-09-09', label: '9 Septiembre', letter: 'K', enabled: true },
  ],
  // Cada cita dura 30 minutos: las horas van en pasos de media hora (9:00 a. m. – 4:00 p. m.).
  hours: [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  ],
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
