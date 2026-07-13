import { useId } from 'react'
import { Check } from 'lucide-react'

/**
 * Casilla de verificación controlada.
 *
 * `onChange` recibe el evento nativo de React, igual que un <input> normal:
 *   <Checkbox checked={value} onChange={(e) => setValue(e.target.checked)} />
 */
export default function Checkbox({
  label,
  description,
  checked = false,
  onChange,
  disabled = false,
  id,
  className = '',
  ...rest
}) {
  const autoId = useId()
  const inputId = id || autoId
  const descriptionId = `${inputId}-description`

  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <span className="relative flex h-5 items-center">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
          className={[
            'peer h-5 w-5 cursor-pointer appearance-none rounded-md border-0 bg-white',
            'shadow-sm ring-1 ring-inset ring-belen-blue/25 transition-colors',
            'checked:bg-belen-blue checked:ring-belen-blue',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:ring-slate-200',
          ].join(' ')}
          {...rest}
        />
        <Check
          className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 stroke-[3] text-white opacity-0 transition-opacity peer-checked:opacity-100"
          aria-hidden="true"
        />
      </span>

      {(label || description) && (
        <span className="min-w-0 flex-1 text-sm leading-5">
          {label && (
            <label
              htmlFor={inputId}
              className={[
                'block font-semibold text-belen-ink',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              ].join(' ')}
            >
              {label}
            </label>
          )}
          {description && (
            <p id={descriptionId} className="mt-0.5 text-xs text-slate-500">
              {description}
            </p>
          )}
        </span>
      )}
    </div>
  )
}
