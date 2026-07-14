import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import {
  CalendarDays,
  Clock,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Ticket,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'

import { Badge, Button, Card, EmptyState, Input, Modal, Spinner, useToast } from '../components/ui'
import { useConfig } from '../hooks/useConfig'
import { useReservations } from '../hooks/useReservations'
import { updateConfig } from '../services/configService'
import { db } from '../lib/firebase'
import {
  COL,
  RESERVATION_STATUS,
  TICKET_COUNTER_DOC,
  formatSerial,
} from '../lib/constants'
import { clean, formatDateTime } from '../lib/format'

const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_ID_RE = /^\d{4}-\d{2}-\d{2}$/

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

// Inicial del día de la semana tal como se imprime en la entrada (Martes = M, Miércoles = K).
const WEEKDAY_LETTERS = ['D', 'L', 'M', 'K', 'J', 'V', 'S']

/** '2026-09-08' -> Date local (evita el corrimiento de zona horaria de new Date('2026-09-08')). */
function parseDayId(id) {
  if (!DAY_ID_RE.test(String(id || ''))) return null
  const [year, month, day] = String(id).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

/** '2026-09-08' -> '8 Septiembre' */
function suggestLabel(id) {
  const date = parseDayId(id)
  if (!date) return ''
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** '2026-09-08' (martes) -> 'M' */
function suggestLetter(id) {
  const date = parseDayId(id)
  if (!date) return ''
  return WEEKDAY_LETTERS[date.getDay()]
}

/** Copia profunda de los campos editables de la configuración. */
function pickEditable(config) {
  return {
    eventName: config.eventName ?? '',
    eventYear: Number(config.eventYear) || new Date().getFullYear(),
    tagline: config.tagline ?? '',
    formOpen: config.formOpen !== false,
    allowCompanion: config.allowCompanion !== false,
    masterclassEnabled: config.masterclassEnabled !== false,
    days: (config.days || []).map((day) => ({
      id: day.id ?? '',
      label: day.label ?? '',
      letter: day.letter ?? '',
      enabled: day.enabled !== false,
    })),
    hours: [...(config.hours || [])].sort(),
    ticketPrefix: config.ticketPrefix ?? '',
  }
}

const stringify = (value) => JSON.stringify(value)

/** Interruptor accesible con la piel de la marca. */
function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-belen-cream/70 px-4 py-3 ring-1 ring-belen-blue/10">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'mt-0.5 relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-belen-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-snug text-slate-500">{description}</p>}
      </div>

      <Badge status={checked ? 'approved' : 'cancelled'}>{checked ? 'Sí' : 'No'}</Badge>
    </div>
  )
}

export default function AdminSettings() {
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const { config, loading, error } = useConfig()
  const { reservations, loading: loadingReservations } = useReservations()

  const [draft, setDraft] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [remoteChanged, setRemoteChanged] = useState(false)

  const draftRef = useRef(null)
  const baselineRef = useRef(null)

  // Contador de seriales (counters/tickets), solo lectura.
  const [counterNext, setCounterNext] = useState(null)
  const [counterLoading, setCounterLoading] = useState(true)
  const [counterError, setCounterError] = useState('')

  // Alta de hora nueva.
  const [newHour, setNewHour] = useState('')
  const [hourError, setHourError] = useState('')

  // Confirmaciones.
  const [removeTarget, setRemoveTarget] = useState(null) // { type: 'day'|'hour', index, value, label, count }
  const [pendingPath, setPendingPath] = useState(null)

  const setDraftSafe = useCallback((updater) => {
    setDraft((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      draftRef.current = next
      return next
    })
  }, [])

  // --------------------------------------------------- Sincronización con Firestore

  useEffect(() => {
    if (!config) return

    const snapshot = pickEditable(config)
    const snapshotJson = stringify(snapshot)
    const previousBaselineJson = baselineRef.current
    const currentDraft = draftRef.current
    const isDirty =
      Boolean(currentDraft) &&
      Boolean(previousBaselineJson) &&
      stringify(currentDraft) !== previousBaselineJson

    baselineRef.current = snapshotJson
    setBaseline(snapshot)

    if (!currentDraft || !isDirty) {
      // Sin cambios locales: adoptamos lo que venga del servidor.
      setDraftSafe(pickEditable(config))
      setRemoteChanged(false)
    } else if (previousBaselineJson !== snapshotJson) {
      // Alguien más guardó mientras editábamos: avisamos sin pisar el trabajo del usuario.
      setRemoteChanged(true)
    }
  }, [config, setDraftSafe])

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, COL.COUNTERS, TICKET_COUNTER_DOC),
      (snap) => {
        if (snap.exists()) {
          setCounterNext(Number(snap.data()?.next) || 1)
          setCounterError('')
        } else {
          setCounterNext(null)
          setCounterError(
            'El contador de entradas todavía no existe. Se crea solo al entrar al panel; recarga la página.',
          )
        }
        setCounterLoading(false)
      },
      (err) => {
        console.error('[AdminSettings] counters/tickets', err)
        setCounterNext(null)
        setCounterError('No se pudo leer el contador de entradas. Revisa tu conexión.')
        setCounterLoading(false)
      },
    )
    return unsubscribe
  }, [])

  const dirty = useMemo(
    () => Boolean(draft && baseline) && stringify(draft) !== stringify(baseline),
    [draft, baseline],
  )

  // --------------------------------------------------- Avisos de cambios sin guardar

  useEffect(() => {
    if (!dirty) return undefined

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = 'Tienes cambios sin guardar.'
      return 'Tienes cambios sin guardar.'
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  // Intercepta la navegación interna (menú lateral, enlaces) mientras haya cambios pendientes.
  useEffect(() => {
    if (!dirty) return undefined

    const handleClick = (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a[href]')
      if (!anchor) return
      if (anchor.hasAttribute('download')) return
      if (anchor.target && anchor.target !== '' && anchor.target !== '_self') return

      const url = new URL(anchor.getAttribute('href'), window.location.href)
      if (url.origin !== window.location.origin) return

      const to = `${url.pathname}${url.search}${url.hash}`
      const current = `${location.pathname}${location.search}`
      if (to === current) return

      event.preventDefault()
      event.stopPropagation()
      setPendingPath(to)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [dirty, location])

  // --------------------------------------------------- Reservas aprobadas por día / hora

  const approvedByDay = useMemo(() => {
    const counts = {}
    reservations.forEach((reservation) => {
      if (reservation.status !== RESERVATION_STATUS.APPROVED) return
      counts[reservation.day] = (counts[reservation.day] || 0) + 1
    })
    return counts
  }, [reservations])

  const approvedByHour = useMemo(() => {
    const counts = {}
    reservations.forEach((reservation) => {
      if (reservation.status !== RESERVATION_STATUS.APPROVED) return
      counts[reservation.hour] = (counts[reservation.hour] || 0) + 1
    })
    return counts
  }, [reservations])

  // --------------------------------------------------- Edición del borrador

  const setField = (field, value) => {
    setDraftSafe((current) => ({ ...current, [field]: value }))
  }

  const setDay = (index, patch) => {
    setDraftSafe((current) => ({
      ...current,
      days: current.days.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    }))
  }

  const handleDayDateChange = (index, value) => {
    setDraftSafe((current) => ({
      ...current,
      days: current.days.map((day, i) => {
        if (i !== index) return day
        // La etiqueta y la letra se autocompletan si el usuario no las ha personalizado.
        const labelWasSuggested = !day.label || day.label === suggestLabel(day.id)
        const letterWasSuggested = !day.letter || day.letter === suggestLetter(day.id)
        return {
          ...day,
          id: value,
          label: labelWasSuggested ? suggestLabel(value) : day.label,
          letter: letterWasSuggested ? suggestLetter(value) : day.letter,
        }
      }),
    }))
  }

  const addDay = () => {
    setDraftSafe((current) => ({
      ...current,
      days: [...current.days, { id: '', label: '', letter: '', enabled: true }],
    }))
  }

  const requestRemoveDay = (index) => {
    const day = draft.days[index]
    const count = approvedByDay[day.id] || 0
    if (count > 0) {
      setRemoveTarget({
        type: 'day',
        index,
        value: day.id,
        label: day.label || day.id,
        count,
      })
      return
    }
    removeDay(index)
  }

  const removeDay = (index) => {
    setDraftSafe((current) => ({
      ...current,
      days: current.days.filter((_, i) => i !== index),
    }))
  }

  const addHour = () => {
    const hour = clean(newHour)
    if (!HOUR_RE.test(hour)) {
      setHourError('Escribe una hora válida en formato HH:mm, por ejemplo 09:00.')
      return
    }
    if (draft.hours.includes(hour)) {
      setHourError('Esa hora ya está en la lista.')
      return
    }
    setHourError('')
    setNewHour('')
    setDraftSafe((current) => ({
      ...current,
      hours: [...current.hours, hour].sort(),
    }))
  }

  const requestRemoveHour = (hour) => {
    const count = approvedByHour[hour] || 0
    if (count > 0) {
      setRemoveTarget({ type: 'hour', value: hour, label: hour, count })
      return
    }
    removeHour(hour)
  }

  const removeHour = (hour) => {
    setDraftSafe((current) => ({
      ...current,
      hours: current.hours.filter((item) => item !== hour),
    }))
  }

  const confirmRemove = () => {
    if (!removeTarget) return
    if (removeTarget.type === 'day') removeDay(removeTarget.index)
    else removeHour(removeTarget.value)
    setRemoveTarget(null)
  }

  // --------------------------------------------------- Guardado

  const buildPayload = () => ({
    eventName: clean(draft.eventName),
    eventYear: Number(draft.eventYear),
    tagline: clean(draft.tagline),
    formOpen: Boolean(draft.formOpen),
    allowCompanion: Boolean(draft.allowCompanion),
    masterclassEnabled: Boolean(draft.masterclassEnabled),
    days: draft.days.map((day) => ({
      id: clean(day.id),
      label: clean(day.label),
      letter: clean(day.letter).toUpperCase().slice(0, 1),
      enabled: day.enabled !== false,
    })),
    hours: [...new Set(draft.hours.map((hour) => clean(hour)))].sort(),
    ticketPrefix: clean(draft.ticketPrefix).toUpperCase().replace(/[^A-Z0-9]/g, ''),
  })

  const validate = (payload) => {
    const next = { days: {} }
    const messages = []

    if (!payload.eventName) {
      next.eventName = 'El nombre del evento es obligatorio.'
      messages.push(next.eventName)
    }
    if (!Number.isInteger(payload.eventYear) || payload.eventYear < 2020 || payload.eventYear > 2100) {
      next.eventYear = 'El año debe ser un número entre 2020 y 2100.'
      messages.push(next.eventYear)
    }

    if (payload.days.length === 0) {
      next.days.general = 'Debes configurar al menos un día del evento.'
      messages.push(next.days.general)
    }

    const seen = new Set()
    payload.days.forEach((day, index) => {
      const dayErrors = {}
      if (!DAY_ID_RE.test(day.id)) {
        dayErrors.id = 'Elige una fecha válida.'
      } else if (seen.has(day.id)) {
        dayErrors.id = 'Esta fecha está repetida.'
      } else {
        seen.add(day.id)
      }
      if (!day.label) dayErrors.label = 'Escribe un nombre visible.'
      if (!day.letter) dayErrors.letter = 'Falta la letra.'
      if (Object.keys(dayErrors).length > 0) {
        next.days[index] = dayErrors
        messages.push(`Revisa el día ${index + 1} de la lista.`)
      }
    })

    if (payload.hours.length === 0) {
      next.hours = 'Debes configurar al menos una hora de cita.'
      messages.push(next.hours)
    } else if (payload.hours.some((hour) => !HOUR_RE.test(hour))) {
      next.hours = 'Hay horas con un formato inválido. Usa HH:mm.'
      messages.push(next.hours)
    }

    if (!payload.ticketPrefix) {
      next.ticketPrefix = 'El prefijo de la entrada es obligatorio.'
      messages.push(next.ticketPrefix)
    } else if (payload.ticketPrefix.length > 5) {
      next.ticketPrefix = 'El prefijo no puede tener más de 5 caracteres.'
      messages.push(next.ticketPrefix)
    }

    return { errors: next, messages }
  }

  const handleSave = async () => {
    if (!draft || !dirty) return

    const payload = buildPayload()
    const { errors: validationErrors, messages } = validate(payload)
    setErrors(validationErrors)

    if (messages.length > 0) {
      toast.error(messages[0])
      return
    }

    setSaving(true)
    try {
      await updateConfig(payload)

      // Alineamos borrador y referencia con lo que acabamos de guardar para que la
      // suscripción en vivo no lo interprete como un cambio ajeno.
      baselineRef.current = stringify(payload)
      setBaseline(payload)
      setDraftSafe(JSON.parse(stringify(payload)))
      setRemoteChanged(false)
      setErrors({})
      toast.success('Configuración guardada.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const discardChanges = () => {
    if (!baseline) return
    setDraftSafe(JSON.parse(stringify(baseline)))
    setErrors({})
    setRemoteChanged(false)
  }

  // --------------------------------------------------- Estados de carga / error / vacío

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-belen-blue">
        <Spinner size="lg" />
        <p className="text-sm font-medium text-slate-500">Cargando la configuración del evento…</p>
      </div>
    )
  }

  if (!config || !draft) {
    return (
      <Card>
        <EmptyState
          icon={Settings2}
          title="Configuración no disponible"
          description={
            error ||
            'Todavía no existe el documento de configuración del evento. Recarga la página para crearlo.'
          }
          action={
            <Button icon={RefreshCw} onClick={() => window.location.reload()}>
              Reintentar
            </Button>
          }
        />
      </Card>
    )
  }

  const nextSerial =
    counterNext !== null
      ? formatSerial(clean(draft.ticketPrefix).toUpperCase() || 'GEN', counterNext)
      : null

  return (
    <div className="space-y-5 pb-4">
      <header>
        <h1 className="font-display text-xl font-extrabold uppercase tracking-wide text-belen-blue sm:text-2xl">
          Configuración del evento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Estos parámetros controlan el formulario público, los días y horas disponibles y las
          entradas.
          {config.updatedAt && (
            <span className="ml-1 text-slate-400">
              Última actualización: {formatDateTime(config.updatedAt)}.
            </span>
          )}
        </p>
      </header>

      {error && (
        <div className="flex gap-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {remoteChanged && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-medium text-amber-800">
            Otro administrador cambió la configuración mientras editabas. Si guardas, tus valores
            reemplazarán a los suyos.
          </p>
          <Button variant="secondary" size="sm" onClick={discardChanges}>
            Descartar mis cambios
          </Button>
        </div>
      )}

      {/* 1 ------------------------------------------------ Datos del evento */}
      <Card title="Datos del evento" subtitle="Aparecen en el formulario público y en las entradas.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nombre del evento"
            required
            value={draft.eventName}
            onChange={(event) => setField('eventName', event.target.value)}
            error={errors.eventName}
            placeholder="Día del Cliente"
          />

          <Input
            label="Año"
            required
            type="number"
            inputMode="numeric"
            min={2020}
            max={2100}
            value={draft.eventYear}
            onChange={(event) => {
              const raw = event.target.value
              // Guardamos número para que la comparación con lo cargado no marque cambios falsos.
              setField('eventYear', raw === '' ? '' : Number(raw))
            }}
            error={errors.eventYear}
          />

          <div className="sm:col-span-2">
            <Input
              label="Lema"
              value={draft.tagline}
              onChange={(event) => setField('tagline', event.target.value)}
              hint="El lema oficial del evento, por ejemplo “Conexiones que impulsan”."
              placeholder="Conexiones que impulsan"
            />
          </div>
        </div>
      </Card>

      {/* 2 ------------------------------------------------ Estado del formulario */}
      <Card
        title="Estado del formulario"
        subtitle="Controla qué ve y qué puede enviar el cliente en la página pública."
      >
        <div className="space-y-3">
          <Toggle
            label="Formulario abierto"
            description="Cerrar las reservas hará que el formulario público muestre un aviso de cerrado."
            checked={draft.formOpen}
            onChange={(value) => setField('formOpen', value)}
          />
          <Toggle
            label="Permitir acompañante"
            description="Si se apaga, se oculta el bloque de acompañante y solo se emite una entrada por cita."
            checked={draft.allowCompanion}
            onChange={(value) => setField('allowCompanion', value)}
          />
          <Toggle
            label="Mostrar masterclass"
            description="Si se apaga, se oculta la pregunta de la masterclass en el formulario."
            checked={draft.masterclassEnabled}
            onChange={(value) => setField('masterclassEnabled', value)}
          />
        </div>
      </Card>

      {/* 3 ------------------------------------------------ Días del evento */}
      <Card
        title="Días del evento"
        subtitle="La fecha se guarda como identificador; la letra es la que se imprime en la entrada."
        action={
          <Button variant="secondary" size="sm" icon={Plus} onClick={addDay}>
            Agregar día
          </Button>
        }
      >
        {draft.days.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Sin días configurados"
            description="Agrega al menos un día para que el formulario público pueda mostrar fechas disponibles."
            action={
              <Button icon={Plus} onClick={addDay}>
                Agregar día
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {draft.days.map((day, index) => {
              const dayErrors = errors.days?.[index] || {}
              const approved = approvedByDay[day.id] || 0

              return (
                <li
                  key={`day-${index}`}
                  className="rounded-2xl bg-belen-cream/60 p-3 ring-1 ring-belen-blue/10"
                >
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                    <div className="xl:col-span-4">
                      <Input
                        label="Fecha"
                        type="date"
                        value={day.id}
                        onChange={(event) => handleDayDateChange(index, event.target.value)}
                        error={dayErrors.id}
                      />
                    </div>

                    <div className="xl:col-span-4">
                      <Input
                        label="Nombre visible"
                        value={day.label}
                        onChange={(event) => setDay(index, { label: event.target.value })}
                        error={dayErrors.label}
                        placeholder="8 Septiembre"
                      />
                    </div>

                    <div className="xl:col-span-2">
                      <Input
                        label="Letra"
                        value={day.letter}
                        maxLength={1}
                        onChange={(event) =>
                          setDay(index, { letter: event.target.value.toUpperCase().slice(0, 1) })
                        }
                        error={dayErrors.letter}
                        placeholder="M"
                        className="uppercase"
                      />
                    </div>

                    <div className="flex items-end justify-between gap-2 xl:col-span-2">
                      <label className="flex cursor-pointer items-center gap-2 pb-2.5">
                        <input
                          type="checkbox"
                          checked={day.enabled}
                          onChange={(event) => setDay(index, { enabled: event.target.checked })}
                          className="h-5 w-5 cursor-pointer appearance-none rounded-md border-0 bg-white shadow-sm ring-1 ring-inset ring-belen-blue/25 transition-colors checked:bg-belen-blue checked:ring-belen-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
                        />
                        <span className="text-xs font-semibold text-slate-600">Activo</span>
                      </label>

                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        onClick={() => requestRemoveDay(index)}
                        aria-label={`Quitar el día ${day.label || index + 1}`}
                        className="mb-1 text-red-600 hover:bg-red-50 active:bg-red-100"
                      />
                    </div>
                  </div>

                  {approved > 0 && !loadingReservations && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      {approved} {approved === 1 ? 'reserva aprobada' : 'reservas aprobadas'} en este
                      día
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {errors.days?.general && (
          <p role="alert" className="mt-3 text-xs font-medium text-red-600">
            {errors.days.general}
          </p>
        )}
      </Card>

      {/* 4 ------------------------------------------------ Horas disponibles */}
      <Card
        title="Horas disponibles"
        subtitle="Cada cita dura una hora. Las horas se ordenan solas."
      >
        {draft.hours.length === 0 ? (
          <div className="rounded-2xl bg-belen-cream/60 px-4 py-6 text-center ring-1 ring-belen-blue/10">
            <Clock className="mx-auto h-6 w-6 text-belen-blue/50" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-belen-blue">Sin horas configuradas</p>
            <p className="mt-1 text-xs text-slate-500">
              Agrega al menos una hora para que los clientes puedan reservar.
            </p>
          </div>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {draft.hours.map((hour) => {
              const approved = approvedByHour[hour] || 0
              return (
                <li key={hour}>
                  <span
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-1.5 text-sm font-semibold ring-1',
                      approved > 0
                        ? 'bg-amber-50 text-amber-800 ring-amber-200'
                        : 'bg-belen-blue/5 text-belen-blue ring-belen-blue/15',
                    ].join(' ')}
                  >
                    {hour}
                    {approved > 0 && !loadingReservations && (
                      <span className="text-xs font-medium">({approved})</span>
                    )}
                    <button
                      type="button"
                      onClick={() => requestRemoveHour(hour)}
                      aria-label={`Quitar la hora ${hour}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-red-100 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-2 border-t border-belen-blue/10 pt-4 sm:flex-row sm:items-start">
          <div className="sm:w-48">
            <Input
              label="Nueva hora"
              type="time"
              value={newHour}
              onChange={(event) => {
                setNewHour(event.target.value)
                setHourError('')
              }}
              error={hourError}
            />
          </div>
          <div className="sm:pt-[1.85rem]">
            <Button
              variant="secondary"
              icon={Plus}
              onClick={addHour}
              className="w-full sm:w-auto"
            >
              Agregar hora
            </Button>
          </div>
        </div>

        {errors.hours && (
          <p role="alert" className="mt-3 text-xs font-medium text-red-600">
            {errors.hours}
          </p>
        )}
      </Card>

      {/* 5 ------------------------------------------------ Entradas */}
      <Card title="Entradas" subtitle="Prefijo y correlativo del serial impreso en cada entrada.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Prefijo del serial"
            required
            value={draft.ticketPrefix}
            maxLength={5}
            onChange={(event) =>
              setField(
                'ticketPrefix',
                event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
              )
            }
            error={errors.ticketPrefix}
            hint="Solo letras y números, máximo 5 caracteres."
            placeholder="GEN"
            className="uppercase"
          />

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-belen-ink">
              Próximo serial (solo lectura)
            </span>

            <div className="flex h-[2.75rem] items-center gap-2 rounded-xl bg-slate-50 px-3.5 text-sm font-semibold text-slate-600 ring-1 ring-inset ring-belen-blue/15">
              <Ticket className="h-4 w-4 shrink-0 text-belen-orange" aria-hidden="true" />
              {counterLoading ? (
                <span className="inline-flex items-center gap-2 text-slate-500">
                  <Spinner size="xs" className="text-belen-blue" />
                  Cargando…
                </span>
              ) : counterError ? (
                <span className="truncate text-red-600">Error al leer el contador</span>
              ) : (
                <span className="font-mono tracking-wide text-belen-blue">{nextSerial}</span>
              )}
            </div>

            <p className="mt-1.5 text-xs text-slate-500">
              {counterError ||
                'Se asigna automáticamente al aprobar una reserva. Los seriales nunca se reutilizan.'}
            </p>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------ Barra pegajosa de guardado */}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/95 p-3 shadow-card-hover ring-1 ring-belen-blue/15 backdrop-blur">
        <p
          className={[
            'inline-flex items-center gap-2 text-sm font-semibold',
            dirty ? 'text-amber-700' : 'text-slate-500',
          ].join(' ')}
        >
          {dirty ? (
            <>
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              Tienes cambios sin guardar
            </>
          ) : (
            'Todo está guardado'
          )}
        </p>

        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={discardChanges} disabled={saving}>
              Descartar
            </Button>
          )}
          <Button icon={Save} onClick={handleSave} disabled={!dirty} loading={saving}>
            Guardar cambios
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------ Confirmar quitar día / hora */}
      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        size="sm"
        title={removeTarget?.type === 'hour' ? 'Quitar hora' : 'Quitar día'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" icon={Trash2} onClick={confirmRemove}>
              Quitar de todos modos
            </Button>
          </>
        }
      >
        {removeTarget && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="min-w-0 text-sm text-amber-800">
                <p className="font-semibold">
                  {removeTarget.type === 'hour'
                    ? `La hora ${removeTarget.label} ya tiene ${removeTarget.count} ${
                        removeTarget.count === 1 ? 'reserva aprobada' : 'reservas aprobadas'
                      }.`
                    : `El día ${removeTarget.label} ya tiene ${removeTarget.count} ${
                        removeTarget.count === 1 ? 'reserva aprobada' : 'reservas aprobadas'
                      }.`}
                </p>
                <p className="mt-1 leading-snug">
                  Quitarlo de la lista no borra esas reservas ni las entradas ya emitidas, pero
                  dejarán de mostrarse con su nombre en el panel y nadie más podrá reservar en ese
                  horario.
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-slate-600">
              El cambio se aplica cuando pulses <strong>Guardar cambios</strong>. Puedes descartarlo
              antes de guardar.
            </p>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------ Confirmar salida con cambios */}
      <Modal
        open={Boolean(pendingPath)}
        onClose={() => setPendingPath(null)}
        size="sm"
        title="Tienes cambios sin guardar"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingPath(null)}>
              Seguir editando
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const to = pendingPath
                setPendingPath(null)
                discardChanges()
                navigate(to)
              }}
            >
              Salir sin guardar
            </Button>
            <Button
              icon={Save}
              loading={saving}
              onClick={async () => {
                const to = pendingPath
                await handleSave()
                // Solo salimos si el guardado dejó el borrador limpio.
                if (stringify(draftRef.current) === baselineRef.current) {
                  setPendingPath(null)
                  navigate(to)
                }
              }}
            >
              Guardar y salir
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          Si sales ahora, se perderán los cambios de configuración que aún no has guardado.
        </p>
      </Modal>
    </div>
  )
}
