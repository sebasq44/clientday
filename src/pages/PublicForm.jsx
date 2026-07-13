import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock,
  GraduationCap,
  Lock,
  Mail,
  RefreshCw,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react'

import Logo from '../components/Logo'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'

import { useAgents } from '../hooks/useAgents'
import { useConfig } from '../hooks/useConfig'

import { createReservation } from '../services/reservationsService'
import { getOccupiedSlots, subscribeOccupiedSlots } from '../services/availabilityService'

import { ERRORS, slotId } from '../lib/constants'
import { clean, dayLabel, dayLetter, formatHourRange, isValidEmail } from '../lib/format'

/* ------------------------------------------------------------------------------------------------
 * Estilos locales de la página
 * - `belen-logo-invert` / `belen-logo-white`: el SVG de <Logo> lleva los colores como atributos de
 *   presentación, y una regla CSS gana siempre a un atributo de presentación. Así el logo se lee en
 *   blanco sobre el azul de la cabecera sin tocar components/Logo.jsx (es de otro agente).
 * - El resto son las animaciones de la pantalla de confirmación (se anulan si el sistema pide
 *   movimiento reducido).
 * ---------------------------------------------------------------------------------------------- */
const PAGE_STYLES = `
  .belen-logo-invert text { fill: #ffffff; }
  .belen-logo-invert path[stroke='#1B3B8B'] { stroke: #ffffff; }
  .belen-logo-white path { stroke: #ffffff; }

  @keyframes belen-pop {
    0%   { opacity: 0; transform: scale(0.4); }
    60%  { opacity: 1; transform: scale(1.08); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes belen-draw { to { stroke-dashoffset: 0; } }
  @keyframes belen-ring {
    0%   { opacity: 0.55; transform: scale(1); }
    100% { opacity: 0; transform: scale(1.45); }
  }
  @keyframes belen-fade-up {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .belen-pop  { animation: belen-pop 460ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  .belen-ring { animation: belen-ring 1.8s ease-out 0.35s infinite; }
  .belen-draw {
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: belen-draw 560ms 260ms cubic-bezier(0.65, 0, 0.45, 1) forwards;
  }
  .belen-fade-up { animation: belen-fade-up 420ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  .belen-delay-1 { animation-delay: 120ms; }
  .belen-delay-2 { animation-delay: 240ms; }

  @media (prefers-reduced-motion: reduce) {
    .belen-pop, .belen-ring, .belen-draw, .belen-fade-up { animation: none !important; }
    .belen-draw { stroke-dashoffset: 0; }
  }
`

/** El lema ya viene dibujado dentro del SVG de <Logo variant="full">. */
const LOGO_TAGLINE = 'Conexiones que impulsan'

/** Orden de los campos: define a cuál se hace scroll cuando la validación falla. */
const FIELD_ORDER = [
  'clientCode',
  'fullName',
  'companyName',
  'email',
  'phone',
  'hasCompanion',
  'companionName',
  'agentId',
  'day',
  'hour',
  'masterclass',
]

const EMPTY_FORM = {
  clientCode: '',
  fullName: '',
  companyName: '',
  email: '',
  phone: '',
  hasCompanion: null,
  companionName: '',
  agentId: '',
  day: '',
  hour: '',
  masterclass: null,
}

/** Iniciales para el avatar de respaldo cuando el agente no tiene foto. */
function initials(name) {
  const parts = clean(name).split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  return `${parts[0][0]}${parts[1] ? parts[1][0] : ''}`.toUpperCase()
}

/* ------------------------------------------------------------------------------------------------
 * Piezas de presentación
 * ---------------------------------------------------------------------------------------------- */

function SectionTitle({ icon: Icon, children, required = false, hint }) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-belen-ink">
        <Icon className="h-4 w-4 shrink-0 text-belen-orange" aria-hidden="true" />
        <span>
          {children}
          {required && (
            <span className="ml-0.5 text-belen-orange" aria-hidden="true">
              *
            </span>
          )}
        </span>
      </h3>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function FieldError({ message }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-2 text-xs font-medium text-red-600">
      {message}
    </p>
  )
}

/** Par de tarjetas Sí / No. `value` es true | false | null. */
function YesNoCards({ value, onChange, invalid = false, yesLabel = 'Sí', noLabel = 'No' }) {
  const options = [
    { key: 'yes', label: yesLabel, selected: value === true, next: true },
    { key: 'no', label: noLabel, selected: value === false, next: false },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.selected}
          onClick={() => onChange(option.next)}
          className={[
            'relative flex h-14 items-center justify-center rounded-xl bg-white text-sm font-semibold',
            'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
            option.selected
              ? 'text-belen-blue shadow-card ring-2 ring-belen-orange'
              : invalid
                ? 'text-slate-600 ring-1 ring-red-300 hover:ring-belen-blue/40'
                : 'text-slate-600 ring-1 ring-belen-blue/15 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
          ].join(' ')}
        >
          {option.selected && (
            <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-belen-orange text-white">
              <Check className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  )
}

function AgentCard({ agent, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(agent.id)}
      className={[
        'group relative flex flex-col items-center gap-2 rounded-2xl bg-white p-3 text-center',
        'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
        selected
          ? 'shadow-card ring-2 ring-belen-orange'
          : 'ring-1 ring-belen-blue/15 hover:-translate-y-0.5 hover:shadow-card hover:ring-belen-blue/40',
      ].join(' ')}
    >
      {selected && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-belen-orange text-white shadow-sm">
          <Check className="h-3 w-3" aria-hidden="true" />
        </span>
      )}

      {agent.photoBase64 ? (
        <img
          src={agent.photoBase64}
          alt=""
          className="h-16 w-16 rounded-full object-cover ring-2 ring-white shadow-sm sm:h-20 sm:w-20"
        />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-belen-blue text-lg font-bold text-white sm:h-20 sm:w-20">
          {initials(agent.name)}
        </span>
      )}

      <span className="line-clamp-2 text-xs font-semibold leading-tight text-belen-ink sm:text-sm">
        {agent.name}
      </span>
    </button>
  )
}

function HourButton({ hour, selected, occupied, disabled, onSelect }) {
  const unavailable = occupied || disabled

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={unavailable}
      title={occupied ? 'Horario ocupado' : formatHourRange(hour)}
      onClick={() => onSelect(hour)}
      className={[
        'flex h-14 flex-col items-center justify-center rounded-xl text-sm font-semibold',
        'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
        occupied
          ? 'cursor-not-allowed bg-slate-100 text-slate-400 line-through ring-1 ring-slate-200'
          : disabled
            ? 'cursor-not-allowed bg-white text-slate-300 ring-1 ring-slate-200'
            : selected
              ? 'bg-belen-blue text-white shadow-card ring-2 ring-belen-orange'
              : 'bg-white text-belen-ink ring-1 ring-belen-blue/15 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
      ].join(' ')}
    >
      <span>{hour}</span>
      {occupied && (
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 no-underline">
          Ocupado
        </span>
      )}
    </button>
  )
}

function DayPill({ day, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(day.id)}
      className={[
        'flex items-center gap-2.5 rounded-full py-2 pl-2 pr-4 text-sm font-semibold',
        'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
        selected
          ? 'bg-belen-blue text-white shadow-card ring-2 ring-belen-orange'
          : 'bg-white text-belen-ink ring-1 ring-belen-blue/15 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold',
          selected ? 'bg-white text-belen-blue' : 'bg-belen-blue/10 text-belen-blue',
        ].join(' ')}
      >
        {day.letter || day.label?.[0] || '·'}
      </span>
      {day.label}
    </button>
  )
}

/** Aviso informativo (azul) dentro del formulario. */
function Notice({ icon: Icon = AlertTriangle, children }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-belen-blue/5 p-3 text-xs text-belen-blue ring-1 ring-belen-blue/10">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-belen-orange" aria-hidden="true" />
      <p className="leading-relaxed">{children}</p>
    </div>
  )
}

function Divider() {
  return (
    <div className="belen-divider my-2">
      <span />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Cabecera, pie y paneles de estado
 * ---------------------------------------------------------------------------------------------- */

function Header({ config }) {
  const enabledDays = (config?.days || []).filter((day) => day.enabled !== false)
  const tagline = clean(config?.tagline)
  // El lema por defecto ya está dibujado dentro del logo: solo lo repetimos si el admin lo cambió.
  const showTagline = Boolean(tagline) && tagline !== LOGO_TAGLINE

  return (
    <header className="relative overflow-hidden bg-belen-blue pb-20 pt-10 sm:pb-24 sm:pt-14">
      {/* Marca de agua: el isotipo, muy tenue */}
      <Logo
        variant="mark"
        aria-hidden="true"
        className="belen-logo-white pointer-events-none absolute -right-16 -top-10 h-56 w-auto opacity-[0.07] sm:-right-10 sm:h-72"
      />
      <Logo
        variant="mark"
        aria-hidden="true"
        className="belen-logo-white pointer-events-none absolute -bottom-16 -left-20 h-56 w-auto opacity-[0.05] sm:h-64"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-56 w-56 rounded-full bg-belen-orange/20 blur-3xl"
      />

      <div className="relative mx-auto flex max-w-2xl flex-col items-center px-4 text-center">
        <Logo variant="full" className="belen-logo-invert h-36 w-auto sm:h-44" />

        {showTagline && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.25em] text-belen-orange-light">
            {tagline}
          </p>
        )}

        {enabledDays.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {enabledDays.map((day) => (
              <span
                key={day.id}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-3.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur-sm"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-belen-orange text-xs font-extrabold text-white">
                  {day.letter || day.label?.[0] || '·'}
                </span>
                {day.label}
              </span>
            ))}
          </div>
        )}

        <p className="mt-5 max-w-md text-sm leading-relaxed text-white/75">
          Reserva tu cita con el agente de ventas que te acompañará durante el evento. Elige día y
          hora, y te enviaremos tu entrada por correo al confirmarla.
        </p>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="mx-auto w-full max-w-2xl px-4 pb-10 text-center">
      <div className="belen-divider mb-4">
        <span />
      </div>
      <p className="text-xs font-semibold uppercase tracking-widest text-belen-blue/70">
        Empaques Belén · Conexiones que impulsan
      </p>
      <Link
        to="/admin/login"
        className="mt-3 inline-block text-[11px] text-slate-400 underline-offset-4 transition-colors hover:text-belen-blue hover:underline"
      >
        Acceso administradores
      </Link>
    </footer>
  )
}

function CardShell({ children, className = '' }) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-card sm:p-8 ${className}`}>{children}</div>
  )
}

function FormSkeleton() {
  return (
    <CardShell>
      <div className="animate-pulse space-y-6" aria-hidden="true">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-slate-200" />
              <div className="h-10 rounded-xl bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="h-px bg-slate-100" />
        <div className="space-y-3">
          <div className="h-3 w-40 rounded bg-slate-200" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-100" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="h-3 w-28 rounded bg-slate-200" />
          <div className="flex gap-2">
            <div className="h-11 w-36 rounded-full bg-slate-100" />
            <div className="h-11 w-36 rounded-full bg-slate-100" />
          </div>
        </div>
        <div className="h-14 rounded-xl bg-slate-100" />
      </div>
      <p className="sr-only">Cargando el formulario de reservas…</p>
    </CardShell>
  )
}

function ErrorPanel({ message }) {
  return (
    <CardShell className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-200">
        <AlertTriangle className="h-7 w-7 text-red-600" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-extrabold uppercase tracking-wide text-belen-blue">
        No pudimos cargar el evento
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">{message}</p>
      <Button
        className="mx-auto mt-6"
        variant="secondary"
        icon={RefreshCw}
        onClick={() => window.location.reload()}
      >
        Reintentar
      </Button>
    </CardShell>
  )
}

function ClosedPanel({ config }) {
  return (
    <CardShell className="text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-belen-blue/5 ring-1 ring-belen-blue/15">
        <Lock className="h-8 w-8 text-belen-blue" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-xl font-extrabold uppercase tracking-wide text-belen-blue">
        Reservas cerradas
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
        Por el momento no estamos recibiendo nuevas solicitudes para{' '}
        <span className="font-semibold text-belen-ink">
          {clean(config?.eventName) || 'Día del Cliente'} {config?.eventYear || ''}
        </span>
        . Si ya enviaste la tuya, revisa tu correo: ahí recibirás tu entrada cuando sea confirmada.
      </p>
      <p className="mt-5 text-xs text-slate-500">
        ¿Dudas? Escríbele a tu agente de ventas de Empaques Belén.
      </p>
      <div className="belen-divider mt-6">
        <span />
      </div>
    </CardShell>
  )
}

function SuccessPanel({ data, onReset }) {
  return (
    <CardShell className="text-center">
      {/* Palomita animada */}
      <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
        <span className="belen-pop absolute inset-0 rounded-full bg-emerald-50 ring-1 ring-emerald-200" />
        <span className="belen-ring absolute inset-0 rounded-full ring-2 ring-emerald-300" />
        <svg viewBox="0 0 52 52" className="relative h-14 w-14" aria-hidden="true">
          <path
            className="belen-draw"
            d="M14 27 L22 35 L38 17"
            fill="none"
            stroke="#059669"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="belen-fade-up belen-delay-1 mt-5 text-xl font-extrabold uppercase tracking-wide text-belen-blue">
        ¡Solicitud enviada!
      </h2>
      <p className="belen-fade-up belen-delay-1 mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        Gracias, <span className="font-semibold text-belen-ink">{data.fullName}</span>. Guardamos tu
        solicitud para el <span className="font-semibold text-belen-ink">{data.eventName}</span>.
      </p>

      {/* Resumen de la cita */}
      <div className="belen-fade-up belen-delay-2 mt-6 rounded-2xl bg-belen-cream p-4 text-left ring-1 ring-belen-blue/10 sm:p-5">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-belen-blue/60">
          Resumen de tu cita
        </p>

        <div className="flex items-center gap-3">
          {data.agentPhoto ? (
            <img
              src={data.agentPhoto}
              alt=""
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm"
            />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-belen-blue text-base font-bold text-white">
              {initials(data.agentName)}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Tu agente
            </p>
            <p className="truncate text-sm font-bold text-belen-ink">{data.agentName}</p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-blue text-sm font-extrabold text-white">
              {data.dayLetter || <CalendarDays className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Día
              </dt>
              <dd className="truncate text-sm font-bold text-belen-ink">{data.dayLabel}</dd>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-orange/10">
              <Clock className="h-4 w-4 text-belen-orange" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Hora
              </dt>
              <dd className="truncate text-sm font-bold text-belen-ink">
                {formatHourRange(data.hour)}
              </dd>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10 sm:col-span-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-blue/10">
              <Users className="h-4 w-4 text-belen-blue" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Empresa
              </dt>
              <dd className="truncate text-sm font-bold text-belen-ink">{data.companyName}</dd>
            </div>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-belen-blue ring-1 ring-belen-blue/15">
            <Ticket className="h-3.5 w-3.5 text-belen-orange" aria-hidden="true" />
            {data.ticketCount === 2 ? '2 entradas (titular y acompañante)' : '1 entrada (titular)'}
          </span>
          {data.masterclass && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-belen-blue ring-1 ring-belen-blue/15">
              <GraduationCap className="h-3.5 w-3.5 text-belen-orange" aria-hidden="true" />
              Asistirá a la Masterclass
            </span>
          )}
        </div>
      </div>

      {/* Aviso de pendiente */}
      <div className="belen-fade-up belen-delay-2 mt-4 rounded-xl bg-amber-50 p-4 text-left ring-1 ring-amber-200">
        <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Tu solicitud está pendiente de aprobación
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
          Nuestro equipo la revisará y, al confirmarla, te enviaremos tu entrada con el código QR a{' '}
          <span className="font-semibold">{data.email}</span>. Presenta ese QR en la entrada del
          evento. Revisa también tu carpeta de correo no deseado.
        </p>
      </div>

      <Button className="mx-auto mt-6" variant="secondary" size="lg" onClick={onReset}>
        Hacer otra reserva
      </Button>
    </CardShell>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Página
 * ---------------------------------------------------------------------------------------------- */

export default function PublicForm() {
  const toast = useToast()
  const { config, loading: configLoading, error: configError } = useConfig()
  const { agents, loading: agentsLoading, error: agentsError } = useAgents()

  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [occupied, setOccupied] = useState(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)

  const fieldRefs = useRef({})
  const previousSelection = useRef({ agentId: '', day: '' })

  const registerField = useCallback(
    (name) => (element) => {
      fieldRefs.current[name] = element
    },
    [],
  )

  // --- Disponibilidad en vivo -------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = subscribeOccupiedSlots((next) => setOccupied(next))
    return unsubscribe
  }, [])

  const refreshAvailability = useCallback(async () => {
    try {
      const fresh = await getOccupiedSlots()
      setOccupied(fresh)
      return fresh
    } catch (error) {
      console.error('[PublicForm] refreshAvailability', error)
      return null
    }
  }, [])

  // --- Datos derivados de la configuración ------------------------------------------------------
  const activeAgents = useMemo(() => agents.filter((agent) => agent.active === true), [agents])
  const enabledDays = useMemo(
    () => (config?.days || []).filter((day) => day.enabled !== false),
    [config],
  )
  const hours = useMemo(() => config?.hours || [], [config])

  const allowCompanion = config?.allowCompanion !== false
  const masterclassEnabled = config?.masterclassEnabled !== false

  const selectedAgent = useMemo(
    () => activeAgents.find((agent) => agent.id === form.agentId) || null,
    [activeAgents, form.agentId],
  )

  const canPickHour = Boolean(form.agentId && form.day)

  const isHourOccupied = useCallback(
    (hour) => canPickHour && occupied.has(slotId(form.day, hour, form.agentId)),
    [canPickHour, occupied, form.day, form.agentId],
  )

  // --- Coherencia de la selección con lo que llega en vivo ---------------------------------------

  // El agente elegido se desactivó o se borró.
  useEffect(() => {
    if (success || agentsLoading || !form.agentId) return
    if (activeAgents.some((agent) => agent.id === form.agentId)) return

    setForm((current) => ({ ...current, agentId: '', hour: '' }))
    toast.info('El agente que habías elegido ya no está disponible. Elige otro, por favor.')
  }, [activeAgents, agentsLoading, form.agentId, success, toast])

  // El día o la hora dejaron de existir en la configuración.
  useEffect(() => {
    if (success || configLoading || !config) return

    const dayOk = !form.day || enabledDays.some((day) => day.id === form.day)
    const hourOk = !form.hour || hours.includes(form.hour)
    if (dayOk && hourOk) return

    setForm((current) => ({
      ...current,
      day: dayOk ? current.day : '',
      hour: dayOk && hourOk ? current.hour : '',
    }))
    toast.info('Cambió la agenda del evento. Vuelve a elegir tu día y tu hora, por favor.')
  }, [config, configLoading, enabledDays, hours, form.day, form.hour, success, toast])

  // La hora elegida se ocupó (por otra reserva aprobada) mientras el cliente rellenaba el formulario.
  useEffect(() => {
    const { agentId, day, hour } = form
    const changedSelection =
      previousSelection.current.agentId !== agentId || previousSelection.current.day !== day
    previousSelection.current = { agentId, day }

    if (success || !agentId || !day || !hour) return
    if (!occupied.has(slotId(day, hour, agentId))) return

    setForm((current) => ({ ...current, hour: '' }))
    setErrors((current) => ({ ...current, hour: 'Elige otra hora disponible.' }))
    if (!changedSelection) {
      toast.error('La hora que habías elegido acaba de ocuparse. Por favor elige otra.')
    }
  }, [occupied, form, success, toast])

  // --- Escritura en el formulario ---------------------------------------------------------------
  const setField = useCallback((name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }, [])

  const handleInput = useCallback(
    (event) => setField(event.target.name, event.target.value),
    [setField],
  )

  const handleCompanionChoice = useCallback(
    (value) => {
      setField('hasCompanion', value)
      if (!value) setField('companionName', '')
    },
    [setField],
  )

  const handleAgentSelect = useCallback(
    (agentId) => setField('agentId', agentId === form.agentId ? '' : agentId),
    [setField, form.agentId],
  )

  const handleDaySelect = useCallback((dayId) => setField('day', dayId), [setField])
  const handleHourSelect = useCallback((hour) => setField('hour', hour), [setField])

  const focusField = useCallback((name) => {
    const container = fieldRefs.current[name]
    if (!container) return
    container.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const focusable = container.querySelector('input, button:not([disabled]), select, textarea')
    if (focusable) focusable.focus({ preventScroll: true })
  }, [])

  const validate = useCallback(() => {
    const next = {}

    if (!clean(form.clientCode)) next.clientCode = 'Escribe tu código de cliente.'
    if (!clean(form.fullName)) next.fullName = 'Escribe tu nombre completo.'
    if (!clean(form.companyName)) next.companyName = 'Escribe el nombre de tu empresa.'

    const email = clean(form.email)
    if (!email) next.email = 'Escribe tu correo electrónico.'
    else if (!isValidEmail(email)) next.email = 'Ese correo no parece válido. Revísalo, por favor.'

    const phone = clean(form.phone)
    if (phone && !/^[\d\s+()-]{8,}$/.test(phone)) {
      next.phone = 'Ese teléfono no parece válido (mínimo 8 dígitos).'
    }

    if (allowCompanion) {
      if (form.hasCompanion === null) {
        next.hasCompanion = 'Indícanos si asistirás con acompañante.'
      } else if (form.hasCompanion && !clean(form.companionName)) {
        next.companionName = 'Escribe el nombre de tu acompañante.'
      }
    }

    if (!form.agentId) next.agentId = 'Elige al agente de ventas que te acompañará.'
    if (!form.day) next.day = 'Elige el día de tu cita.'

    if (!form.hour) next.hour = 'Elige la hora de tu cita.'
    else if (form.agentId && form.day && occupied.has(slotId(form.day, form.hour, form.agentId))) {
      next.hour = 'Esa hora acaba de ocuparse. Elige otra, por favor.'
    }

    if (masterclassEnabled && form.masterclass === null) {
      next.masterclass = 'Indícanos si asistirás a la Masterclass.'
    }

    return next
  }, [form, occupied, allowCompanion, masterclassEnabled])

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault()
      if (submitting) return

      const found = validate()
      setErrors(found)

      const firstError = FIELD_ORDER.find((name) => found[name])
      if (firstError) {
        toast.error('Revisa los campos marcados en rojo.')
        focusField(firstError)
        return
      }

      setSubmitting(true)
      try {
        // Última comprobación antes de escribir: el slot pudo ocuparse mientras rellenaba.
        const fresh = await refreshAvailability()
        if (fresh && fresh.has(slotId(form.day, form.hour, form.agentId))) {
          setForm((current) => ({ ...current, hour: '' }))
          setErrors((current) => ({ ...current, hour: 'Elige otra hora disponible.' }))
          toast.error(ERRORS.SLOT_TAKEN)
          focusField('hour')
          return
        }

        const hasCompanion = allowCompanion && form.hasCompanion === true
        const masterclass = masterclassEnabled && form.masterclass === true

        await createReservation({
          clientCode: form.clientCode,
          fullName: form.fullName,
          companyName: form.companyName,
          email: form.email,
          phone: form.phone,
          hasCompanion,
          companionName: hasCompanion ? form.companionName : '',
          agentId: form.agentId,
          day: form.day,
          hour: form.hour,
          masterclass,
        })

        setSuccess({
          eventName: `${clean(config?.eventName) || 'Día del Cliente'} ${config?.eventYear || ''}`.trim(),
          fullName: clean(form.fullName),
          companyName: clean(form.companyName),
          email: clean(form.email).toLowerCase(),
          agentName: selectedAgent?.name || '',
          agentPhoto: selectedAgent?.photoBase64 || null,
          dayLabel: dayLabel(config, form.day),
          dayLetter: dayLetter(config, form.day),
          hour: form.hour,
          masterclass,
          ticketCount: hasCompanion ? 2 : 1,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (error) {
        toast.error(error.message)
        if (error.message === ERRORS.SLOT_TAKEN) {
          setForm((current) => ({ ...current, hour: '' }))
          setErrors((current) => ({ ...current, hour: 'Elige otra hora disponible.' }))
          await refreshAvailability()
          focusField('hour')
        }
      } finally {
        setSubmitting(false)
      }
    },
    [
      submitting,
      validate,
      toast,
      focusField,
      refreshAvailability,
      form,
      allowCompanion,
      masterclassEnabled,
      config,
      selectedAgent,
    ],
  )

  const handleReset = useCallback(() => {
    setSuccess(null)
    setForm(EMPTY_FORM)
    setErrors({})
    previousSelection.current = { agentId: '', day: '' }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // --- Contenido según el estado ----------------------------------------------------------------
  const loading = configLoading || agentsLoading
  const formClosed = Boolean(config) && config.formOpen === false
  const noAgents = !agentsLoading && activeAgents.length === 0
  const noDays = Boolean(config) && enabledDays.length === 0
  const noHours = Boolean(config) && hours.length === 0
  const scheduleUnavailable = noAgents || noDays || noHours

  let content
  if (loading) {
    content = <FormSkeleton />
  } else if (configError || !config) {
    content = (
      <ErrorPanel
        message={
          configError ||
          'No encontramos la configuración del evento. Inténtalo de nuevo en unos minutos.'
        }
      />
    )
  } else if (agentsError) {
    // Un fallo al cargar los agentes NO debe disfrazarse de "no hay agentes": sin la lista no se
    // puede reservar, así que mostramos un error real con opción de reintentar.
    content = <ErrorPanel message={agentsError} />
  } else if (formClosed) {
    content = <ClosedPanel config={config} />
  } else if (success) {
    content = <SuccessPanel data={success} onReset={handleReset} />
  } else {
    content = (
      <CardShell>
        <form onSubmit={handleSubmit} noValidate className="space-y-7">
          {/* ---------- 1-5. Datos del cliente ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div ref={registerField('clientCode')}>
              <Input
                label="Código de cliente"
                name="clientCode"
                required
                value={form.clientCode}
                onChange={handleInput}
                error={errors.clientCode}
                placeholder="Ej. C-1042"
                autoComplete="off"
                maxLength={40}
              />
            </div>

            <div ref={registerField('fullName')}>
              <Input
                label="Nombre completo"
                name="fullName"
                required
                value={form.fullName}
                onChange={handleInput}
                error={errors.fullName}
                placeholder="Ej. Juan Pérez"
                autoComplete="name"
                maxLength={80}
              />
            </div>

            <div ref={registerField('companyName')}>
              <Input
                label="Nombre de la empresa"
                name="companyName"
                required
                value={form.companyName}
                onChange={handleInput}
                error={errors.companyName}
                placeholder="Ej. ACME S.A."
                autoComplete="organization"
                maxLength={80}
              />
            </div>

            <div ref={registerField('email')}>
              <Input
                label="Correo electrónico"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={handleInput}
                error={errors.email}
                hint="Aquí recibirás tu entrada con el QR."
                placeholder="nombre@empresa.com"
                autoComplete="email"
                inputMode="email"
                maxLength={120}
              />
            </div>

            <div ref={registerField('phone')} className="sm:col-span-2">
              <Input
                label="Teléfono"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleInput}
                error={errors.phone}
                hint="Opcional. Solo lo usamos si necesitamos contactarte por tu cita."
                placeholder="8888 8888"
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
              />
            </div>
          </div>

          <Divider />

          {/* ---------- 6. Acompañante ---------- */}
          {allowCompanion && (
            <div ref={registerField('hasCompanion')}>
              <SectionTitle icon={UserPlus} required>
                ¿Asistirás con acompañante?
              </SectionTitle>
              <YesNoCards
                value={form.hasCompanion}
                onChange={handleCompanionChoice}
                invalid={Boolean(errors.hasCompanion)}
              />
              <FieldError message={errors.hasCompanion} />

              <div
                className={[
                  'grid transition-all duration-300 ease-out',
                  form.hasCompanion === true
                    ? 'mt-4 grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0',
                ].join(' ')}
                aria-hidden={form.hasCompanion !== true}
              >
                <div className="overflow-hidden">
                  <div ref={registerField('companionName')}>
                    <Input
                      label="Nombre del acompañante"
                      name="companionName"
                      required={form.hasCompanion === true}
                      disabled={form.hasCompanion !== true}
                      tabIndex={form.hasCompanion === true ? undefined : -1}
                      value={form.companionName}
                      onChange={handleInput}
                      error={errors.companionName}
                      hint="Emitiremos una segunda entrada a su nombre."
                      placeholder="Ej. María Rojas"
                      autoComplete="off"
                      maxLength={80}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---------- 7. Agente de ventas ---------- */}
          <div ref={registerField('agentId')}>
            <SectionTitle
              icon={Users}
              required
              hint="Te acompañará durante toda tu visita al evento."
            >
              Agente de ventas
            </SectionTitle>

            {noAgents ? (
              <Notice>
                Todavía no hay agentes de ventas disponibles para reservar. Vuelve a intentarlo más
                tarde o contacta a tu agente de Empaques Belén.
              </Notice>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {activeAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    selected={form.agentId === agent.id}
                    onSelect={handleAgentSelect}
                  />
                ))}
              </div>
            )}
            <FieldError message={errors.agentId} />
          </div>

          {/* ---------- 8. Día ---------- */}
          <div ref={registerField('day')}>
            <SectionTitle icon={CalendarDays} required>
              Día
            </SectionTitle>

            {noDays ? (
              <Notice>Aún no hay días habilitados para el evento. Vuelve pronto.</Notice>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {enabledDays.map((day) => (
                  <DayPill
                    key={day.id}
                    day={day}
                    selected={form.day === day.id}
                    onSelect={handleDaySelect}
                  />
                ))}
              </div>
            )}
            <FieldError message={errors.day} />
          </div>

          {/* ---------- 9. Hora ---------- */}
          <div ref={registerField('hour')}>
            <SectionTitle
              icon={Clock}
              required
              hint={
                canPickHour
                  ? `Disponibilidad en vivo para ${selectedAgent?.name || 'tu agente'}. Cada cita dura 1 hora.`
                  : undefined
              }
            >
              Hora
            </SectionTitle>

            {!canPickHour && (
              <div className="mb-3">
                <Notice>
                  Elige primero tu <span className="font-semibold">agente de ventas</span> y el{' '}
                  <span className="font-semibold">día</span> para ver los horarios disponibles.
                </Notice>
              </div>
            )}

            {noHours ? (
              <Notice>Aún no hay horarios configurados para el evento. Vuelve pronto.</Notice>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {hours.map((hour) => (
                  <HourButton
                    key={hour}
                    hour={hour}
                    selected={form.hour === hour}
                    occupied={isHourOccupied(hour)}
                    disabled={!canPickHour}
                    onSelect={handleHourSelect}
                  />
                ))}
              </div>
            )}
            <FieldError message={errors.hour} />
          </div>

          {/* ---------- 10. Masterclass ---------- */}
          {masterclassEnabled && (
            <div ref={registerField('masterclass')}>
              <SectionTitle icon={GraduationCap} required>
                ¿Asistirás a la Masterclass?
              </SectionTitle>
              <YesNoCards
                value={form.masterclass}
                onChange={(value) => setField('masterclass', value)}
                invalid={Boolean(errors.masterclass)}
              />
              <FieldError message={errors.masterclass} />
            </div>
          )}

          <Divider />

          {/* ---------- 11. Enviar ---------- */}
          <div>
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              disabled={scheduleUnavailable}
              icon={Ticket}
              className="w-full !bg-belen-orange shadow-card hover:!bg-belen-orange-dark active:!bg-belen-orange-dark"
            >
              {submitting ? 'Enviando tu solicitud…' : 'Reservar mi lugar'}
            </Button>

            <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-slate-500">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-belen-orange" aria-hidden="true" />
              <span>
                Tu solicitud queda <span className="font-semibold text-belen-ink">pendiente</span> de
                aprobación. Al confirmarla te enviaremos la entrada con el QR por correo.
              </span>
            </p>
          </div>
        </form>
      </CardShell>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-belen-cream">
      <style>{PAGE_STYLES}</style>

      <Header config={config} />

      <main className="relative z-10 mx-auto -mt-10 w-full max-w-2xl flex-1 px-4 pb-12 sm:px-6">
        {content}
      </main>

      <Footer />
    </div>
  )
}
