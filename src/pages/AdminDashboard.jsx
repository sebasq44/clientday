import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarCheck,
  CalendarRange,
  Clock,
  Copy,
  GraduationCap,
  Link2,
  LogIn,
  MailX,
  Settings,
  Share2,
  Users,
  UserSquare2,
} from 'lucide-react'

import { Badge, Button, Card, EmptyState, useToast } from '../components/ui'
import { useConfig } from '../hooks/useConfig'
import { useAgents } from '../hooks/useAgents'
import { useReservations } from '../hooks/useReservations'
import { subscribeTickets } from '../services/ticketsService'
import { EMAIL_STATUS, RESERVATION_STATUS, TICKET_STATUS } from '../lib/constants'
import { dayLabel, formatDateTime, formatHourRange } from '../lib/format'

/** Cuántas personas entran con una reserva: titular + acompañante (si lo hay). */
function peopleIn(reservation) {
  return 1 + (reservation.hasCompanion ? 1 : 0)
}

/** Clave de una celda del heatmap. */
function cellKey(hour, agentId) {
  return `${hour}__${agentId}`
}

/** Copia al portapapeles con respaldo para navegadores sin Clipboard API (http, WebView antiguo). */
async function copyToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (error) {
      console.warn('[AdminDashboard] Clipboard API no disponible, usando respaldo:', error)
    }
  }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.top = '-1000px'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    return copied
  } catch (error) {
    console.error('[AdminDashboard] No se pudo copiar el enlace:', error)
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Piezas visuales                                                      */
/* ------------------------------------------------------------------ */

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-belen-blue/10 ${className}`} />
}

/**
 * Tarjeta de indicador. `tone` pinta el círculo del icono.
 * Si se pasa `to`, toda la tarjeta es un enlace del panel.
 */
const KPI_TONES = {
  amber: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200',
  blue: 'bg-belen-blue/10 text-belen-blue ring-1 ring-belen-blue/20',
  orange: 'bg-belen-orange/10 text-belen-orange ring-1 ring-belen-orange/25',
  red: 'bg-red-50 text-red-600 ring-1 ring-red-200',
}

function KpiCard({ icon: Icon, label, value, hint, tone = 'blue', alert = false, to }) {
  const card = (
    <Card
      className={[
        'h-full transition-shadow',
        to ? 'hover:shadow-card-hover' : '',
        alert ? 'ring-2 ring-red-200' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center gap-4">
        <span
          className={[
            'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
            KPI_TONES[tone] || KPI_TONES.blue,
          ].join(' ')}
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>

        <div className="min-w-0">
          <p
            className={[
              'font-display text-3xl font-extrabold leading-none',
              alert ? 'text-red-600' : 'text-belen-blue',
            ].join(' ')}
          >
            {value}
          </p>
          <p className="mt-1.5 truncate text-sm font-semibold text-belen-ink">{label}</p>
          {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
        </div>
      </div>
    </Card>
  )

  if (!to) return card

  return (
    <Link
      to={to}
      className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2"
    >
      {card}
    </Link>
  )
}

function KpiSkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="h-full">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="mt-2 h-3.5 w-32" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-9 w-40 shrink-0" />
          <Skeleton className="h-9 flex-1" />
        </div>
      ))}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <div className="flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-56" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function AdminDashboard() {
  const toast = useToast()
  const { config, loading: configLoading, error: configError } = useConfig()
  const { agents, loading: agentsLoading } = useAgents()
  const { reservations, loading: reservationsLoading, error: reservationsError } = useReservations()

  const [tickets, setTickets] = useState([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState('')
  const [copying, setCopying] = useState(false)

  // Entradas emitidas — se usan para saber quién está dentro del evento ahora mismo.
  useEffect(() => {
    let alive = true

    const unsubscribe = subscribeTickets((list) => {
      if (!alive) return
      setTickets(Array.isArray(list) ? list : [])
      setTicketsLoading(false)
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const days = useMemo(() => (Array.isArray(config?.days) ? config.days : []), [config])
  const hours = useMemo(() => (Array.isArray(config?.hours) ? config.hours : []), [config])

  // Día seleccionado del heatmap: el primero habilitado en cuanto llega la configuración.
  useEffect(() => {
    if (!days.length) return
    const exists = days.some((day) => day.id === selectedDay)
    if (exists) return
    const firstEnabled = days.find((day) => day.enabled !== false) || days[0]
    setSelectedDay(firstEnabled.id)
  }, [days, selectedDay])

  const approved = useMemo(
    () => reservations.filter((r) => r.status === RESERVATION_STATUS.APPROVED),
    [reservations],
  )

  const stats = useMemo(() => {
    const pending = reservations.filter((r) => r.status === RESERVATION_STATUS.PENDING).length
    const expectedPeople = approved.reduce((total, r) => total + peopleIn(r), 0)
    const masterclassPeople = approved
      .filter((r) => r.masterclass)
      .reduce((total, r) => total + peopleIn(r), 0)
    const insideNow = tickets.filter((t) => t.status === TICKET_STATUS.INSIDE).length
    const failedEmails = reservations.filter((r) => r.emailStatus === EMAIL_STATUS.FAILED).length

    return {
      pending,
      approved: approved.length,
      expectedPeople,
      masterclassPeople,
      insideNow,
      failedEmails,
    }
  }, [reservations, approved, tickets])

  // Agentes del heatmap: los activos + cualquier inactivo que aún tenga citas aprobadas
  // en el día seleccionado (para no esconder reservas reales).
  const gridAgents = useMemo(() => {
    const bookedAgentIds = new Set(
      approved.filter((r) => r.day === selectedDay).map((r) => r.agentId),
    )
    return agents.filter((agent) => agent.active || bookedAgentIds.has(agent.id))
  }, [agents, approved, selectedDay])

  // Mapa `hora__agente` -> reserva aprobada, para el día seleccionado.
  const occupancy = useMemo(() => {
    const map = new Map()
    approved
      .filter((r) => r.day === selectedDay)
      .forEach((r) => map.set(cellKey(r.hour, r.agentId), r))
    return map
  }, [approved, selectedDay])

  const dayBookings = occupancy.size
  const dayCapacity = gridAgents.length * hours.length
  const latest = useMemo(() => reservations.slice(0, 5), [reservations])

  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/` : '/'

  const handleCopyLink = async () => {
    setCopying(true)
    const copied = await copyToClipboard(publicUrl)
    setCopying(false)

    if (copied) toast.success('Enlace del formulario copiado al portapapeles.')
    else toast.error(`No pudimos copiar el enlace. Cópialo a mano: ${publicUrl}`)
  }

  const isLoading = configLoading || reservationsLoading || agentsLoading || ticketsLoading
  const hasReservations = reservations.length > 0
  const errorMessage = configError || reservationsError

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-belen-blue">
            {config?.eventName || 'Día del Cliente'} {config?.eventYear || ''}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {config?.tagline || 'Conexiones que impulsan'} · Resumen del evento en tiempo real.
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={Copy}
          loading={copying}
          onClick={handleCopyLink}
          className="w-full sm:w-auto"
        >
          Copiar enlace del formulario
        </Button>
      </div>

      {/* Error de red / permisos */}
      {errorMessage && (
        <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-700">No pudimos cargar todos los datos</p>
            <p className="mt-0.5 break-words text-sm text-red-600">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* KPIs */}
      {isLoading ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            icon={Clock}
            tone="amber"
            label="Solicitudes pendientes"
            hint="Esperan tu revisión"
            value={stats.pending}
            to="/admin/reservations"
          />
          <KpiCard
            icon={CalendarCheck}
            tone="emerald"
            label="Reservas aprobadas"
            hint="Citas confirmadas con entrada emitida"
            value={stats.approved}
            to="/admin/reservations"
          />
          <KpiCard
            icon={Users}
            tone="blue"
            label="Personas esperadas"
            hint="Titulares y acompañantes aprobados"
            value={stats.expectedPeople}
          />
          <KpiCard
            icon={LogIn}
            tone="emerald"
            label="Dentro del evento ahora"
            hint="Entradas escaneadas sin salida"
            value={stats.insideNow}
            to="/admin/attendance"
          />
          <KpiCard
            icon={GraduationCap}
            tone="orange"
            label="Asistentes a Masterclass"
            hint="Personas de reservas aprobadas"
            value={stats.masterclassPeople}
          />
          <KpiCard
            icon={MailX}
            tone="red"
            label="Correos fallidos"
            hint={
              stats.failedEmails > 0
                ? 'Reenvía la invitación desde Reservas'
                : 'Todas las invitaciones salieron bien'
            }
            value={stats.failedEmails}
            alert={stats.failedEmails > 0}
            to="/admin/reservations"
          />
        </div>
      )}

      {/* Ocupación por agente y día */}
      <Card
        title="Ocupación por agente y día"
        subtitle={
          isLoading || !selectedDay
            ? 'Cargando el calendario del evento…'
            : `${dayBookings} de ${dayCapacity || 0} espacios reservados el ${dayLabel(config, selectedDay)}`
        }
        action={
          days.length > 0 && (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Seleccionar día del evento"
            >
              {days.map((day) => {
                const active = day.id === selectedDay
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => setSelectedDay(day.id)}
                    aria-pressed={active}
                    className={[
                      'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
                      active
                        ? 'bg-belen-blue text-white shadow-sm'
                        : 'bg-belen-blue/5 text-belen-blue ring-1 ring-inset ring-belen-blue/15 hover:bg-belen-blue/10',
                    ].join(' ')}
                  >
                    {day.label}
                    {day.enabled === false && (
                      <span className={active ? 'text-white/70' : 'text-slate-400'}> · cerrado</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        }
      >
        {isLoading ? (
          <GridSkeleton />
        ) : !days.length || !hours.length ? (
          <EmptyState
            icon={Settings}
            title="Falta configurar el evento"
            description="Define los días y las horas de atención para poder ver el calendario de ocupación."
            action={
              <Link to="/admin/settings">
                <Button variant="primary" size="sm" icon={Settings}>
                  Ir a Ajustes
                </Button>
              </Link>
            }
          />
        ) : !gridAgents.length ? (
          <EmptyState
            icon={UserSquare2}
            title="Aún no hay agentes activos"
            description="Los clientes solo pueden reservar si hay al menos un agente de ventas activo."
            action={
              <Link to="/admin/agents">
                <Button variant="primary" size="sm" icon={Users}>
                  Agregar agentes
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[640px] border-separate border-spacing-1 text-left">
                <caption className="sr-only">
                  Ocupación de agentes por hora el {dayLabel(config, selectedDay)}
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="w-44 px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      Agente
                    </th>
                    {hours.map((hour) => (
                      <th
                        key={hour}
                        scope="col"
                        className="px-1 pb-2 text-center text-xs font-semibold text-belen-blue"
                      >
                        {hour}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridAgents.map((agent) => (
                    <tr key={agent.id}>
                      <th
                        scope="row"
                        className="w-44 max-w-[11rem] rounded-lg bg-belen-blue/5 px-2 py-2 text-sm font-semibold text-belen-ink"
                      >
                        <span className="block truncate" title={agent.name}>
                          {agent.name}
                        </span>
                        {!agent.active && (
                          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                            Inactivo
                          </span>
                        )}
                      </th>

                      {hours.map((hour) => {
                        const booked = occupancy.get(cellKey(hour, agent.id))

                        if (!booked) {
                          return (
                            <td key={hour} className="p-0">
                              <div
                                title={`Libre · ${agent.name} · ${formatHourRange(hour)}`}
                                className="flex h-11 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-300 ring-1 ring-inset ring-slate-200"
                              >
                                Libre
                              </div>
                            </td>
                          )
                        }

                        const tooltip = [
                          booked.fullName,
                          booked.companyName,
                          formatHourRange(hour),
                          booked.hasCompanion ? `+ ${booked.companionName || 'Acompañante'}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')

                        return (
                          <td key={hour} className="p-0">
                            <div
                              title={tooltip}
                              className="flex h-11 cursor-help items-center justify-center rounded-lg bg-emerald-50 px-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"
                            >
                              <span className="truncate">{booked.fullName}</span>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded bg-emerald-50 ring-1 ring-emerald-200" />
                Reservado (pasa el ratón para ver el cliente)
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded bg-slate-50 ring-1 ring-slate-200" />
                Libre
              </span>
              <span className="inline-flex items-center gap-2">
                <CalendarRange className="h-3.5 w-3.5 text-belen-orange" aria-hidden="true" />
                Solo se muestran las reservas aprobadas
              </span>
            </div>
          </>
        )}
      </Card>

      {/* Últimas solicitudes */}
      <Card
        title="Últimas solicitudes"
        subtitle="Las 5 reservas más recientes"
        action={
          hasReservations && (
            <Link to="/admin/reservations">
              <Button variant="ghost" size="sm" icon={Link2}>
                Ver todas
              </Button>
            </Link>
          )
        }
      >
        {reservationsLoading || configLoading ? (
          <ListSkeleton />
        ) : !hasReservations ? (
          <EmptyState
            icon={Share2}
            title="Todavía no hay solicitudes"
            description="Comparte el enlace del formulario público con tus clientes para que empiecen a reservar su cita."
            action={
              <Button variant="primary" icon={Copy} loading={copying} onClick={handleCopyLink}>
                Copiar enlace del formulario
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-belen-blue/10">
            {latest.map((reservation) => (
              <li
                key={reservation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-belen-ink">
                    {reservation.fullName}
                    <span className="font-normal text-slate-400"> · {reservation.companyName}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {dayLabel(config, reservation.day)} · {reservation.hour} ·{' '}
                    {reservation.agentName || 'Sin agente'} ·{' '}
                    {formatDateTime(reservation.createdAt)}
                  </p>
                </div>
                <Badge status={reservation.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
