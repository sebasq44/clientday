import { useEffect, useState } from 'react'
import { subscribeReservations } from '../services/reservationsService'

/**
 * Suscripción en tiempo real a la colección `reservations`.
 * El servicio ya entrega la lista ordenada por `createdAt` descendente.
 *
 * @param {{ agentId?: string }} [options] si se pasa agentId, solo trae las reservas de ese agente
 *        (lo usa el rol 'agente' para ver únicamente las suyas).
 * @returns {{ reservations: Array, loading: boolean, error: string|null }}
 */
export function useReservations(options = {}) {
  const agentId = options.agentId ?? null
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Evita actualizar el estado si el componente ya se desmontó.
    let active = true
    let unsubscribe = null

    setLoading(true)
    try {
      unsubscribe = subscribeReservations(
        (list) => {
          if (!active) return
          setReservations(Array.isArray(list) ? list : [])
          setError(null)
          setLoading(false)
        },
        agentId ? { agentId } : {}
      )
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
  }, [agentId])

  return { reservations, loading, error }
}

export default useReservations
