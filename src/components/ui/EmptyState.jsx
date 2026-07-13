import { Inbox } from 'lucide-react'

/**
 * Estado vacío. `icon` es un componente de lucide-react (la referencia, no el elemento).
 * `action` es un nodo (normalmente un Button).
 */
export default function EmptyState({
  icon: Icon = Inbox,
  title = 'No hay nada por aquí',
  description,
  action,
  className = '',
}) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      ].join(' ')}
    >
      <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-belen-blue/5 ring-1 ring-belen-blue/10">
        <Icon className="h-7 w-7 text-belen-blue/70" aria-hidden="true" />
      </span>

      <h3 className="font-display text-base font-extrabold uppercase tracking-wide text-belen-blue">
        {title}
      </h3>

      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
