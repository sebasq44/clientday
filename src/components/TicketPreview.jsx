import { useEffect, useState } from 'react'
import { CalendarDays, Clock, Tag, TriangleAlert } from 'lucide-react'
import Logo from './Logo'
import Spinner from './ui/Spinner'
import { HOLDER_TYPE_LABEL } from '../lib/constants'
import { dayLabel } from '../lib/format'
import { generateQrDataUrl } from '../services/ticketsService'

/**
 * Réplica en HTML de la entrada oficial del Día del Cliente 2026.
 * Se usa para ver la entrada en el panel y para imprimirla (window.print()).
 *
 * En pantallas pequeñas el talón se apila debajo del cuerpo; al imprimir siempre
 * vuelve a la disposición apaisada original (cuerpo | talón).
 */

const EVENT_HOURS = '9:00am 4:00pm'
const VALIDITY_TEXT = 'Válido por 1 día único'

/** Icono dentro del círculo naranja, como en la entrada impresa. */
function IconCircle({ icon: Icon, size = 'md' }) {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const glyph = size === 'sm' ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]'
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center rounded-full bg-belen-orange text-white`}
    >
      <Icon className={glyph} strokeWidth={2.5} aria-hidden="true" />
    </span>
  )
}

/** Las letras del día (M / K). La del día reservado va resaltada. */
function DayLetters({ days, selectedDayId }) {
  if (!days.length) return null
  return (
    <div className="flex items-center gap-2">
      {days.map((day) => {
        const isSelected = day.id === selectedDayId
        return (
          <span
            key={day.id}
            title={day.label}
            className={[
              'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-extrabold',
              isSelected
                ? 'border-belen-orange bg-belen-orange text-white'
                : 'border-belen-blue/30 bg-white text-belen-blue/40',
            ].join(' ')}
          >
            {day.letter}
          </span>
        )
      })}
    </div>
  )
}

/** Píldora del serial: «General Nº | GEN-0001» */
function SerialPill({ serial, compact = false }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 rounded-full border-2 border-belen-blue bg-white',
        compact ? 'px-2.5 py-1' : 'px-3 py-1.5',
      ].join(' ')}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-belen-blue/60">
        General Nº
      </span>
      <span className="h-3.5 w-px bg-belen-blue/30" aria-hidden="true" />
      <span
        className={[
          'font-extrabold tracking-wide text-belen-blue',
          compact ? 'text-[11px]' : 'text-sm',
        ].join(' ')}
      >
        {serial}
      </span>
    </span>
  )
}

export default function TicketPreview({ ticket, config }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrError, setQrError] = useState('')

  const qrToken = ticket?.qrToken || ''

  useEffect(() => {
    let active = true
    setQrDataUrl('')
    setQrError('')

    if (!qrToken) {
      setQrError('Esta entrada no tiene un código QR asociado.')
      return undefined
    }

    generateQrDataUrl(qrToken)
      .then((url) => {
        if (active) setQrDataUrl(url)
      })
      .catch((error) => {
        console.error('No se pudo generar el QR de la entrada:', error)
        if (active) setQrError('No pudimos generar el código QR de esta entrada.')
      })

    return () => {
      active = false
    }
  }, [qrToken])

  if (!ticket) return null

  const days = Array.isArray(config?.days) ? config.days : []
  const label = dayLabel(config, ticket.day)
  const holderTypeLabel = HOLDER_TYPE_LABEL[ticket.holderType] || ''

  const qrBox = (
    <div className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-belen-blue bg-white p-2">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt={`Código QR de la entrada ${ticket.serial}`}
          className="h-full w-full object-contain"
        />
      ) : qrError ? (
        <div className="flex flex-col items-center gap-1.5 px-2 text-center">
          <TriangleAlert className="h-5 w-5 text-red-600" aria-hidden="true" />
          <p className="text-[11px] font-medium leading-tight text-red-700">{qrError}</p>
        </div>
      ) : (
        <div className="no-print flex flex-col items-center gap-2 text-belen-blue">
          <Spinner size="sm" />
          <p className="text-[11px] font-medium text-belen-blue/60">Generando QR…</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="w-full overflow-x-auto print:overflow-x-visible">
      <article className="mx-auto w-full max-w-[900px] overflow-hidden rounded-2xl border-2 border-belen-blue bg-white shadow-card print:shadow-none">
        <div className="flex flex-col print:flex-row md:flex-row">
        {/* ---------------- CUERPO ---------------- */}
        <div className="flex-1 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
            {/* Columna de contenido */}
            <div className="min-w-0 flex-1">
              <Logo variant="full" className="mx-auto h-24 w-auto" />

              <div className="mt-4 text-center">
                <h2 className="text-xl font-extrabold uppercase tracking-[0.18em] text-belen-blue sm:text-2xl">
                  Entrada General
                </h2>
                <div className="belen-divider mx-auto mt-1 max-w-[240px]">
                  <span />
                </div>
                {holderTypeLabel ? (
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-belen-orange">
                    {holderTypeLabel}
                  </p>
                ) : null}
              </div>

              {/* Los tres iconos en fila */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
                <div className="flex items-center gap-2">
                  <IconCircle icon={Clock} />
                  <span className="text-xs font-semibold text-belen-blue">{EVENT_HOURS}</span>
                </div>
                <div className="flex items-center gap-2">
                  <IconCircle icon={CalendarDays} />
                  <span className="text-xs font-semibold text-belen-blue">{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <IconCircle icon={Tag} />
                  <span className="text-xs font-semibold text-belen-blue">{VALIDITY_TEXT}</span>
                </div>
              </div>

              {/* Día (letras M / K) */}
              <div className="mt-5 flex items-center gap-3">
                <span className="text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                  Día
                </span>
                <DayLetters days={days} selectedDayId={ticket.day} />
                <span className="text-xs font-medium text-belen-blue/60">{ticket.hour}</span>
              </div>

              {/* Cliente / Empresa */}
              <div className="mt-4">
                <p className="text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                  Cliente / Empresa:
                </p>
                <div className="mt-1.5 rounded-xl border-2 border-belen-blue px-3 py-2">
                  <p className="truncate text-base font-bold text-belen-ink">{ticket.holderName}</p>
                  <p className="truncate text-xs font-medium text-belen-blue/70">
                    {ticket.companyName}
                    {ticket.clientCode ? ` · ${ticket.clientCode}` : ''}
                  </p>
                </div>
              </div>

              {ticket.masterclass ? (
                <p className="mt-3 inline-block rounded-full bg-belen-orange/10 px-3 py-1 text-[11px] font-semibold text-belen-orange">
                  Incluye Masterclass
                </p>
              ) : null}

              {/* Serial + logo corporativo */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <SerialPill serial={ticket.serial} />
                <Logo variant="compact" className="h-7 w-auto" />
              </div>
            </div>

            {/* QR a la derecha del cuerpo */}
            <div className="w-40 shrink-0 self-center sm:self-start">
              {qrBox}
              <p className="mt-2 text-center text-[10px] font-medium uppercase tracking-wide text-belen-blue/50">
                Presenta este QR
              </p>
            </div>
          </div>
        </div>

        {/* ------------- LÍNEA TROQUELADA ------------- */}
        <div
          className="h-0 w-full border-t-2 border-dashed border-belen-orange print:hidden md:hidden"
          aria-hidden="true"
        />
        <div
          className="ticket-dashed hidden w-[2px] shrink-0 self-stretch print:block md:block"
          aria-hidden="true"
        />

        {/* ---------------- TALÓN ---------------- */}
        <aside className="w-full shrink-0 bg-belen-cream/60 print:w-52 md:w-52">
          <div className="bg-belen-blue px-3 py-2 text-center">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white">
              Entrada General
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 px-4 py-5">
            <Logo variant="full" className="h-20 w-auto" />

            <div className="flex w-full flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <IconCircle icon={Clock} size="sm" />
                <span className="text-[11px] font-semibold text-belen-blue">{EVENT_HOURS}</span>
              </div>
              <div className="flex items-center gap-2">
                <IconCircle icon={CalendarDays} size="sm" />
                <span className="truncate text-[11px] font-semibold text-belen-blue">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                <IconCircle icon={Tag} size="sm" />
                <span className="text-[11px] font-semibold leading-tight text-belen-blue">
                  {VALIDITY_TEXT}
                </span>
              </div>
            </div>

            <SerialPill serial={ticket.serial} compact />

            <p className="w-full truncate text-center text-[11px] font-semibold text-belen-blue/70">
              {ticket.holderName}
            </p>

            <Logo variant="compact" className="h-6 w-auto" />
          </div>
        </aside>
        </div>
      </article>
    </div>
  )
}
