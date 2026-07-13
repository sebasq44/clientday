import { useEffect, useState } from 'react'
import { subscribeReservations } from '../services/reservationsService'

/**
 * Suscripción en tiempo real a la colección `reservations`.
 * El servicio ya entrega la lista ordenada por `createdAt` descendente.
 *
 * @returns {{ reservations: Array, loading: boolean, error: string|null }}
 */
export function useReservations() {
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Evita actualizar el estado si el componente ya se desmontó.
    let active = true
    let unsubscribe = null

    try {
      unsubscribe = subscribeReservations((list) => {
        if (!active) return
        setReservations(Array.isArray(list) ? list : [])
        setError(null)
        setLoading(false)
      })
    } catch (err) {
      console.error('No se pudo escuchar las reservas:', err)
      if (active) {
        setReservations([])
        setError(err?.message || 'No pudimos cargar las solicitudes. Revisa tu conexión.')
        setLoading(false)
      }
    }

    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  return { reservations, loading, error }
}

export default useReservations
