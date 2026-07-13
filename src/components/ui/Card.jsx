/**
 * Tarjeta blanca con borde suave. `action` va alineada a la derecha del encabezado
 * (típicamente un Button).
 */
export default function Card({ title, subtitle, action, children, className = '' }) {
  const hasHeader = Boolean(title || subtitle || action)

  return (
    <section
      className={[
        'overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-belen-blue/10',
        className,
      ].join(' ')}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-belen-blue/10 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}

      <div className="px-4 py-4 sm:px-6 sm:py-5">{children}</div>
    </section>
  )
}
