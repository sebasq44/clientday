import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, FilterX, Ticket, UserCheck } from 'lucide-react'

import { useAgents } from '../hooks/useAgents'
import { useConfig } from '../hooks/useConfig'
import { subscribeTickets } from '../services/ticketsService'
import { HOLDER_TYPE, HOLDER_TYPE_LABEL, TICKET_STATUS, TICKET_STATUS_LABEL } from '../lib/constants'
import { csvCell, dayLabel, formatHourRange, formatTime } from '../lib/format'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
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

const CSV_HEADERS = [
  'Serial',
  'Portador',
  'Tipo',
  'Empresa',
  'Código de cliente',
  'Agente',
  'Día',
  'Hora',
  'Estado',
  'Entrada',
  'Salida',
  'Masterclass',
]

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
  const toast = useToast()

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [tab, setTab] = useState(TICKET_STATUS.INSIDE)
  const [search, setSearch] = useState('')
  const [dayFilter, setDayFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')

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
    const result = { inside: 0, exited: 0, valid: 0, all: scoped.length }
    for (const ticket of scoped) {
      if (ticket.status === TICKET_STATUS.INSIDE) result.inside += 1
      else if (ticket.status === TICKET_STATUS.EXITED) result.exited += 1
      else result.valid += 1
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

  const exportCsv = useCallback(() => {
    if (visible.length === 0) {
      toast.info('No hay entradas que exportar con los filtros actuales.')
      return
    }

    const rows = visible.map((ticket) => [
      ticket.serial,
      ticket.holderName,
      HOLDER_TYPE_LABEL[ticket.holderType] || ticket.holderType,
      ticket.companyName,
      ticket.clientCode,
      ticket.agentName,
      dayLabel(config, ticket.day),
      ticket.hour,
      TICKET_STATUS_LABEL[ticket.status] || ticket.status,
      formatTime(ticket.checkInAt),
      formatTime(ticket.checkOutAt),
      ticket.masterclass ? 'Sí' : 'No',
    ])

    const csv = [CSV_HEADERS, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')

    // El BOM (U+FEFF) hace que Excel abra el archivo con los acentos correctos.
    const bom = String.fromCharCode(0xfeff)
    const blob = new Blob([`${bom}${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `asistencia-dia-del-cliente-${config?.eventYear || 2026}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success(`Exportamos ${visible.length} entrada${visible.length === 1 ? '' : 's'} a CSV.`)
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      </div>

      <Card
        title="Asistencia"
        subtitle="Todas las entradas emitidas, en vivo."
        action={
          <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv}>
            Exportar CSV
          </Button>
        }
      >
        {/* Filtros */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Buscar"
            placeholder="Nombre, empresa, código, agente o serial"
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
            label="Agente"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
          >
            <option value="all">Todos los agentes</option>
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
              {/* Móvil: tarjetas */}
              <ul className="space-y-3 md:hidden">
                {visible.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} config={config} />
                ))}
              </ul>

              {/* Escritorio: tabla */}
              <div className="-mx-4 hidden overflow-x-auto px-4 sm:-mx-6 sm:px-6 md:block">
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Portador</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Empresa</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Agente</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Cita</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Serial</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Entrada</th>
                      <th className="border-b border-belen-blue/10 py-2 pr-4 font-bold">Salida</th>
                      <th className="border-b border-belen-blue/10 py-2 font-bold">Estado</th>
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
                        <td className="border-b border-belen-blue/5 py-3">
                          <Badge status={ticket.status} />
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
    </div>
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

function TicketCard({ ticket, config }) {
  return (
    <li className="rounded-2xl bg-white p-4 ring-1 ring-belen-blue/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-belen-ink">{ticket.holderName}</p>
          <p className="truncate text-sm text-slate-500">{ticket.companyName}</p>
        </div>
        <Badge status={ticket.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge status="neutral" className={holderBadgeClass(ticket.holderType)}>
          {HOLDER_TYPE_LABEL[ticket.holderType] || ticket.holderType}
        </Badge>
        <span className="font-mono text-xs font-semibold text-belen-blue">{ticket.serial}</span>
        <span className="text-xs text-slate-500">{ticket.clientCode}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-belen-blue/10 pt-3 text-sm">
        <CardField label="Agente" value={ticket.agentName} />
        <CardField
          label="Cita"
          value={`${dayLabel(config, ticket.day)} · ${formatHourRange(ticket.hour)}`}
        />
        <CardField label="Entrada" value={formatTime(ticket.checkInAt)} />
        <CardField label="Salida" value={formatTime(ticket.checkOutAt)} />
      </dl>
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
