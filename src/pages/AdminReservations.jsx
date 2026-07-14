import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Ban,
  CalendarX,
  Check,
  Download,
  Inbox,
  Mail,
  Printer,
  RefreshCw,
  Search,
  Send,
  Ticket,
  TriangleAlert,
  X,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '../components/ui'
import TicketPreview from '../components/TicketPreview'

import { useAuth } from '../hooks/useAuth'
import { useAgents } from '../hooks/useAgents'
import { useConfig } from '../hooks/useConfig'
import { useReservations } from '../hooks/useReservations'

import {
  approveReservation,
  cancelReservation,
  rejectReservation,
} from '../services/reservationsService'
import { getTicketsByReservation } from '../services/ticketsService'
import { isEmailConfigured, sendInvitation } from '../services/emailService'

import {
  EMAIL_STATUS,
  EMAIL_STATUS_LABEL,
  RESERVATION_STATUS,
  RESERVATION_STATUS_LABEL,
} from '../lib/constants'
import { csvCell, dayLabel, formatDateTime, formatHourRange } from '../lib/format'

/* ------------------------------------------------------------------ */
/* Utilidades locales                                                   */
/* ------------------------------------------------------------------ */

const ALL = 'all'
const NO_BUSY = { id: null, action: null }

/** Píldoras de estado (también son el filtro por estado). */
const STATUS_PILLS = [
  { value: ALL, label: 'Todas' },
  { value: RESERVATION_STATUS.PENDING, label: RESERVATION_STATUS_LABEL.pending },
  { value: RESERVATION_STATUS.APPROVED, label: RESERVATION_STATUS_LABEL.approved },
  { value: RESERVATION_STATUS.REJECTED, label: RESERVATION_STATUS_LABEL.rejected },
  { value: RESERVATION_STATUS.CANCELLED, label: RESERVATION_STATUS_LABEL.cancelled },
]

/** Minúsculas y sin tildes: así «Pérez» encuentra «perez». */
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Iniciales de respaldo cuando el agente no tiene foto. */
function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

/* ------------------------------------------------------------------ */
/* Impresión de entradas                                                */
/* ------------------------------------------------------------------ */

/**
 * Al imprimir queremos SOLO las entradas: ni panel, ni modal, ni avisos.
 * El área de impresión se monta con un portal directamente en <body>, así que basta
 * con esconder al resto de hijos de <body>. Fuera de la impresión vive fuera de la
 * pantalla (no con display:none) para que los <img> del QR ya estén cargados cuando
 * el usuario pulse «Imprimir».
 */
const PRINT_CSS = `
#belen-print-area {
  position: fixed;
  top: 0;
  left: -12000px;
  width: 960px;
  opacity: 0;
  pointer-events: none;
}
@media print {
  body > *:not(#belen-print-area) { display: none !important; }
  #belen-print-area {
    position: static !important;
    left: auto !important;
    width: 100% !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .belen-print-ticket {
    break-inside: avoid;
    page-break-inside: avoid;
    page-break-after: always;
  }
  .belen-print-ticket:last-child { page-break-after: auto; }
  @page { margin: 12mm; }
}
`

function PrintArea({ tickets, config }) {
  if (typeof document === 'undefined' || !tickets || tickets.length === 0) return null

  return createPortal(
    <div id="belen-print-area" aria-hidden="true">
      <style>{PRINT_CSS}</style>
      {tickets.map((ticket) => (
        <div key={ticket.id} className="belen-print-ticket">
          <TicketPreview ticket={ticket} config={config} />
        </div>
      ))}
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ */
/* Piezas de la tabla                                                   */
/* ------------------------------------------------------------------ */

function AgentCell({ name, photo }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {photo ? (
        <img
          src={photo}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-belen-blue/15"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-belen-blue/10 text-[11px] font-extrabold text-belen-blue"
        >
          {initials(name)}
        </span>
      )}
      <span className="min-w-0 truncate text-sm font-medium text-belen-ink">{name || '—'}</span>
    </div>
  )
}

function ClientCell({ reservation }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-belen-ink">{reservation.fullName}</p>
      <p className="truncate text-xs text-slate-500">
        <span className="font-semibold text-belen-orange">{reservation.clientCode}</span>
        {reservation.companyName ? ` · ${reservation.companyName}` : ''}
      </p>
      <p className="truncate text-xs text-slate-400">{reservation.email}</p>
    </div>
  )
}

function CompanionCell({ reservation }) {
  if (!reservation.hasCompanion) return <span className="text-sm text-slate-400">—</span>
  return (
    <span
      title={reservation.companionName || 'Acompañante'}
      className="inline-flex items-center rounded-full bg-belen-orange/10 px-2 py-0.5 text-xs font-bold text-belen-orange"
    >
      +1
    </span>
  )
}

function MasterclassCell({ reservation }) {
  if (!reservation.masterclass) return <span className="text-sm text-slate-400">—</span>
  return <Check className="h-4 w-4 text-emerald-600" aria-label="Sí" />
}

/** Motivo / nota de las reservas que ya no admiten acciones. */
function ReadOnlyReason({ reservation }) {
  if (reservation.status === RESERVATION_STATUS.REJECTED) {
    return (
      <p className="max-w-[16rem] text-xs leading-snug text-slate-500">
        <span className="font-semibold text-red-600">Motivo: </span>
        {reservation.rejectionReason || 'Sin motivo registrado.'}
      </p>
    )
  }
  return (
    <p className="max-w-[16rem] text-xs leading-snug text-slate-500">
      Horario liberado y entradas anuladas.
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function AdminReservations() {
  // Roles: el agente solo ve/actúa sobre sus propias reservas; seguridad es solo lectura.
  const { user, isAgente, isSeguridad, agentId } = useAuth()
  const toast = useToast()
  const { config, loading: configLoading } = useConfig()
  const { agents } = useAgents()
  // El agente pide únicamente sus reservas (por agentId); superadmin y seguridad las ven todas.
  const { reservations, loading, error } = useReservations(isAgente ? { agentId } : {})

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [dayFilter, setDayFilter] = useState(ALL)
  const [agentFilter, setAgentFilter] = useState(ALL)

  const [busy, setBusy] = useState(NO_BUSY)

  const [approveTarget, setApproveTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [cancelTarget, setCancelTarget] = useState(null)

  const [ticketsTarget, setTicketsTarget] = useState(null)
  const [ticketsState, setTicketsState] = useState({ list: [], loading: false, error: '' })

  const emailReady = isEmailConfigured()

  /* ---------- catálogos para los filtros ---------- */

  const agentsById = useMemo(() => {
    const map = new Map()
    agents.forEach((agent) => map.set(agent.id, agent))
    return map
  }, [agents])

  const agentOptions = useMemo(() => {
    const map = new Map()
    agents.forEach((agent) => map.set(agent.id, agent.name))
    // Un agente borrado puede seguir apareciendo en reservas antiguas: no lo perdemos del filtro.
    reservations.forEach((reservation) => {
      if (reservation.agentId && !map.has(reservation.agentId)) {
        map.set(reservation.agentId, reservation.agentName || 'Agente eliminado')
      }
    })
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
  }, [agents, reservations])

  const dayOptions = useMemo(() => {
    const map = new Map()
    ;(config?.days || []).forEach((day) => map.set(day.id, day.label))
    reservations.forEach((reservation) => {
      if (reservation.day && !map.has(reservation.day)) map.set(reservation.day, reservation.day)
    })
    return [...map.entries()].map(([id, label]) => ({ id, label }))
  }, [config, reservations])

  /* ---------- filtrado ---------- */

  // Base = todo menos el filtro de estado. Así los contadores de las píldoras siguen
  // reflejando el resto de filtros activos.
  const base = useMemo(() => {
    const term = normalize(search).trim()

    return reservations.filter((reservation) => {
      if (dayFilter !== ALL && reservation.day !== dayFilter) return false
      if (agentFilter !== ALL && reservation.agentId !== agentFilter) return false
      if (!term) return true

      const haystack = normalize(
        [
          reservation.fullName,
          reservation.companyName,
          reservation.clientCode,
          reservation.email,
          reservation.companionName,
        ].join(' '),
      )
      return haystack.includes(term)
    })
  }, [reservations, search, dayFilter, agentFilter])

  const counts = useMemo(() => {
    const result = {
      [ALL]: base.length,
      [RESERVATION_STATUS.PENDING]: 0,
      [RESERVATION_STATUS.APPROVED]: 0,
      [RESERVATION_STATUS.REJECTED]: 0,
      [RESERVATION_STATUS.CANCELLED]: 0,
    }
    base.forEach((reservation) => {
      if (result[reservation.status] !== undefined) result[reservation.status] += 1
    })
    return result
  }, [base])

  const filtered = useMemo(
    () => (statusFilter === ALL ? base : base.filter((r) => r.status === statusFilter)),
    [base, statusFilter],
  )

  const hasFilters =
    Boolean(search.trim()) || statusFilter !== ALL || dayFilter !== ALL || agentFilter !== ALL

  const clearFilters = useCallback(() => {
    setSearch('')
    setStatusFilter(ALL)
    setDayFilter(ALL)
    setAgentFilter(ALL)
  }, [])

  /** Aprobadas cuyo correo nunca llegó a salir: el admin tiene que reintentarlo. */
  const pendingEmails = useMemo(
    () =>
      reservations.filter(
        (reservation) =>
          reservation.status === RESERVATION_STATUS.APPROVED &&
          (reservation.emailStatus === EMAIL_STATUS.FAILED ||
            reservation.emailStatus === EMAIL_STATUS.NOT_SENT),
      ).length,
    [reservations],
  )

  /* ---------- entradas de la reserva seleccionada ---------- */

  useEffect(() => {
    if (!ticketsTarget) {
      setTicketsState({ list: [], loading: false, error: '' })
      return undefined
    }

    let active = true
    setTicketsState({ list: [], loading: true, error: '' })

    getTicketsByReservation(ticketsTarget.id)
      .then((list) => {
        if (!active) return
        setTicketsState({ list, loading: false, error: '' })
      })
      .catch((err) => {
        if (!active) return
        setTicketsState({
          list: [],
          loading: false,
          error: err?.message || 'No se pudieron cargar las entradas de esta reserva.',
        })
      })

    return () => {
      active = false
    }
  }, [ticketsTarget])

  /* ---------- acciones ---------- */

  const isBusy = (id, action) => busy.id === id && busy.action === action

  /**
   * Aprobar: transacción atómica (bloquea el slot y emite las entradas) y, acto seguido,
   * envío del correo. Son dos pasos independientes: si el correo falla, la reserva SIGUE
   * aprobada y queda el botón «Reenviar correo».
   */
  const handleApprove = async () => {
    const target = approveTarget
    if (!target) return

    setBusy({ id: target.id, action: 'approve' })

    let approved
    let tickets
    try {
      const result = await approveReservation(target.id, user?.uid)
      approved = result.reservation
      tickets = result.tickets
    } catch (err) {
      setBusy(NO_BUSY)
      toast.error(err?.message || 'No se pudo aprobar la reserva.')
      return
    }

    // Ya está aprobada: cerramos el modal y seguimos con el correo en segundo plano.
    setApproveTarget(null)

    const emailResult = await sendInvitation(approved, tickets, config)
    setBusy(NO_BUSY)

    if (emailResult.ok) {
      toast.success(`Reserva aprobada y entradas enviadas a ${approved.email}.`)
    } else {
      // El Toast solo tiene success / error / info: usamos info (no es un fallo de la
      // aprobación) y el estado del correo queda en rojo en la columna «Correo».
      toast.info(
        `Reserva aprobada, pero el correo NO se pudo enviar: ${emailResult.error} Usa «Reenviar correo».`,
      )
    }
  }

  const handleReject = async () => {
    const target = rejectTarget
    if (!target) return

    const reason = rejectReason.trim()
    if (!reason) {
      setRejectError('Escribe el motivo del rechazo.')
      return
    }

    setBusy({ id: target.id, action: 'reject' })
    try {
      await rejectReservation(target.id, reason, user?.uid)
      setRejectTarget(null)
      setRejectReason('')
      setRejectError('')
      toast.success(`Solicitud de ${target.fullName} rechazada.`)
    } catch (err) {
      toast.error(err?.message || 'No se pudo rechazar la solicitud.')
    } finally {
      setBusy(NO_BUSY)
    }
  }

  const handleCancel = async () => {
    const target = cancelTarget
    if (!target) return

    setBusy({ id: target.id, action: 'cancel' })
    try {
      await cancelReservation(target.id, user?.uid)
      setCancelTarget(null)
      toast.success('Reserva cancelada: el horario quedó libre y las entradas fueron anuladas.')
    } catch (err) {
      toast.error(err?.message || 'No se pudo cancelar la reserva.')
    } finally {
      setBusy(NO_BUSY)
    }
  }

  const handleResendEmail = async (reservation) => {
    setBusy({ id: reservation.id, action: 'email' })
    try {
      const tickets = await getTicketsByReservation(reservation.id)
      if (tickets.length === 0) {
        throw new Error(
          'Esta reserva no tiene entradas emitidas. Cancélala y vuelve a registrarla para volver a emitirlas.',
        )
      }

      const result = await sendInvitation(reservation, tickets, config)
      if (result.ok) {
        toast.success(`Entradas reenviadas a ${reservation.email}.`)
      } else {
        toast.error(`No se pudo enviar el correo: ${result.error}`)
      }
    } catch (err) {
      toast.error(err?.message || 'No se pudo reenviar el correo.')
    } finally {
      setBusy(NO_BUSY)
    }
  }

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.info('No hay reservas que exportar con los filtros actuales.')
      return
    }

    const headers = [
      'Código cliente',
      'Nombre',
      'Empresa',
      'Correo',
      'Teléfono',
      'Agente',
      'Día',
      'Hora',
      'Acompañante',
      'Nombre acompañante',
      'Masterclass',
      'Estado',
      'Correo enviado',
      'Motivo de rechazo',
      'Entradas',
      'Solicitada',
    ]

    const lines = filtered.map((reservation) =>
      [
        reservation.clientCode,
        reservation.fullName,
        reservation.companyName,
        reservation.email,
        reservation.phone,
        reservation.agentName,
        dayLabel(config, reservation.day),
        formatHourRange(reservation.hour),
        reservation.hasCompanion ? 'Sí' : 'No',
        reservation.hasCompanion ? reservation.companionName : '',
        reservation.masterclass ? 'Sí' : 'No',
        RESERVATION_STATUS_LABEL[reservation.status] || reservation.status,
        EMAIL_STATUS_LABEL[reservation.emailStatus] || EMAIL_STATUS_LABEL.not_sent,
        reservation.rejectionReason || '',
        (reservation.ticketIds || []).length,
        formatDateTime(reservation.createdAt),
      ]
        .map(csvCell)
        .join(','),
    )

    // El BOM (\ufeff) hace que Excel abra el archivo en UTF-8 y respete las tildes.
    const csv = `\ufeff${[headers.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `reservas-dia-del-cliente-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

    toast.success(
      `Se exportaron ${filtered.length} ${filtered.length === 1 ? 'reserva' : 'reservas'}.`,
    )
  }

  /* ---------- acciones por fila (compartidas entre tabla y tarjetas) ---------- */

  // Función (no componente) a propósito: así los botones no se remontan en cada render.
  const renderActions = (reservation, { mobile = false } = {}) => {
    const emailStatus = reservation.emailStatus || EMAIL_STATUS.NOT_SENT
    const canResend =
      emailStatus === EMAIL_STATUS.FAILED || emailStatus === EMAIL_STATUS.NOT_SENT

    // En móvil los botones se apilan a ancho completo (objetivo táctil ≥44px con size="md");
    // en escritorio conservan el tamaño compacto y envuelven en la celda de la tabla.
    const size = mobile ? 'md' : 'sm'
    const containerClass = mobile ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'
    const buttonClass = mobile ? 'w-full' : ''

    // Único botón de solo lectura: abre el modal con los TicketPreview. Lo comparten todos los roles.
    const viewTicketsButton = (
      <Button
        size={size}
        className={buttonClass}
        variant="secondary"
        icon={Ticket}
        onClick={() => setTicketsTarget(reservation)}
      >
        Ver entradas
      </Button>
    )

    if (reservation.status === RESERVATION_STATUS.PENDING) {
      // Seguridad es solo lectura: no puede aprobar ni rechazar.
      if (isSeguridad) return <span className="text-sm text-slate-400">Solo lectura</span>
      return (
        <div className={containerClass}>
          <Button
            size={size}
            className={buttonClass}
            variant="primary"
            icon={Check}
            loading={isBusy(reservation.id, 'approve')}
            disabled={busy.id === reservation.id}
            onClick={() => setApproveTarget(reservation)}
          >
            Aprobar
          </Button>
          <Button
            size={size}
            className={buttonClass}
            variant="danger"
            icon={X}
            disabled={busy.id === reservation.id}
            onClick={() => {
              setRejectReason('')
              setRejectError('')
              setRejectTarget(reservation)
            }}
          >
            Rechazar
          </Button>
        </div>
      )
    }

    if (reservation.status === RESERVATION_STATUS.APPROVED) {
      // Seguridad solo puede ver las entradas; nada de reenviar correo ni cancelar.
      if (isSeguridad) return <div className={containerClass}>{viewTicketsButton}</div>
      return (
        <div className={containerClass}>
          {viewTicketsButton}

          {canResend && (
            <Button
              size={size}
              className={buttonClass}
              variant="secondary"
              icon={Send}
              loading={isBusy(reservation.id, 'email')}
              disabled={busy.id === reservation.id}
              onClick={() => handleResendEmail(reservation)}
            >
              Reenviar correo
            </Button>
          )}

          <Button
            size={size}
            className={buttonClass}
            variant="danger"
            icon={Ban}
            disabled={busy.id === reservation.id}
            onClick={() => setCancelTarget(reservation)}
          >
            Cancelar
          </Button>
        </div>
      )
    }

    return <ReadOnlyReason reservation={reservation} />
  }

  /* ---------- render ---------- */

  const isLoading = loading || configLoading

  return (
    <div className="space-y-4">
      {/* -------- Avisos -------- */}
      {!emailReady && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm leading-snug text-amber-800">
            <span className="font-semibold">El envío de correos no está configurado. </span>
            Puedes aprobar reservas y emitir entradas, pero no saldrá ningún correo hasta que pegues
            la URL del Apps Script en <code className="font-mono">APPS_SCRIPT_URL</code> (dentro de{' '}
            <code className="font-mono">src/lib/firebase.js</code>).
          </p>
        </div>
      )}

      {emailReady && pendingEmails > 0 && (
        <button
          type="button"
          onClick={() => setStatusFilter(RESERVATION_STATUS.APPROVED)}
          className="flex w-full items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
        >
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm leading-snug text-amber-800">
            <span className="font-semibold">
              {pendingEmails} {pendingEmails === 1 ? 'reserva aprobada' : 'reservas aprobadas'} sin
              correo enviado.{' '}
            </span>
            Ábrelas y usa «Reenviar correo» para que el cliente reciba sus entradas.
          </p>
        </button>
      )}

      {/* -------- Barra de filtros (pegajosa) -------- */}
      <div className="sticky top-[65px] z-20 -mx-4 border-b border-belen-blue/10 bg-belen-cream/95 px-4 py-3 backdrop-blur md:top-[53px] md:-mx-8 md:px-8">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              {/* 2.875rem = alto de la etiqueta (26px) + medio alto del campo (20px) */}
              <Search
                className="pointer-events-none absolute left-3 top-[2.875rem] h-4 w-4 -translate-y-1/2 text-belen-blue/50"
                aria-hidden="true"
              />
              <Input
                label="Buscar"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nombre, empresa, código o correo"
                className="pl-9"
              />
            </div>

            <Select
              label="Estado"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_PILLS.map((pill) => (
                <option key={pill.value} value={pill.value}>
                  {pill.value === ALL ? 'Todos los estados' : pill.label}
                </option>
              ))}
            </Select>

            <Select
              label="Día"
              value={dayFilter}
              onChange={(event) => setDayFilter(event.target.value)}
            >
              <option value={ALL}>Todos los días</option>
              {dayOptions.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                </option>
              ))}
            </Select>

            {/* El agente solo ve sus propias reservas: filtrar por agente no tiene sentido para él. */}
            {!isAgente && (
              <Select
                label="Agente"
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value)}
              >
                <option value={ALL}>Todos los agentes</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {STATUS_PILLS.map((pill) => {
              const active = statusFilter === pill.value
              return (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => setStatusFilter(pill.value)}
                  aria-pressed={active}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
                    active
                      ? 'bg-belen-blue text-white'
                      : 'bg-white text-belen-blue ring-1 ring-belen-blue/15 hover:bg-belen-blue/5',
                  ].join(' ')}
                >
                  {pill.label}
                  <span
                    className={[
                      'rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums',
                      active ? 'bg-white/20 text-white' : 'bg-belen-blue/10 text-belen-blue',
                    ].join(' ')}
                  >
                    {counts[pill.value] ?? 0}
                  </span>
                </button>
              )
            })}

            <div className="ml-auto flex items-center gap-2">
              {hasFilters && (
                <Button size="sm" variant="ghost" icon={X} onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                onClick={handleExportCsv}
                disabled={isLoading}
              >
                Exportar CSV
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* -------- Contenido -------- */}
      <Card
        title={isAgente ? 'Mis solicitudes' : 'Solicitudes de reserva'}
        subtitle={
          isLoading
            ? 'Cargando solicitudes…'
            : `${filtered.length} de ${reservations.length} ${
                reservations.length === 1 ? 'solicitud' : 'solicitudes'
              }`
        }
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-belen-blue">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-slate-500">Cargando solicitudes…</p>
          </div>
        ) : error ? (
          <EmptyState
            icon={TriangleAlert}
            title="No pudimos cargar las reservas"
            description={error}
            action={
              <Button
                variant="secondary"
                icon={RefreshCw}
                onClick={() => window.location.reload()}
              >
                Reintentar
              </Button>
            }
          />
        ) : reservations.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Todavía no hay solicitudes"
            description="Cuando un cliente reserve desde el formulario público, su solicitud aparecerá aquí en tiempo real."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CalendarX}
            title="Ninguna reserva coincide"
            description="Prueba con otro texto de búsqueda o quita los filtros aplicados."
            action={
              <Button variant="secondary" icon={X} onClick={clearFilters}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <>
            {/* ---- Tabla (escritorio) ---- */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[64rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-belen-blue/10 text-[11px] uppercase tracking-wider text-belen-blue/60">
                    <th className="px-3 py-2 font-extrabold">Cliente</th>
                    <th className="px-3 py-2 font-extrabold">Agente</th>
                    <th className="px-3 py-2 font-extrabold">Día y hora</th>
                    <th className="px-3 py-2 font-extrabold">Acomp.</th>
                    <th className="px-3 py-2 font-extrabold">Master</th>
                    <th className="px-3 py-2 font-extrabold">Estado</th>
                    <th className="px-3 py-2 font-extrabold">Correo</th>
                    <th className="px-3 py-2 text-right font-extrabold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-belen-blue/5">
                  {filtered.map((reservation) => {
                    const agent = agentsById.get(reservation.agentId)
                    const emailStatus = reservation.emailStatus || EMAIL_STATUS.NOT_SENT

                    return (
                      <tr key={reservation.id} className="align-middle hover:bg-belen-cream/60">
                        <td className="max-w-[15rem] px-3 py-3">
                          <ClientCell reservation={reservation} />
                        </td>
                        <td className="max-w-[12rem] px-3 py-3">
                          <AgentCell
                            name={reservation.agentName || agent?.name}
                            photo={agent?.photoBase64}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <p className="text-sm font-semibold text-belen-ink">
                            {dayLabel(config, reservation.day)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatHourRange(reservation.hour)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <CompanionCell reservation={reservation} />
                        </td>
                        <td className="px-3 py-3">
                          <MasterclassCell reservation={reservation} />
                        </td>
                        <td className="px-3 py-3">
                          <Badge status={reservation.status}>
                            {RESERVATION_STATUS_LABEL[reservation.status] || reservation.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge status={emailStatus}>{EMAIL_STATUS_LABEL[emailStatus]}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end">{renderActions(reservation)}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ---- Tarjetas (móvil / tablet) ---- */}
            <ul className="space-y-3 lg:hidden">
              {filtered.map((reservation) => {
                const agent = agentsById.get(reservation.agentId)
                const emailStatus = reservation.emailStatus || EMAIL_STATUS.NOT_SENT

                return (
                  <li
                    key={reservation.id}
                    className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-belen-blue/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <ClientCell reservation={reservation} />
                      <Badge status={reservation.status} className="shrink-0">
                        {RESERVATION_STATUS_LABEL[reservation.status] || reservation.status}
                      </Badge>
                    </div>

                    <div className="mt-3 border-t border-belen-blue/10 pt-3">
                      <AgentCell
                        name={reservation.agentName || agent?.name}
                        photo={agent?.photoBase64}
                      />
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-belen-blue/50">
                          Día y hora
                        </dt>
                        <dd className="truncate font-semibold text-belen-ink">
                          {dayLabel(config, reservation.day)}
                        </dd>
                        <dd className="text-xs text-slate-500">
                          {formatHourRange(reservation.hour)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-belen-blue/50">
                          Correo
                        </dt>
                        <dd className="mt-0.5">
                          <Badge status={emailStatus}>{EMAIL_STATUS_LABEL[emailStatus]}</Badge>
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-belen-blue/50">
                          Acompañante
                        </dt>
                        <dd className="mt-0.5 flex min-w-0 items-center gap-2">
                          <CompanionCell reservation={reservation} />
                          {reservation.hasCompanion && (
                            <span className="min-w-0 truncate text-xs text-slate-500">
                              {reservation.companionName}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-belen-blue/50">
                          Masterclass
                        </dt>
                        <dd className="mt-1">
                          <MasterclassCell reservation={reservation} />
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 border-t border-belen-blue/10 pt-3">
                      {renderActions(reservation, { mobile: true })}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>

      {/* -------- Modal: aprobar -------- */}
      <Modal
        open={Boolean(approveTarget)}
        onClose={() => {
          if (busy.action !== 'approve') setApproveTarget(null)
        }}
        title="Aprobar reserva"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setApproveTarget(null)}
              disabled={busy.action === 'approve'}
            >
              Volver
            </Button>
            <Button
              variant="primary"
              icon={Check}
              loading={busy.action === 'approve'}
              onClick={handleApprove}
            >
              Aprobar y enviar entradas
            </Button>
          </>
        }
      >
        {approveTarget && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              Se bloqueará el horario del agente, se emitirán las entradas con su código QR y se
              enviarán al correo del cliente.
            </p>

            <dl className="divide-y divide-belen-blue/10 rounded-2xl bg-belen-cream/70 px-4 ring-1 ring-belen-blue/10">
              <SummaryRow label="Cliente" value={approveTarget.fullName} />
              <SummaryRow
                label="Empresa"
                value={`${approveTarget.companyName} · ${approveTarget.clientCode}`}
              />
              <SummaryRow label="Correo" value={approveTarget.email} />
              <SummaryRow label="Agente" value={approveTarget.agentName} />
              <SummaryRow
                label="Cita"
                value={`${dayLabel(config, approveTarget.day)} · ${formatHourRange(
                  approveTarget.hour,
                )}`}
              />
              <SummaryRow
                label="Entradas"
                value={
                  approveTarget.hasCompanion
                    ? `2 (titular y ${approveTarget.companionName})`
                    : '1 (titular)'
                }
              />
              <SummaryRow
                label="Masterclass"
                value={approveTarget.masterclass ? 'Sí asistirá' : 'No asistirá'}
              />
            </dl>

            <p className="text-xs leading-relaxed text-slate-500">
              Si otro administrador acaba de ocupar este horario, la aprobación se cancelará y no se
              emitirá ninguna entrada.
            </p>
          </div>
        )}
      </Modal>

      {/* -------- Modal: rechazar -------- */}
      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => {
          if (busy.action !== 'reject') setRejectTarget(null)
        }}
        title="Rechazar solicitud"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setRejectTarget(null)}
              disabled={busy.action === 'reject'}
            >
              Volver
            </Button>
            <Button
              variant="danger"
              icon={X}
              loading={busy.action === 'reject'}
              onClick={handleReject}
            >
              Rechazar solicitud
            </Button>
          </>
        }
      >
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              Vas a rechazar la solicitud de{' '}
              <span className="font-semibold text-belen-ink">{rejectTarget.fullName}</span> (
              {rejectTarget.companyName}). No se emitirán entradas y el horario seguirá libre.
            </p>

            <Textarea
              label="Motivo del rechazo"
              required
              rows={4}
              value={rejectReason}
              error={rejectError}
              onChange={(event) => {
                setRejectReason(event.target.value)
                if (rejectError) setRejectError('')
              }}
              placeholder="Ej.: El agente no tiene disponibilidad ese día. Le contactaremos para reagendar."
              hint="Queda guardado en la solicitud para que cualquier administrador sepa qué pasó."
            />
          </div>
        )}
      </Modal>

      {/* -------- Modal: cancelar -------- */}
      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => {
          if (busy.action !== 'cancel') setCancelTarget(null)
        }}
        title="Cancelar reserva aprobada"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setCancelTarget(null)}
              disabled={busy.action === 'cancel'}
            >
              Volver
            </Button>
            <Button
              variant="danger"
              icon={Ban}
              loading={busy.action === 'cancel'}
              onClick={handleCancel}
            >
              Sí, cancelar la reserva
            </Button>
          </>
        }
      >
        {cancelTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
              <p className="text-sm leading-snug text-red-700">
                Se liberará el horario del agente (quedará disponible para otro cliente) y las
                entradas ya emitidas se anularán: sus códigos QR dejarán de funcionar en la puerta.
                Esta acción no se puede deshacer.
              </p>
            </div>

            <dl className="divide-y divide-belen-blue/10 rounded-2xl bg-belen-cream/70 px-4 ring-1 ring-belen-blue/10">
              <SummaryRow label="Cliente" value={cancelTarget.fullName} />
              <SummaryRow label="Agente" value={cancelTarget.agentName} />
              <SummaryRow
                label="Cita"
                value={`${dayLabel(config, cancelTarget.day)} · ${formatHourRange(
                  cancelTarget.hour,
                )}`}
              />
              <SummaryRow
                label="Entradas a anular"
                value={String((cancelTarget.ticketIds || []).length)}
              />
            </dl>
          </div>
        )}
      </Modal>

      {/* -------- Modal: ver entradas -------- */}
      <Modal
        open={Boolean(ticketsTarget)}
        onClose={() => setTicketsTarget(null)}
        title={ticketsTarget ? `Entradas de ${ticketsTarget.fullName}` : 'Entradas'}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTicketsTarget(null)}>
              Cerrar
            </Button>
            <Button
              variant="primary"
              icon={Printer}
              disabled={ticketsState.loading || ticketsState.list.length === 0}
              onClick={() => window.print()}
            >
              Imprimir
            </Button>
          </>
        }
      >
        {ticketsState.loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-belen-blue">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-slate-500">Cargando entradas…</p>
          </div>
        ) : ticketsState.error ? (
          <EmptyState
            icon={TriangleAlert}
            title="No pudimos cargar las entradas"
            description={ticketsState.error}
            action={
              <Button
                variant="secondary"
                icon={RefreshCw}
                onClick={() => setTicketsTarget({ ...ticketsTarget })}
              >
                Reintentar
              </Button>
            }
          />
        ) : ticketsState.list.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title="Esta reserva no tiene entradas"
            description="Las entradas se emiten al aprobar la reserva. Si la cancelaste, sus entradas fueron anuladas."
          />
        ) : (
          <div className="space-y-6">
            {ticketsState.list.map((ticket) => (
              <div key={ticket.id} className="overflow-x-auto">
                <TicketPreview ticket={ticket} config={config} />
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Copia oculta de las entradas: es lo único que sale por la impresora. */}
      <PrintArea tickets={ticketsState.list} config={config} />
    </div>
  )
}

/** Fila etiqueta / valor de los resúmenes de los modales. */
function SummaryRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-belen-blue/60">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-belen-ink">
        {value || '—'}
      </dd>
    </div>
  )
}
