import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Download,
  FilterX,
  Gift,
  Ticket,
  UserCheck,
  UtensilsCrossed,
} from 'lucide-react'

import { useAgents } from '../hooks/useAgents'
import { useAuth } from '../hooks/useAuth'
import { useConfig } from '../hooks/useConfig'
import { markPrizeAwarded, removePrizeAwarded, subscribeTickets } from '../services/ticketsService'
import { HOLDER_TYPE, HOLDER_TYPE_LABEL, TICKET_STATUS, TICKET_STATUS_LABEL } from '../lib/constants'
import { dayLabel, formatHourRange, formatTime } from '../lib/format'
import { exportToXlsx } from '../lib/exportXlsx'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'

/** Pestañas de la vista. `key` null = "Todos". */
const TABS = [
  { id: TICKET_STATUS.INSIDE, label: 'Dentro del evento' },
  { id: TICKET_STATUS.EXITED, label: 'Ya salieron' },
  { id: TICKET_STATUS.VALID, label: 'No han asistido' },
  { id: 'all', label: 'Todos' },
]

const XLSX_HEADERS = [
  'Portador',
  'Tipo',
  'Empresa',
  'Código de cliente',
  'Asesor',
  'Día',
  'Hora',
  'Serial',
  'Estado',
  'Hora de ingreso',
  'Hora de salida',
  'Comida',
  'Premio',
]

/** Base común del distintivo de premio (botón pulsable o indicador de solo lectura). */
const PRIZE_BASE =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-150'

/** Dorado de marca: solo cuando la persona YA recibió su premio. */
const PRIZE_AWARDED =
  'belen-glow bg-gradient-to-br from-amber-300 via-amber-400 to-belen-orange text-white shadow-[0_0_12px_rgba(242,106,33,0.55)]'

/** Sin premio: vacío, con un aro muy sutil. */
const PRIZE_EMPTY = 'bg-transparent text-slate-400 ring-1 ring-slate-200'

/**
 * Marcas diacríticas (U+0300–U+036F). El rango se construye con fromCharCode para que el patrón
 * no dependa de caracteres invisibles pegados en el código fuente.
 */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
)

/** Compara sin acentos ni mayúsculas: "Pérez" encuentra a "perez". */
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD') // separa cada letra de su acento
    .replace(COMBINING_MARKS, '')
}

/** El estilo del Badge del portador: el titular lleva el azul de la marca. */
function holderBadgeClass(holderType) {
  return holderType === HOLDER_TYPE.TITULAR
    ? '!bg-belen-blue/5 !text-belen-blue !ring-belen-blue/20'
    : ''
}

export default function AdminAttendance() {
  const { config, error: configError } = useConfig()
  const { agents } = useAgents()
  const { user, isSuperAdmin, isSeguridad } = useAuth()
  const toast = useToast()

  // Solo el administrador y seguridad pueden escribir en tickets (reglas de Firestore).
  // El agente ve el premio, pero como indicador de solo lectura.
  const canAwardPrize = isSuperAdmin || isSeguridad

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [tab, setTab] = useState(TICKET_STATUS.INSIDE)
  const [search, setSearch] = useState('')
  const [dayFilter, setDayFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')

  // Entrada cuyo premio se está confirmando en el modal, y si ya se está guardando.
  const [prizeTarget, setPrizeTarget] = useState(null)
  const [prizeBusy, setPrizeBusy] = useState(false)

  useEffect(() => {
    let alive = true
    let unsubscribe = () => {}

    try {
      unsubscribe = subscribeTickets((next) => {
        if (!alive) return
        setTickets(next)
        setLoading(false)
      })
    } catch (subscriptionError) {
      console.error('[AdminAttendance] No se pudo escuchar las entradas:', subscriptionError)
      setError('No pudimos cargar las entradas emitidas. Revisa tu conexión y recarga la página.')
      setLoading(false)
    }

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const days = config?.days ?? []

  /** Todo menos la pestaña: así los contadores y las pestañas hablan del mismo universo. */
  const scoped = useMemo(() => {
    const term = normalize(search.trim())

    return tickets.filter((ticket) => {
      if (dayFilter !== 'all' && ticket.day !== dayFilter) return false
      if (agentFilter !== 'all' && ticket.agentId !== agentFilter) return false
      if (!term) return true

      const haystack = normalize(
        [
          ticket.holderName,
          ticket.companyName,
          ticket.clientCode,
          ticket.agentName,
          ticket.serial,
        ].join(' '),
      )
      return haystack.includes(term)
    })
  }, [tickets, search, dayFilter, agentFilter])

  const counts = useMemo(() => {
    const result = { inside: 0, exited: 0, valid: 0, meals: 0, prizes: 0, all: scoped.length }
    for (const ticket of scoped) {
      if (ticket.status === TICKET_STATUS.INSIDE) result.inside += 1
      else if (ticket.status === TICKET_STATUS.EXITED) result.exited += 1
      else result.valid += 1

      if (ticket.mealAt) result.meals += 1
      if (ticket.prizeAt) result.prizes += 1
    }
    return result
  }, [scoped])

  const visible = useMemo(
    () => (tab === 'all' ? scoped : scoped.filter((ticket) => ticket.status === tab)),
    [scoped, tab],
  )

  const hasFilters = Boolean(search.trim()) || dayFilter !== 'all' || agentFilter !== 'all'

  const clearFilters = useCallback(() => {
    setSearch('')
    setDayFilter('all')
    setAgentFilter('all')
  }, [])

  /** Abre el modal de confirmación del premio (marcar o corregir). */
  const requestPrize = useCallback(
    (ticket) => {
      if (!canAwardPrize) return
      setPrizeTarget(ticket)
    },
    [canAwardPrize],
  )

  const closePrizeModal = useCallback(() => {
    if (prizeBusy) return
    setPrizeTarget(null)
  }, [prizeBusy])

  /** Confirma el modal: si la entrada ya tenía premio lo QUITA; si no, lo marca. */
  const confirmPrize = useCallback(async () => {
    if (!prizeTarget || prizeBusy) return

    const target = prizeTarget
    const removing = Boolean(target.prizeAt)

    setPrizeBusy(true)
    try {
      if (removing) await removePrizeAwarded(target.id)
      else await markPrizeAwarded(target.id, user?.uid)

      toast.success(
        removing
          ? `Quitamos la marca de premio de ${target.holderName}.`
          : `Registramos el premio de ${target.holderName}.`,
      )
      setPrizeTarget(null)
    } catch (prizeError) {
      console.error('[AdminAttendance] No se pudo actualizar el premio:', prizeError)
      toast.error(prizeError?.message || 'No se pudo actualizar el premio. Inténtalo de nuevo.')
    } finally {
      setPrizeBusy(false)
    }
  }, [prizeTarget, prizeBusy, user, toast])

  // Solo la fila que se está guardando muestra su spinner.
  const prizeSavingId = prizeBusy ? prizeTarget?.id : null
  const removingPrize = Boolean(prizeTarget?.prizeAt)

  const exportToExcel = useCallback(() => {
    if (visible.length === 0) {
      toast.info('No hay entradas que exportar con los filtros actuales.')
      return
    }

    // Un objeto plano por entrada visible: la clave es el encabezado de columna.
    const rows = visible.map((ticket) => ({
      Portador: ticket.holderName,
      Tipo: HOLDER_TYPE_LABEL[ticket.holderType] || ticket.holderType,
      Empresa: ticket.companyName,
      'Código de cliente': ticket.clientCode,
      Asesor: ticket.agentName,
      Día: dayLabel(config, ticket.day),
      Hora: formatHourRange(ticket.hour),
      Serial: ticket.serial,
      Estado: TICKET_STATUS_LABEL[ticket.status] || ticket.status,
      'Hora de ingreso': formatTime(ticket.checkInAt),
      'Hora de salida': formatTime(ticket.checkOutAt),
      Comida: ticket.mealAt ? `Sí (${formatTime(ticket.mealAt)})` : 'No',
      Premio: ticket.prizeAt ? `Sí (${formatTime(ticket.prizeAt)})` : 'No',
    }))

    exportToXlsx(rows, {
      fileName: 'asistencia-dia-del-cliente.xlsx',
      sheetName: 'Asistencia',
      headers: XLSX_HEADERS,
    })

    toast.success(`Exportamos ${visible.length} entrada${visible.length === 1 ? '' : 's'} a Excel.`)
  }, [visible, config, toast])

  const feedError = error || (configError && !config ? configError : '')

  return (
    <div className="space-y-5">
      {feedError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700 ring-1 ring-red-200"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{feedError}</p>
        </div>
      )}

      {/* Contadores */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Entradas emitidas"
          value={counts.all}
          loading={loading}
          className="bg-white text-belen-blue ring-belen-blue/15"
        />
        <StatTile
          label="Dentro del evento"
          value={counts.inside}
          loading={loading}
          className="bg-emerald-50 text-emerald-700 ring-emerald-200"
        />
        <StatTile
          label="Ya salieron"
          value={counts.exited}
          loading={loading}
          className="bg-slate-100 text-slate-600 ring-slate-200"
        />
        <StatTile
          label="No han asistido"
          value={counts.valid}
          loading={loading}
          className="bg-amber-50 text-amber-700 ring-amber-200"
        />
        <StatTile
          label="Comidas entregadas"
          value={counts.meals}
          loading={loading}
          className="bg-white text-emerald-700 ring-emerald-200"
        />
        <StatTile
          label="Premios entregados"
          value={counts.prizes}
          loading={loading}
          className="bg-gradient-to-br from-amber-50 to-orange-50 text-belen-orange ring-belen-orange/25"
        />
      </div>

      <Card
        title="Asistencia"
        subtitle="Todas las entradas emitidas, en vivo."
        action={
          <Button variant="secondary" size="sm" icon={Download} onClick={exportToExcel}>
            Exportar a Excel
          </Button>
        }
      >
        {/* Filtros */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Buscar"
            placeholder="Nombre, empresa, código, asesor o serial"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />

          <Select
            label="Día"
            value={dayFilter}
            onChange={(event) => setDayFilter(event.target.value)}
          >
            <option value="all">Todos los días</option>
            {days.map((day) => (
              <option key={day.id} value={day.id}>
                {day.label}
              </option>
            ))}
          </Select>

          <Select
            label="Asesor"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
          >
            <option value="all">Todos los asesores</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </div>

        {hasFilters && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" icon={FilterX} onClick={clearFilters}>
              Limpiar filtros
            </Button>
          </div>
        )}

        {/* Pestañas */}
        <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div
            role="tablist"
            aria-label="Estado de asistencia"
            className="flex w-max min-w-full gap-1 rounded-xl bg-belen-blue/5 p-1"
          >
            {TABS.map((item) => {
              const active = tab === item.id
              const count = counts[item.id] ?? 0

              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2',
                    'text-xs font-semibold transition-colors sm:text-sm',
                    active
                      ? 'bg-white text-belen-blue shadow-sm ring-1 ring-belen-blue/15'
                      : 'text-slate-500 hover:text-belen-blue',
                  ].join(' ')}
                >
                  {item.label}
                  <span
                    className={[
                      'rounded-full px-1.5 py-0.5 text-[11px] font-bold',
                      active ? 'bg-belen-blue text-white' : 'bg-white text-slate-500',
                    ].join(' ')}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Contenido */}
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-14 text-belen-blue">
              <Spinner size="lg" />
              <span className="text-sm font-medium">Cargando las entradas…</span>
            </div>
          ) : tickets.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="Aún no hay entradas emitidas"
              description="Cuando apruebes la primera reserva, sus entradas aparecerán aquí para el control de acceso."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title="Sin resultados"
              description={
                hasFilters
                  ? 'Ninguna entrada coincide con los filtros aplicados.'
                  : 'No hay entradas en este estado todavía.'
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" icon={FilterX} onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              {/* Móvil / tablet: tarjetas (hasta <1024px) */}
              <ul className="space-y-3 lg:hidden">
                {visible.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    config={config}
                    canAwardPrize={canAwardPrize}
                    prizeSaving={prizeSavingId === ticket.id}
                    onPrize={requestPrize}
                  />
                ))}
              </ul>

              {/* Escritorio: tabla (≥1024px, con scroll horizontal propio) */}
              <div className="-mx-4 hidden overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:block">
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Portador</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Empresa</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Asesor</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Cita</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Serial</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Entrada</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Salida</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Comida</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Estado</th>
                      <th className="border-b border-belen-blue/10 py-2 text-right font-bold">
                        Premio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((ticket) => (
                      <tr key={ticket.id} className="align-top">
                        <td className="border-b border-belen-blue/5 py-3 pr-4">
                          <p className="font-semibold text-belen-ink">{ticket.holderName}</p>
                          <Badge
                            status="neutral"
                            className={`mt-1 ${holderBadgeClass(ticket.holderType)}`}
                          >
                            {HOLDER_TYPE_LABEL[ticket.holderType] || ticket.holderType}
                          </Badge>
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4">
                          <p className="font-medium text-belen-ink">{ticket.companyName}</p>
                          <p className="text-xs text-slate-500">{ticket.clientCode}</p>
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4 text-slate-600">
                          {ticket.agentName}
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4">
                          <p className="font-medium text-belen-ink">{dayLabel(config, ticket.day)}</p>
                          <p className="text-xs text-slate-500">{formatHourRange(ticket.hour)}</p>
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4 font-mono text-xs font-semibold text-belen-blue">
                          {ticket.serial}
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4 text-slate-600">
                          {formatTime(ticket.checkInAt)}
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4 text-slate-600">
                          {formatTime(ticket.checkOutAt)}
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4">
                          <MealBadge ticket={ticket} />
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 pr-4">
                          <Badge status={ticket.status} />
                        </td>
                        <td className="border-b border-belen-blue/5 py-3 text-right">
                          <PrizeControl
                            ticket={ticket}
                            canAwardPrize={canAwardPrize}
                            saving={prizeSavingId === ticket.id}
                            onPrize={requestPrize}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* -------- Modal: registrar / quitar premio -------- */}
      <Modal
        open={Boolean(prizeTarget)}
        onClose={closePrizeModal}
        title={removingPrize ? 'Quitar el premio' : 'Registrar premio'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closePrizeModal} disabled={prizeBusy}>
              Volver
            </Button>
            <Button
              variant={removingPrize ? 'danger' : 'primary'}
              icon={Gift}
              loading={prizeBusy}
              onClick={confirmPrize}
            >
              {removingPrize ? 'Sí, quitar el premio' : 'Sí, entregó un premio'}
            </Button>
          </>
        }
      >
        {prizeTarget && (
          <div className="space-y-3">
            <p className="text-sm font-medium leading-relaxed text-belen-ink">
              {removingPrize ? (
                <>
                  ¿Quitar la marca de premio de{' '}
                  <strong className="text-belen-blue">{prizeTarget.holderName}</strong>?
                </>
              ) : (
                <>
                  ¿Registrar que <strong className="text-belen-blue">{prizeTarget.holderName}</strong>{' '}
                  recibió un premio?
                </>
              )}
            </p>

            <p className="text-xs text-slate-500">
              {prizeTarget.companyName} ·{' '}
              <span className="font-mono font-semibold text-belen-blue">{prizeTarget.serial}</span>
            </p>

            <p className="text-xs leading-relaxed text-slate-500">
              {removingPrize
                ? 'Úsalo solo para CORREGIR una marca equivocada: la persona volverá a aparecer como que no ha recibido premio y podrá marcarse de nuevo.'
                : 'Quedará marcado como entregado en la lista de asistencia. Si te equivocas, puedes quitar la marca volviendo a pulsar el regalo.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Distintivo del premio. Es un BOTÓN si el usuario puede escribir en tickets (superadmin o
 * seguridad) y la persona está dentro del evento — o ya tiene el premio, para poder corregirlo.
 * Para el agente (y para quien aún no ha entrado) es solo un indicador.
 */
function PrizeControl({ ticket, canAwardPrize, saving, onPrize }) {
  const awarded = Boolean(ticket.prizeAt)
  // Se puede premiar a quien asistió: está DENTRO ('inside') o YA SALIÓ ('exited'). Esto último
  // permite que un administrador registre un premio después del evento, si en el momento no se pudo.
  // Si ya lo tiene, sigue siendo accionable en cualquier estado para poder deshacer un error.
  const attended = ticket.status === TICKET_STATUS.INSIDE || ticket.status === TICKET_STATUS.EXITED
  const interactive = canAwardPrize && (awarded || attended)

  const look = awarded ? PRIZE_AWARDED : PRIZE_EMPTY
  const stateLabel = awarded
    ? `${ticket.holderName} ya recibió un premio (${formatTime(ticket.prizeAt)})`
    : `${ticket.holderName} aún no ha recibido premio`

  if (!interactive) {
    return (
      <span
        className={[PRIZE_BASE, look].join(' ')}
        title={stateLabel}
        role="img"
        aria-label={stateLabel}
      >
        <Gift className="h-4 w-4" aria-hidden="true" />
      </span>
    )
  }

  const actionLabel = awarded
    ? `Quitar el premio de ${ticket.holderName} (se marcó por error)`
    : `Registrar el premio de ${ticket.holderName}`

  return (
    <button
      type="button"
      onClick={() => onPrize(ticket)}
      disabled={saving}
      aria-label={actionLabel}
      aria-pressed={awarded}
      title={`${stateLabel} — ${actionLabel}`}
      className={[
        PRIZE_BASE,
        look,
        awarded
          ? 'hover:brightness-105'
          : 'hover:bg-amber-50 hover:text-belen-orange hover:ring-belen-orange/40',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'disabled:cursor-not-allowed disabled:opacity-60',
      ].join(' ')}
    >
      {saving ? <Spinner size="xs" /> : <Gift className="h-4 w-4" aria-hidden="true" />}
    </button>
  )
}

/** Distintivo informativo de la comida: verde si ya la retiró, muy tenue si no. */
function MealBadge({ ticket }) {
  const taken = Boolean(ticket.mealAt)

  return (
    <span
      className="inline-flex"
      title={
        taken
          ? `Retiró su comida a las ${formatTime(ticket.mealAt)}`
          : 'Aún no ha retirado su comida'
      }
    >
      <Badge
        status={taken ? 'approved' : 'neutral'}
        className={taken ? '' : '!bg-transparent !text-slate-400 !ring-slate-200'}
      >
        <UtensilsCrossed className="h-3 w-3 shrink-0" aria-hidden="true" />
        {taken ? 'Comida' : 'Sin comida'}
      </Badge>
    </span>
  )
}

function StatTile({ label, value, loading, className }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${className}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold leading-none sm:text-3xl">
        {loading ? <Spinner size="sm" /> : value}
      </p>
    </div>
  )
}

function TicketCard({ ticket, config, canAwardPrize, prizeSaving, onPrize }) {
  return (
    <li className="rounded-2xl bg-white p-4 ring-1 ring-belen-blue/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-belen-ink">{ticket.holderName}</p>
          <p className="truncate text-sm text-slate-500">{ticket.companyName}</p>
        </div>
        <Badge status={ticket.status} className="shrink-0" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge status="neutral" className={holderBadgeClass(ticket.holderType)}>
          {HOLDER_TYPE_LABEL[ticket.holderType] || ticket.holderType}
        </Badge>
        <span className="font-mono text-xs font-semibold text-belen-blue">{ticket.serial}</span>
        <span className="text-xs text-slate-500">{ticket.clientCode}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-belen-blue/10 pt-3 text-sm">
        <CardField label="Asesor" value={ticket.agentName} />
        <CardField
          label="Cita"
          value={`${dayLabel(config, ticket.day)} · ${formatHourRange(ticket.hour)}`}
        />
        <CardField label="Entrada" value={formatTime(ticket.checkInAt)} />
        <CardField label="Salida" value={formatTime(ticket.checkOutAt)} />
      </dl>

      {/* Comida (informativa) y premio (accionable), al extremo derecho de la tarjeta. */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-belen-blue/10 pt-3">
        <MealBadge ticket={ticket} />
        <PrizeControl
          ticket={ticket}
          canAwardPrize={canAwardPrize}
          saving={prizeSaving}
          onPrize={onPrize}
        />
      </div>
    </li>
  )
}

function CardField({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="truncate font-medium text-belen-ink">{value || '—'}</dd>
    </div>
  )
}
