/**
 * Indicador de carga. Hereda el color del texto del contenedor (currentColor),
 * así funciona dentro de un botón primario (blanco) o sobre fondo claro (azul).
 */
const SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
}

export default function Spinner({ size = 'md', className = '', label = 'Cargando…' }) {
  const sizeClass = SIZES[size] || SIZES.md

  return (
    <span role="status" className={`inline-flex items-center justify-center ${className}`}>
      <svg
        className={`animate-spin ${sizeClass}`}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="12"
          cy="12"
          r="9.5"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-25"
        />
        <path
          d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}
