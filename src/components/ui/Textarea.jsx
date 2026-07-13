import { useId } from 'react'

/** Área de texto multilínea (motivos de rechazo, notas, etc.). */
export default function Textarea({
  label,
  error,
  hint,
  required = false,
  rows = 4,
  id,
  className = '',
  ...rest
}) {
  const autoId = useId()
  const textareaId = id || autoId
  const hintId = `${textareaId}-hint`
  const errorId = `${textareaId}-error`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={textareaId}
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

      <textarea
        id={textareaId}
        rows={rows}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          'block w-full resize-y rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-belen-ink',
          'shadow-sm ring-1 ring-inset placeholder:text-slate-400',
          'transition-shadow focus:outline-none focus:ring-2 focus:ring-inset',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          error
            ? 'ring-red-300 focus:ring-red-500'
            : 'ring-belen-blue/15 focus:ring-belen-blue',
          className,
        ].join(' ')}
        {...rest}
      />

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
