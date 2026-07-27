import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  Clock,
  Fingerprint,
  GraduationCap,
  Hash,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Ticket,
  UserCheck,
  UserPlus,
} from 'lucide-react'

import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'

import { useAgents } from '../hooks/useAgents'
import { useConfig } from '../hooks/useConfig'

import { createReservation } from '../services/reservationsService'
import { lookupClientByCedula } from '../services/clientsService'
import { getOccupiedSlots, subscribeOccupiedSlots } from '../services/availabilityService'

import { ERRORS, slotId } from '../lib/constants'
import { celebrateReservation } from '../lib/celebrate'
import {
  clean,
  dayLabel,
  dayLetter,
  formatHourRange,
  formatMasterclass,
  isValidEmail,
  normalizeName,
  onlyDigits,
} from '../lib/format'

import edificioImg from '../assets/edificio.webp'
import logoImg from '../assets/logo.webp'
import certificadosImg from '../assets/certificados.png'

/* ------------------------------------------------------------------------------------------------
 * Estilos locales de la página
 * - Animaciones de la pantalla de confirmación y del formulario (se anulan si el sistema pide
 *   movimiento reducido).
 * ---------------------------------------------------------------------------------------------- */
const PAGE_STYLES = `
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

/** Lema de la marca (respaldo si el admin no configuró uno propio). */
const BRAND_TAGLINE = 'Conexiones que impulsan'

/** Orden de los campos: define a cuál se hace scroll cuando la validación falla. La cédula va primero. */
const FIELD_ORDER = [
  'cedula',
  'email',
  'fullName',
  'hasCompanion',
  'companionName',
  'day',
  'hour',
  'masterclass',
  'masterclassId',
]

const EMPTY_FORM = {
  cedula: '',
  email: '',
  fullName: '',
  hasCompanion: null,
  companionName: '',
  day: '',
  hour: '',
  masterclass: null,
  masterclassId: '',
}

/** Iniciales para el avatar de respaldo cuando el asesor no tiene foto. */
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
              ? 'belen-pick text-belen-blue shadow-card ring-2 ring-belen-orange'
              : invalid
                ? 'text-slate-600 ring-1 ring-red-300 hover:ring-belen-blue/40'
                : 'text-slate-600 ring-1 ring-belen-blue/15 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
          ].join(' ')}
        >
          {option.selected && (
            <span className="belen-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-belen-orange text-white">
              <Check className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Dato de solo lectura (empresa / código): icono, etiqueta y valor. */
function ReadOnlyField({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-blue/10">
        <Icon className="h-4 w-4 text-belen-blue" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="truncate text-sm font-bold text-belen-ink">{value || '—'}</p>
      </div>
    </div>
  )
}

/**
 * Tarjeta de SOLO LECTURA con lo que se autocompleta desde la cédula: empresa, código y asesor.
 * Reutiliza la estética de las tarjetas de asesor (foto/iniciales) pero NO es seleccionable.
 */
function ClientCard({ client, agent }) {
  const matched = Boolean(agent)
  const advisorName = agent?.name || client.vendedor
  return (
    <div className="belen-fade-up mt-4 rounded-2xl bg-belen-cream p-4 ring-1 ring-belen-blue/10">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-belen-blue/60">
        <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        Cliente verificado
      </p>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReadOnlyField icon={Building2} label="Empresa" value={client.nombre} />
        <ReadOnlyField icon={Hash} label="Código de cliente" value={client.codigo} />
      </dl>

      <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10">
        {agent?.photoBase64 ? (
          <img
            src={agent.photoBase64}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white"
          />
        ) : (
          <span
            className={[
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
              matched ? 'bg-belen-blue' : 'bg-slate-400',
            ].join(' ')}
          >
            {advisorName ? initials(advisorName) : <UserCheck className="h-5 w-5" aria-hidden="true" />}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Asesor asignado
          </p>
          <p className="truncate text-sm font-bold text-belen-ink">{advisorName || '—'}</p>
          {!matched && (
            <p className="mt-0.5 text-xs text-slate-400">Se te asignará un asesor.</p>
          )}
        </div>
      </div>
    </div>
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
              ? 'belen-pick bg-belen-blue text-white shadow-card ring-2 ring-belen-orange'
              : 'bg-white text-belen-ink ring-1 ring-belen-blue/15 hover:scale-105 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
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
          ? 'belen-pick bg-belen-blue text-white shadow-card ring-2 ring-belen-orange'
          : 'bg-white text-belen-ink ring-1 ring-belen-blue/15 hover:-translate-y-0.5 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
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

/** Tarjeta seleccionable de una masterclass (nombre + rango horario), al estilo de día/hora. */
function MasterclassCard({ masterclass, selected, onSelect }) {
  const hasRange = Boolean(masterclass.startTime && masterclass.endTime)
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={formatMasterclass(masterclass)}
      onClick={() => onSelect(masterclass.id)}
      className={[
        'relative flex flex-col items-start gap-1 rounded-xl bg-white p-3 pr-9 text-left',
        'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
        selected
          ? 'belen-pick text-belen-blue shadow-card ring-2 ring-belen-orange'
          : 'text-belen-ink ring-1 ring-belen-blue/15 hover:-translate-y-0.5 hover:bg-belen-blue/5 hover:ring-belen-blue/40',
      ].join(' ')}
    >
      {selected && (
        <span className="belen-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-belen-orange text-white">
          <Check className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
      <span className="text-sm font-semibold leading-tight">{masterclass.name}</span>
      {hasRange && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Clock className="h-3.5 w-3.5 text-belen-orange" aria-hidden="true" />
          {masterclass.startTime} – {masterclass.endTime}
        </span>
      )}
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
  const eventName = clean(config?.eventName) || 'Día del Cliente'
  const tagline = clean(config?.tagline) || BRAND_TAGLINE

  return (
    <header className="relative overflow-hidden pb-20 pt-10 sm:pb-24 sm:pt-14">
      {/* Fondo: fotografía del edificio */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${edificioImg})` }}
      />
      {/* Degradado azul de la marca que desvanece la foto para que el texto blanco se lea */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-belen-blue/95 via-belen-blue/85 to-belen-blue/75"
      />
      {/* Destello naranja tenue */}
      <div
        aria-hidden="true"
        className="belen-glow pointer-events-none absolute inset-x-0 -top-24 mx-auto h-56 w-56 rounded-full bg-belen-orange/25 blur-3xl"
      />

      <div className="relative mx-auto flex max-w-2xl flex-col items-center px-4 text-center">
        {/* Certificaciones de la empresa: PNG transparente sobre un HALO blanco muy difuminado.
            El halo es un elemento blanco con blur fuerte (blur-3xl), así sus bordes se deshacen por
            completo y el blanco se funde con el azul sin ninguna arista; mejora la legibilidad de los
            logos oscuros sin verse como una tarjeta. */}
        <div className="belen-fade-up relative inline-flex items-center justify-center px-6 py-3 sm:px-10">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[50%] bg-white/70 blur-3xl"
          />
          <img
            src={certificadosImg}
            alt="Certificaciones de Empaques Belén: FSSC 22000, Bandera Azul Ecológica, Esencial Costa Rica y Kosher"
            className="relative h-24 w-auto max-w-full object-contain sm:h-32"
            loading="lazy"
          />
        </div>

        {/* Logo «EMPAQUES belén» sobre una tarjeta blanca para máximo contraste */}
        <div className="belen-fade-up belen-delay-1 mt-3 inline-flex items-center justify-center rounded-2xl bg-white px-6 py-4 shadow-card ring-1 ring-white/60">
          <img
            src={logoImg}
            alt="Empaques Belén"
            className="h-14 w-auto sm:h-16"
            width="200"
            height="64"
          />
        </div>

        <h1 className="belen-fade-up belen-delay-1 mt-6 text-2xl font-extrabold uppercase tracking-wide text-white sm:text-3xl">
          {eventName} {config?.eventYear || ''}
        </h1>

        <p className="belen-fade-up belen-delay-1 mt-2 text-xs font-semibold uppercase tracking-[0.25em] text-belen-orange-light">
          {tagline}
        </p>

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
          Reserva tu cita en pocos pasos: digita tu cédula y autocompletamos tu empresa y tu asesor.
          Elige día y hora, y te enviaremos tu entrada por correo al confirmarla.
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
    <div className={`belen-fade-up rounded-2xl bg-white p-5 shadow-card sm:p-8 ${className}`}>
      {children}
    </div>
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
        ¿Dudas? Escríbele a tu asesor comercial de Empaques Belén.
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
            <span
              className={[
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-bold text-white',
                data.agentAssigned ? 'bg-belen-blue' : 'bg-slate-400',
              ].join(' ')}
            >
              {data.agentName ? initials(data.agentName) : <UserCheck className="h-6 w-6" aria-hidden="true" />}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Tu asesor
            </p>
            <p className="truncate text-sm font-bold text-belen-ink">{data.agentName || 'Por asignar'}</p>
            {!data.agentAssigned && (
              <p className="text-xs text-slate-400">Se te asignará un asesor.</p>
            )}
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

          <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-blue/10">
              <Building2 className="h-4 w-4 text-belen-blue" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Empresa
              </dt>
              <dd className="truncate text-sm font-bold text-belen-ink">{data.companyName}</dd>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-blue/10">
              <Hash className="h-4 w-4 text-belen-blue" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Código de cliente
              </dt>
              <dd className="truncate text-sm font-bold text-belen-ink">{data.clientCode || '—'}</dd>
            </div>
          </div>

          {data.masterclassLabel && (
            <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 ring-1 ring-belen-blue/10 sm:col-span-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-belen-orange/10">
                <GraduationCap className="h-4 w-4 text-belen-orange" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Masterclass
                </dt>
                <dd className="text-sm font-bold leading-snug text-belen-ink">
                  {data.masterclassLabel}
                </dd>
              </div>
            </div>
          )}
        </dl>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-belen-blue ring-1 ring-belen-blue/15">
            <Ticket className="h-3.5 w-3.5 text-belen-orange" aria-hidden="true" />
            {data.ticketCount === 2 ? '2 entradas (titular y acompañante)' : '1 entrada (titular)'}
          </span>
          {data.masterclass && !data.masterclassLabel && (
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
  const { agents, loading: agentsLoading } = useAgents()

  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [occupied, setOccupied] = useState(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)

  // Cliente resuelto a partir de la cédula (empresa/código/vendedor) + estado de la búsqueda.
  const [clientData, setClientData] = useState(null)
  const [lookupStatus, setLookupStatus] = useState('idle') // idle | loading | found | notfound | error

  const fieldRefs = useRef({})
  const previousSelection = useRef({ agentId: '', day: '' })
  // Evita búsquedas duplicadas/obsoletas: guarda la última cédula consultada y un contador de orden.
  const lookupRef = useRef({ cedula: null, seq: 0 })

  // Al confirmar la reserva: confeti con los colores de la marca. La propia función
  // respeta «prefers-reduced-motion», así que no molesta a quien pidió menos animación.
  useEffect(() => {
    if (success) celebrateReservation()
  }, [success])

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
  const enabledDays = useMemo(
    () => (config?.days || []).filter((day) => day.enabled !== false),
    [config],
  )
  const hours = useMemo(() => config?.hours || [], [config])
  const masterclasses = useMemo(
    () => (Array.isArray(config?.masterclasses) ? config.masterclasses : []),
    [config],
  )

  // Masterclasses visibles según el día elegido: las de ESE día más las sin día asignado.
  const visibleMasterclasses = useMemo(
    () => masterclasses.filter((mc) => !mc.day || mc.day === form.day),
    [masterclasses, form.day],
  )

  const allowCompanion = config?.allowCompanion !== false
  const masterclassEnabled = config?.masterclassEnabled !== false

  // Asesor emparejado: el «vendedor» del cliente contra un asesor ACTIVO, comparando nombres.
  const matchedAgent = useMemo(() => {
    if (!clientData?.vendedor) return null
    return (
      agents.find(
        (a) => a.active !== false && normalizeName(a.name) === normalizeName(clientData.vendedor),
      ) || null
    )
  }, [agents, clientData])

  const matchedAgentId = matchedAgent?.id || ''

  // Se puede elegir hora cuando ya hay cliente resuelto y día. Sin asesor emparejado no hay
  // ocupación que calcular: se muestran todas las horas (el horario se confirma al asignar asesor).
  const canPickHour = Boolean(clientData && form.day)

  const isHourOccupied = useCallback(
    (hour) => Boolean(matchedAgentId && form.day) && occupied.has(slotId(form.day, hour, matchedAgentId)),
    [matchedAgentId, form.day, occupied],
  )

  // --- Búsqueda del cliente por cédula ----------------------------------------------------------
  const runLookup = useCallback(async (rawCedula) => {
    const id = onlyDigits(rawCedula)
    if (id.length < 8) return
    // Ya está resuelta / en curso para esta misma cédula: no repetimos la consulta.
    if (lookupRef.current.cedula === id) return
    lookupRef.current.cedula = id
    const seq = ++lookupRef.current.seq
    setLookupStatus('loading')

    try {
      const client = await lookupClientByCedula(id)
      if (seq !== lookupRef.current.seq) return // llegó una respuesta obsoleta
      if (client) {
        setClientData(client)
        setLookupStatus('found')
        setErrors((current) => {
          if (!current.cedula) return current
          const nextErrors = { ...current }
          delete nextErrors.cedula
          return nextErrors
        })
      } else {
        setClientData(null)
        setLookupStatus('notfound')
      }
    } catch (error) {
      console.error('[PublicForm] lookupClientByCedula', error)
      if (seq !== lookupRef.current.seq) return
      setClientData(null)
      setLookupStatus('error')
    }
  }, [])

  // Debounce: en cuanto la cédula tenga 8+ dígitos, la buscamos ~500 ms después de dejar de escribir.
  useEffect(() => {
    const id = onlyDigits(form.cedula)
    if (id.length < 8) return
    const timer = setTimeout(() => runLookup(id), 500)
    return () => clearTimeout(timer)
  }, [form.cedula, runLookup])

  // --- Coherencia de la selección con lo que llega en vivo ---------------------------------------

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
    const agentId = matchedAgentId
    const { day, hour } = form
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
  }, [occupied, form, matchedAgentId, success, toast])

  // Si cambia el día y la masterclass elegida ya no pertenece al nuevo día, la limpiamos.
  useEffect(() => {
    if (success || !form.masterclassId) return
    if (visibleMasterclasses.some((mc) => mc.id === form.masterclassId)) return
    setForm((current) => ({ ...current, masterclassId: '' }))
  }, [visibleMasterclasses, form.masterclassId, success])

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

  // La cédula solo admite dígitos; cualquier cambio invalida el cliente resuelto y reinicia la búsqueda.
  const handleCedulaChange = useCallback(
    (event) => {
      const digits = onlyDigits(event.target.value).slice(0, 20)
      lookupRef.current.cedula = null // permite volver a buscar aunque repita un valor
      setClientData(null)
      setLookupStatus(digits.length >= 8 ? 'loading' : 'idle')
      setField('cedula', digits)
    },
    [setField],
  )

  // Al salir del campo buscamos ya (sin esperar el debounce), si aún no está resuelta.
  const handleCedulaBlur = useCallback(() => {
    runLookup(form.cedula)
  }, [runLookup, form.cedula])

  const handleCompanionChoice = useCallback(
    (value) => {
      setField('hasCompanion', value)
      if (!value) setField('companionName', '')
    },
    [setField],
  )

  const handleMasterclassChoice = useCallback(
    (value) => {
      setField('masterclass', value)
      if (!value) setField('masterclassId', '')
    },
    [setField],
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

    if (!clientData) {
      next.cedula =
        lookupStatus === 'loading'
          ? 'Espera un momento: estamos verificando tu cédula.'
          : 'Digita la cédula con la que facturas para continuar.'
    }

    const email = clean(form.email)
    if (!email) next.email = 'Escribe tu correo electrónico.'
    else if (!isValidEmail(email)) next.email = 'Ese correo no parece válido. Revísalo, por favor.'

    if (!clean(form.fullName)) next.fullName = 'Escribe el nombre de quien asiste.'

    if (allowCompanion) {
      if (form.hasCompanion === null) {
        next.hasCompanion = 'Indícanos si asistirás con acompañante.'
      } else if (form.hasCompanion && !clean(form.companionName)) {
        next.companionName = 'Escribe el nombre de tu acompañante.'
      }
    }

    if (!form.day) next.day = 'Elige el día de tu cita.'

    if (!form.hour) next.hour = 'Elige la hora de tu cita.'
    else if (matchedAgentId && occupied.has(slotId(form.day, form.hour, matchedAgentId))) {
      next.hour = 'Esa hora acaba de ocuparse. Elige otra, por favor.'
    }

    if (masterclassEnabled && form.masterclass === null) {
      next.masterclass = 'Indícanos si asistirás a la Masterclass.'
    } else if (
      masterclassEnabled &&
      form.masterclass === true &&
      visibleMasterclasses.length > 0 &&
      !form.masterclassId
    ) {
      next.masterclassId = 'Selecciona a cuál masterclass asistirás.'
    }

    return next
  }, [
    form,
    clientData,
    lookupStatus,
    matchedAgentId,
    occupied,
    allowCompanion,
    masterclassEnabled,
    visibleMasterclasses,
  ])

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
        // Última comprobación antes de escribir (solo si hay asesor): el slot pudo ocuparse.
        if (matchedAgentId) {
          const fresh = await refreshAvailability()
          if (fresh && fresh.has(slotId(form.day, form.hour, matchedAgentId))) {
            setForm((current) => ({ ...current, hour: '' }))
            setErrors((current) => ({ ...current, hour: 'Elige otra hora disponible.' }))
            toast.error(ERRORS.SLOT_TAKEN)
            focusField('hour')
            return
          }
        }

        const hasCompanion = allowCompanion && form.hasCompanion === true
        const masterclass = masterclassEnabled && form.masterclass === true
        const masterclassId = masterclass ? form.masterclassId : ''
        const chosenMasterclass = masterclassId
          ? masterclasses.find((mc) => mc.id === masterclassId) || null
          : null

        // El servicio deriva empresa, código y asesor desde la cédula: solo enviamos estos campos.
        await createReservation({
          cedula: form.cedula,
          email: form.email,
          fullName: form.fullName,
          hasCompanion,
          companionName: hasCompanion ? form.companionName : '',
          day: form.day,
          hour: form.hour,
          masterclass,
          masterclassId,
        })

        setSuccess({
          eventName: `${clean(config?.eventName) || 'Día del Cliente'} ${config?.eventYear || ''}`.trim(),
          fullName: clean(form.fullName),
          companyName: clean(clientData?.nombre),
          clientCode: clean(clientData?.codigo),
          email: clean(form.email).toLowerCase(),
          agentAssigned: Boolean(matchedAgent),
          agentName: matchedAgent?.name || clientData?.vendedor || '',
          agentPhoto: matchedAgent?.photoBase64 || null,
          dayLabel: dayLabel(config, form.day),
          dayLetter: dayLetter(config, form.day),
          hour: form.hour,
          masterclass,
          masterclassLabel: chosenMasterclass ? formatMasterclass(chosenMasterclass) : '',
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
      matchedAgentId,
      matchedAgent,
      clientData,
      allowCompanion,
      masterclassEnabled,
      masterclasses,
      config,
    ],
  )

  const handleReset = useCallback(() => {
    setSuccess(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setClientData(null)
    setLookupStatus('idle')
    lookupRef.current = { cedula: null, seq: lookupRef.current.seq + 1 }
    previousSelection.current = { agentId: '', day: '' }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // --- Contenido según el estado ----------------------------------------------------------------
  const loading = configLoading || agentsLoading
  const formClosed = Boolean(config) && config.formOpen === false
  const noDays = Boolean(config) && enabledDays.length === 0
  const noHours = Boolean(config) && hours.length === 0
  const scheduleUnavailable = noDays || noHours

  // Mensaje que se muestra bajo el campo de cédula (búsqueda / no encontrada / error / validación).
  const cedulaError =
    lookupStatus === 'notfound'
      ? 'No encontramos esa cédula en nuestra base de clientes. Verifícala o contacta a tu asesor.'
      : lookupStatus === 'error'
        ? 'No pudimos verificar tu cédula ahora. Revisa tu conexión e inténtalo de nuevo.'
        : errors.cedula

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
  } else if (formClosed) {
    content = <ClosedPanel config={config} />
  } else if (success) {
    content = <SuccessPanel data={success} onReset={handleReset} />
  } else {
    content = (
      <CardShell>
        <form onSubmit={handleSubmit} noValidate className="space-y-7">
          {/* ---------- 1. Cédula (autocompleta empresa, código y asesor) ---------- */}
          <div ref={registerField('cedula')}>
            <Input
              label="Cédula con la que factura"
              name="cedula"
              required
              value={form.cedula}
              onChange={handleCedulaChange}
              onBlur={handleCedulaBlur}
              error={cedulaError}
              hint={
                clientData
                  ? undefined
                  : 'Con tu cédula autocompletamos tu empresa, tu código y tu asesor.'
              }
              placeholder="Ej. 3101123456"
              autoComplete="off"
              inputMode="numeric"
              maxLength={20}
            />

            {lookupStatus === 'loading' && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-belen-blue">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Buscando en nuestra base de clientes…
              </p>
            )}

            {clientData && lookupStatus === 'found' && (
              <ClientCard client={clientData} agent={matchedAgent} />
            )}
          </div>

          <Divider />

          {/* ---------- 2-3. Correo y nombre de quien asiste ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

            <div ref={registerField('fullName')}>
              <Input
                label="Nombre de quien asiste"
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
          </div>

          {/* ---------- 4. Acompañante ---------- */}
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

          {/* ---------- 5. Día ---------- */}
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

          {/* ---------- 6. Hora ---------- */}
          <div ref={registerField('hour')}>
            <SectionTitle
              icon={Clock}
              required
              hint={
                canPickHour && matchedAgent
                  ? `Disponibilidad en vivo para ${matchedAgent.name}. Cada cita dura 30 minutos.`
                  : undefined
              }
            >
              Hora
            </SectionTitle>

            {!clientData && (
              <div className="mb-3">
                <Notice icon={Fingerprint}>
                  Primero digita tu <span className="font-semibold">cédula</span> para ver los
                  horarios disponibles.
                </Notice>
              </div>
            )}

            {clientData && !form.day && (
              <div className="mb-3">
                <Notice icon={CalendarDays}>
                  Elige tu <span className="font-semibold">día</span> para ver los horarios
                  disponibles.
                </Notice>
              </div>
            )}

            {clientData && form.day && !matchedAgent && (
              <div className="mb-3">
                <Notice icon={UserCheck}>
                  Aún no tienes un asesor asignado. Elige tu hora preferida; el horario se confirmará
                  cuando se te asigne un asesor.
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

          {/* ---------- 7. Masterclass ---------- */}
          {masterclassEnabled && (
            <div ref={registerField('masterclass')}>
              <SectionTitle icon={GraduationCap} required>
                ¿Asistirás a la Masterclass?
              </SectionTitle>
              <YesNoCards
                value={form.masterclass}
                onChange={handleMasterclassChoice}
                invalid={Boolean(errors.masterclass)}
              />
              <FieldError message={errors.masterclass} />

              {/* El selector depende del día: sin día no se pueden filtrar las masterclasses. */}
              {form.masterclass === true && !form.day && (
                <div className="mt-4">
                  <Notice>
                    Primero elige el <span className="font-semibold">día de tu cita</span> para ver
                    las masterclasses disponibles.
                  </Notice>
                </div>
              )}

              {/* Selector de a cuál masterclass asistir (solo si eligió «Sí», ya hay día y hay lista) */}
              {form.masterclass === true && form.day && visibleMasterclasses.length > 0 && (
                <div ref={registerField('masterclassId')} className="mt-4">
                  <SectionTitle icon={GraduationCap} required hint="Elige a cuál sesión asistirás.">
                    ¿A cuál masterclass asistirás?
                  </SectionTitle>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {visibleMasterclasses.map((mc) => (
                      <MasterclassCard
                        key={mc.id}
                        masterclass={mc}
                        selected={form.masterclassId === mc.id}
                        onSelect={(id) => setField('masterclassId', id)}
                      />
                    ))}
                  </div>
                  <FieldError message={errors.masterclassId} />
                </div>
              )}
            </div>
          )}

          <Divider />

          {/* ---------- 8. Enviar ---------- */}
          <div>
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              disabled={scheduleUnavailable || lookupStatus === 'loading'}
              icon={Ticket}
              className={[
                'relative w-full overflow-hidden !bg-belen-orange shadow-card transition-transform',
                'hover:!bg-belen-orange-dark hover:scale-[1.02] active:!bg-belen-orange-dark active:scale-[0.99]',
                // El brillo solo barre mientras el botón está listo para pulsarse.
                !submitting && !scheduleUnavailable ? 'belen-sweep' : '',
              ].join(' ')}
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
