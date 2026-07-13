import { useEffect, useState } from 'react'
import { subscribeAgents } from '../services/agentsService'

/**
 * Suscripción en tiempo real a TODOS los agentes (activos e inactivos), ordenados por nombre.
 * El formulario público filtra por `agent.active`.
 * @returns {{ agents: object[], loading: boolean, error: string|null }}
 */
export function useAgents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true

    const unsubscribe = subscribeAgents(
      (next) => {
        if (!alive) return
        setAgents(next)
        // Una lectura correcta limpia cualquier error previo (p. ej. tras reconectar).
        setError(null)
        setLoading(false)
      },
      (err) => {
        if (!alive) return
        // Un fallo de carga NO es lo mismo que "no hay agentes": lo exponemos para que la vista
        // muestre un estado de error real y no un vacío engañoso.
        setError(err?.message || 'No se pudieron cargar los agentes. Inténtalo de nuevo.')
        setLoading(false)
      },
    )

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return { agents, loading, error }
}

export default useAgents
