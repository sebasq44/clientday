import { useEffect, useState } from 'react'
import { subscribeConfig } from '../services/configService'

/**
 * Suscripción en tiempo real a `config/general`.
 * @returns {{ config: object|null, loading: boolean, error: string|null }}
 */
export function useConfig() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true

    const unsubscribe = subscribeConfig(
      (next) => {
        if (!alive) return
        setConfig(next)
        // Mensaje NEUTRO de cara al cliente: este hook lo consumen tanto el formulario público
        // como el panel. Si el documento aún no existe (evento sin configurar), un visitante no
        // debe ver instrucciones internas de administración.
        setError(next ? null : 'El evento aún no está disponible. Vuelve a intentarlo más tarde.')
        setLoading(false)
      },
      (err) => {
        if (!alive) return
        setError(err.message)
        setLoading(false)
      },
    )

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return { config, loading, error }
}

export default useConfig
