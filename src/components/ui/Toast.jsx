import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { uuid } from '../../lib/format'

/**
 * Sistema de avisos. Envuelve la app con <ToastProvider> (ya se hace en App.jsx) y
 * consume con useToast():
 *
 *   const toast = useToast()
 *   toast.success('Reserva aprobada')
 *   toast.error('No se pudo enviar el correo')
 *   toast.info('Actualizando…')
 */
const ToastContext = createContext(null)

const AUTO_CLOSE_MS = 5000
const MAX_VISIBLE = 4

const TYPES = {
  success: {
    Icon: CheckCircle2,
    ring: 'ring-emerald-200',
    bar: 'bg-emerald-500',
    icon: 'text-emerald-600',
    role: 'status',
  },
  error: {
    Icon: XCircle,
    ring: 'ring-red-200',
    bar: 'bg-red-500',
    icon: 'text-red-600',
    role: 'alert',
  },
  info: {
    Icon: Info,
    ring: 'ring-belen-blue/20',
    bar: 'bg-belen-blue',
    icon: 'text-belen-blue',
    role: 'status',
  },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (type, message) => {
      const id = uuid()
      const text = String(message ?? '').trim() || 'Sin detalle.'

      setToasts((current) => {
        const next = [...current, { id, type, message: text }]
        // La cola no crece sin control: dejamos ver los últimos avisos.
        return next.slice(-MAX_VISIBLE)
      })

      const timer = window.setTimeout(() => dismiss(id), AUTO_CLOSE_MS)
      timers.current.set(id, timer)
      return id
    },
    [dismiss],
  )

  // Limpieza de temporizadores pendientes al desmontar.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = useMemo(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-live="polite"
      className={[
        'pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4',
        'sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end sm:p-0',
      ].join(' ')}
    >
      <style>{`
        @keyframes belen-toast-in {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({ toast, onDismiss }) {
  const config = TYPES[toast.type] || TYPES.info
  const { Icon } = config

  return (
    <div
      role={config.role}
      style={{ animation: 'belen-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1)' }}
      className={[
        'pointer-events-auto flex w-full max-w-md items-start gap-3 overflow-hidden',
        'rounded-xl bg-white p-3 pl-0 shadow-card-hover ring-1',
        config.ring,
        'sm:w-96',
      ].join(' ')}
    >
      <span className={`h-full min-h-[2.75rem] w-1 shrink-0 self-stretch ${config.bar}`} />

      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.icon}`} aria-hidden="true" />

      <p className="min-w-0 flex-1 break-words py-0.5 text-sm font-medium leading-snug text-belen-ink">
        {toast.message}
      </p>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar aviso"
        className="-mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-belen-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error(
      'useToast() debe usarse dentro de <ToastProvider>. Envuelve la app con <ToastProvider> (ver src/App.jsx).',
    )
  }

  return context
}

export default ToastProvider
