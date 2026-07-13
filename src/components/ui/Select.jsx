import { useId } from 'react'
import { ChevronDown } from 'lucide-react'

/** Desplegable nativo (mejor experiencia en móvil) con la piel de la marca. */
export default function Select({
  label,
  error,
  hint,
  required = false,
  id,
  className = '',
  children,
  ...rest
}) {
  const autoId = useId()
  const selectId = id || autoId
  const hintId = `${selectId}-hint`
  const errorId = `${selectId}-error`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={selectId}
          className="mb-1.5 block text-sm font-semibold text-belen-ink"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-belen-orange" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div className="relative">
        <select
          id={selectId}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          className={[
            'block w-full appearance-none rounded-xl border-0 bg-white py-2.5 pl-3.5 pr-10',
            'text-sm text-belen-ink shadow-sm ring-1 ring-inset',
            'transition-shadow focus:outline-none focus:ring-2 focus:ring-inset',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
            error
              ? 'ring-red-300 focus:ring-red-500'
              : 'ring-belen-blue/15 focus:ring-belen-blue',
            className,
          ].join(' ')}
          {...rest}
        >
          {children}
        </select>

        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-belen-blue/60"
          aria-hidden="true"
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1.5 text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
