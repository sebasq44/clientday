import Spinner from './Spinner'

/**
 * Botón base de la app.
 * variant: 'primary' | 'secondary' | 'ghost' | 'danger'
 * size:    'sm' | 'md' | 'lg'
 * loading: muestra el Spinner y deshabilita el botón
 * icon:    componente de lucide-react (se pasa la referencia, no el elemento)
 */
const VARIANTS = {
  primary:
    'bg-belen-blue text-white shadow-sm hover:bg-belen-blue-dark active:bg-belen-blue-dark',
  secondary:
    'bg-white text-belen-blue ring-1 ring-inset ring-belen-blue/30 hover:bg-belen-blue/5 active:bg-belen-blue/10',
  ghost: 'bg-transparent text-belen-blue hover:bg-belen-blue/10 active:bg-belen-blue/15',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-700',
}

const SIZES = {
  sm: 'h-9 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-11 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-[3.25rem] gap-2.5 rounded-xl px-6 text-base',
}

const ICON_SIZES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
}

const SPINNER_SIZES = {
  sm: 'xs',
  md: 'sm',
  lg: 'sm',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  type = 'button',
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const variantClass = VARIANTS[variant] || VARIANTS.primary
  const sizeClass = SIZES[size] || SIZES.md
  const iconClass = ICON_SIZES[size] || ICON_SIZES.md
  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold',
        'transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClass,
        sizeClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <Spinner size={SPINNER_SIZES[size] || 'sm'} />
      ) : (
        Icon && <Icon className={iconClass} aria-hidden="true" />
      )}
      {children}
    </button>
  )
}
