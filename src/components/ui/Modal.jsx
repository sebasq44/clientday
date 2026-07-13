import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Diálogo modal. Se pinta con portal en document.body, bloquea el scroll de la página,
 * cierra con Escape y con clic en el fondo, y mantiene el foco dentro (trap básico).
 *
 * size: 'sm' | 'md' | 'lg' | 'xl'
 */
const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, size = 'md', children, footer }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  // Mantenemos la última referencia de onClose sin re-ejecutar el efecto en cada render.
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined

    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const getFocusable = () =>
      Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      )

    // Enfocamos el primer elemento útil del diálogo una vez pintado.
    const focusTimer = window.setTimeout(() => {
      const focusable = getFocusable()
      if (focusable.length > 0) focusable[0].focus()
      else panelRef.current?.focus()
    }, 0)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = getFocusable()
      const panel = panelRef.current
      if (!panel) return

      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  const handleBackdropMouseDown = (event) => {
    // Solo cerramos si el clic empezó en el fondo, no al arrastrar desde dentro del panel.
    if (event.target === event.currentTarget) onCloseRef.current?.()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-belen-ink/50 p-3 backdrop-blur-sm sm:p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <style>{`
        @keyframes belen-modal-in {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ animation: 'belen-modal-in 180ms ease-out' }}
        className={[
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden bg-white shadow-card-hover',
          'rounded-2xl',
          'focus:outline-none',
          SIZES[size] || SIZES.md,
        ].join(' ')}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-belen-blue/10 px-4 py-4 sm:px-5">
          <h2
            id={titleId}
            className="font-display text-base font-extrabold uppercase tracking-wide text-belen-blue"
          >
            {title}
          </h2>

          <button
            type="button"
            onClick={() => onCloseRef.current?.()}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-belen-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">{children}</div>

        {footer && (
          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-belen-blue/10 bg-belen-cream/60 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-5 [&>*]:w-full sm:[&>*]:w-auto">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
