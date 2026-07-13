import {
  STATUS_STYLES,
  RESERVATION_STATUS_LABEL,
  EMAIL_STATUS_LABEL,
  TICKET_STATUS_LABEL,
} from '../../lib/constants'

/**
 * Etiqueta de estado. `status` es una clave de STATUS_STYLES (constants.js).
 * Si el estado no existe, cae en 'neutral'.
 * Si no se pasan children, se busca una etiqueta legible por estado.
 */
function fallbackLabel(status) {
  return (
    RESERVATION_STATUS_LABEL[status] ||
    TICKET_STATUS_LABEL[status] ||
    EMAIL_STATUS_LABEL[status] ||
    status ||
    '—'
  )
}

export default function Badge({ status = 'neutral', children, className = '' }) {
  const styles = STATUS_STYLES[status] || STATUS_STYLES.neutral

  return (
    <span
      className={[
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5',
        'text-xs font-semibold',
        styles,
        className,
      ].join(' ')}
    >
      {children ?? fallbackLabel(status)}
    </span>
  )
}
