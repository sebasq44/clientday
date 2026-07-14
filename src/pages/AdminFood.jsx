import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  History,
  Keyboard,
  RotateCcw,
  ScanLine,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'

import { useAuth } from '../hooks/useAuth'
import { useConfig } from '../hooks/useConfig'
import { processMealScan, subscribeScans } from '../services/scanService'
import { subscribeTickets } from '../services/ticketsService'
import {
  HOLDER_TYPE_LABEL,
  SCAN_ACTION,
  SCAN_ACTION_LABEL,
  TICKET_STATUS,
  formatSerial,
} from '../lib/constants'
import { dayLabel, formatHourRange, formatTime } from '../lib/format'
import {
  beep,
  getAudioContext,
  qrboxFromViewfinder,
  startRearCamera,
  vibrate,
} from '../lib/qrCamera'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'

/**
 * Id del contenedor donde html5-qrcode inyecta el vídeo.
 * DEBE ser distinto al de /admin/scanner ('qr-reader'): si ambas páginas compartieran id y las dos
 * quedaran montadas (transición de ruta), la librería escribiría en el contenedor equivocado.
 */
const READER_ID = 'qr-reader-food'

/** Cuántos escaneos de la bitácora se pintan bajo el escáner. */
const LOG_VISIBLE = 12

/**
 * En este módulo solo interesan dos acciones: la comida entregada y los intentos rechazados.
 * Las entradas y salidas de la puerta pertenecen al otro escáner y aquí solo serían ruido.
 */
const RELEVANT_ACTIONS = new Set([SCAN_ACTION.MEAL, SCAN_ACTION.REJECTED])

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function AdminFood() {
  const { user } = useAuth()
  const { config } = useConfig()
  const toast = useToast()

  const [cameraActive, setCameraActive] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const [result, setResult] = useState(null)
  const [processing, setProcessing] = useState(false)

  const [tickets, setTickets] = useState([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [scans, setScans] = useState([])
  const [scansLoading, setScansLoading] = useState(true)
  const [feedError, setFeedError] = useState('')

  const [serialInput, setSerialInput] = useState('')
  const [serialError, setSerialError] = useState('')
  const [serialBusy, setSerialBusy] = useState(false)

  const scannerRef = useRef(null)
  // Evita que un mismo QR se procese dos veces mientras la transacción está en vuelo.
  const busyRef = useRef(false)
  // Tras desmontar, ninguna promesa pendiente debe tocar el estado.
  const aliveRef = useRef(true)

  /* --- Datos en vivo: entradas emitidas y bitácora de escaneos --- */
  useEffect(() => {
    aliveRef.current = true
    let unsubscribeTickets = () => {}
    let unsubscribeScans = () => {}

    try {
      unsubscribeTickets = subscribeTickets((next) => {
        if (!aliveRef.current) return
        setTickets(next)
        setTicketsLoading(false)
      })
      unsubscribeScans = subscribeScans((next) => {
        if (!aliveRef.current) return
        setScans(next)
        setScansLoading(false)
      })
    } catch (error) {
      console.error('[AdminFood] No se pudieron abrir las suscripciones:', error)
      setFeedError('No pudimos conectar con la base de datos. Revisa tu conexión y recarga la página.')
      setTicketsLoading(false)
      setScansLoading(false)
    }

    return () => {
      aliveRef.current = false
      unsubscribeTickets()
      unsubscribeScans()
    }
  }, [])

  /* --- Contadores en vivo ---
     · entregadas → la entrada ya retiró su plato (mealAt con fecha)
     · pendientes → está DENTRO del evento y todavía no lo ha retirado (los únicos que pueden comer)
  */
  const counts = useMemo(() => {
    let served = 0
    let pending = 0

    for (const ticket of tickets) {
      if (ticket.mealAt) served += 1
      else if (ticket.status === TICKET_STATUS.INSIDE) pending += 1
    }

    return { served, pending, total: tickets.length }
  }, [tickets])

  /**
   * Cierre limpio del lector. html5-qrcode lanza si se le pide parar algo que ya está parado,
   * así que todo va envuelto: al desmontar la página nunca debe quedar la cámara encendida.
   */
  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    scannerRef.current = null
    if (!scanner) return

    try {
      await scanner.stop().then(() => scanner.clear())
    } catch (error) {
      // Ya estaba detenido o el navegador soltó el stream por su cuenta: no hay nada que hacer.
      console.warn('[AdminFood] El lector ya estaba detenido:', error?.message || error)
    }
  }, [])

  // Apaga la cámara al salir de la página (o al recargar en caliente durante el desarrollo).
  useEffect(() => {
    return () => {
      aliveRef.current = false
      stopScanner()
    }
  }, [stopScanner])

  /* --- Resolución de un token: pausa, transacción y pantalla de resultado --- */
  const handleToken = useCallback(
    async (rawToken) => {
      const token = String(rawToken ?? '').trim()
      if (!token || busyRef.current) return null

      busyRef.current = true
      setProcessing(true)

      // Pausar ANTES de la transacción: si no, la cámara dispara el mismo QR decenas de veces.
      const scanner = scannerRef.current
      if (scanner) {
        try {
          if (scanner.getState() === Html5QrcodeScannerState.SCANNING) scanner.pause(true)
        } catch (error) {
          console.warn('[AdminFood] No se pudo pausar el lector:', error?.message || error)
        }
      }

      try {
        const outcome = await processMealScan(token, user?.uid)
        if (!aliveRef.current) return outcome

        vibrate(outcome.ok)
        beep(outcome.ok)
        setResult(outcome)
        return outcome
      } catch (error) {
        // processMealScan ya absorbe los fallos previsibles; esto es la red de seguridad final.
        console.error('[AdminFood] Error inesperado al procesar el escaneo de comida:', error)
        if (aliveRef.current) {
          const message = error?.message || 'No se pudo procesar el escaneo. Inténtalo de nuevo.'
          vibrate(false)
          beep(false)
          setResult({ ok: false, action: SCAN_ACTION.REJECTED, ticket: null, message })
        }
        return null
      } finally {
        busyRef.current = false
        if (aliveRef.current) setProcessing(false)
      }
    },
    [user?.uid],
  )

  /* --- Cámara --- */
  const startCamera = useCallback(async () => {
    if (scannerRef.current || cameraStarting) return

    setCameraStarting(true)
    setCameraError('')

    // Un gesto del usuario acaba de ocurrir: es el momento válido para despertar el audio.
    getAudioContext()

    try {
      const scanner = new Html5Qrcode(READER_ID, { verbose: false })
      scannerRef.current = scanner

      await startRearCamera(
        scanner,
        { fps: 15, qrbox: qrboxFromViewfinder },
        (decodedText) => {
          handleToken(decodedText)
        },
        () => {
          // Se invoca en CADA fotograma sin QR legible. Silencio absoluto: no es un error.
        },
      )

      if (!aliveRef.current) {
        await stopScanner()
        return
      }
      setCameraActive(true)
    } catch (error) {
      console.error('[AdminFood] No se pudo iniciar la cámara:', error)
      scannerRef.current = null
      setCameraActive(false)
      setCameraError(
        'No pudimos abrir la cámara. Concede el permiso en el navegador y asegúrate de entrar por HTTPS. ' +
          'Mientras tanto, puedes entregar la comida tecleando el serial.',
      )
    } finally {
      if (aliveRef.current) setCameraStarting(false)
    }
  }, [cameraStarting, handleToken, stopScanner])

  const stopCamera = useCallback(async () => {
    await stopScanner()
    if (!aliveRef.current) return
    setCameraActive(false)
    setResult(null)
  }, [stopScanner])

  /** "Escanear siguiente": cierra el resultado y reanuda el vídeo pausado. */
  const scanNext = useCallback(() => {
    setResult(null)
    setSerialError('')

    const scanner = scannerRef.current
    if (!scanner) return

    try {
      if (scanner.getState() === Html5QrcodeScannerState.PAUSED) scanner.resume()
    } catch (error) {
      console.warn('[AdminFood] No se pudo reanudar el lector:', error?.message || error)
    }
  }, [])

  /* --- Respaldo: entregar por serial cuando la cámara falla --- */
  const handleSerialSubmit = useCallback(
    async (event) => {
      event.preventDefault()

      const typed = serialInput.trim().toUpperCase()
      if (!typed) {
        setSerialError('Escribe el serial impreso en la entrada.')
        return
      }
      if (ticketsLoading) {
        setSerialError('Las entradas aún se están cargando. Espera un segundo.')
        return
      }

      // El encargado puede teclear "GEN-0007" o simplemente "7": ambos deben encontrar la entrada.
      const prefix = config?.ticketPrefix || 'GEN'
      const candidate = /^\d+$/.test(typed) ? formatSerial(prefix, Number(typed)) : typed
      const ticket = tickets.find((item) => String(item.serial || '').toUpperCase() === candidate)

      if (!ticket) {
        setSerialError(`No existe ninguna entrada con el serial ${candidate}.`)
        toast.error(`No encontramos la entrada ${candidate}.`)
        return
      }

      setSerialError('')
      setSerialBusy(true)
      try {
        // Las reglas de negocio (dentro del evento, una sola comida) las decide el servicio.
        const outcome = await handleToken(ticket.qrToken)
        if (outcome) setSerialInput('')
      } finally {
        if (aliveRef.current) setSerialBusy(false)
      }
    },
    [config?.ticketPrefix, handleToken, serialInput, tickets, ticketsLoading, toast],
  )

  const visibleScans = useMemo(
    () => scans.filter((scan) => RELEVANT_ACTIONS.has(scan.action)).slice(0, LOG_VISIBLE),
    [scans],
  )

  return (
    <div className="space-y-5">
      {result && (
        <MealResultScreen result={result} config={config} onNext={scanNext} onClose={stopCamera} />
      )}

      {/* Encabezado: qué hace este módulo, en una línea */}
      <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-belen-blue/10 sm:px-6">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-belen-orange/10 text-belen-orange">
          <UtensilsCrossed className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-base font-extrabold uppercase tracking-wide text-belen-blue">
            Comida
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Escanea el QR de la invitación para entregar el plato. Solo una comida por persona, y solo
            si ya registró su entrada al evento.
          </p>
        </div>
      </div>

      {/* Contadores en vivo */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <CounterTile
          label="Comidas entregadas"
          value={counts.served}
          loading={ticketsLoading}
          className="bg-emerald-50 text-emerald-700 ring-emerald-200"
        />
        <CounterTile
          label="Pendientes"
          value={counts.pending}
          loading={ticketsLoading}
          className="bg-belen-orange/10 text-belen-orange-dark ring-belen-orange/30"
        />
        <CounterTile
          label="Total de entradas"
          value={counts.total}
          loading={ticketsLoading}
          className="bg-belen-blue/5 text-belen-blue ring-belen-blue/20"
        />
      </div>
      <p className="-mt-3 px-1 text-xs text-slate-500">
        «Pendientes» son las personas que están dentro del evento y todavía no han retirado su plato.
      </p>

      {feedError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700 ring-1 ring-red-200"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{feedError}</p>
        </div>
      )}

      {/* Cámara */}
      <Card
        title="Entrega de comida"
        subtitle="Apunta al QR de la invitación. Cada entrada puede retirar un único plato."
      >
        <div className="space-y-4">
          {/*
            IMPORTANTE: el contenedor del lector lo gestiona html5-qrcode por innerHTML (lo vacía en
            start()). No debe contener hijos de React o al reconciliarlos React haría removeChild
            sobre nodos que la librería ya borró (NotFoundError → pantalla en blanco). Por eso va
            SIEMPRE vacío y los placeholders son hermanos en un overlay absoluto.
          */}
          <div className="relative mx-auto aspect-square min-h-[15rem] w-full max-w-sm overflow-hidden rounded-2xl bg-belen-ink/95 [&_video]:h-full [&_video]:rounded-2xl [&_video]:object-cover">
            <div id={READER_ID} className="h-full w-full" />

            {!cameraActive && !cameraStarting && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-white/70">
                <ScanLine className="h-10 w-10 text-white/50" aria-hidden="true" />
                <p className="text-sm font-medium text-white/70">La cámara está apagada</p>
              </div>
            )}
            {cameraStarting && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 py-10 text-center text-white">
                <Spinner size="lg" />
                <p className="text-sm font-medium">Abriendo la cámara…</p>
              </div>
            )}
          </div>

          {cameraActive ? (
            <Button
              variant="secondary"
              size="lg"
              icon={CameraOff}
              className="w-full"
              onClick={stopCamera}
            >
              Detener cámara
            </Button>
          ) : (
            <Button
              size="lg"
              icon={Camera}
              className="w-full"
              loading={cameraStarting}
              onClick={startCamera}
            >
              Abrir cámara
            </Button>
          )}

          {processing && (
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-belen-blue">
              <Spinner size="sm" /> Registrando la comida…
            </p>
          )}

          {cameraError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700 ring-1 ring-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{cameraError}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Respaldo manual por serial */}
      <Card
        title="Entrega manual"
        subtitle="Si la cámara falla, teclea el serial impreso en la entrada."
      >
        <form onSubmit={handleSerialSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Input
              label="Serial de la entrada"
              placeholder={`${config?.ticketPrefix || 'GEN'}-0001`}
              value={serialInput}
              error={serialError}
              hint="También puedes escribir solo el número: 7 equivale a GEN-0007."
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck="false"
              onChange={(event) => {
                setSerialInput(event.target.value)
                if (serialError) setSerialError('')
              }}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            variant="secondary"
            icon={Keyboard}
            loading={serialBusy}
            disabled={processing}
            className="w-full sm:mt-[1.85rem] sm:w-auto"
          >
            Entregar
          </Button>
        </form>
      </Card>

      {/* Bitácora en vivo: solo comidas entregadas e intentos rechazados */}
      <Card title="Últimas entregas" subtitle="Bitácora en vivo del puesto de comida.">
        {scansLoading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-belen-blue">
            <Spinner size="md" />
            <span className="text-sm font-medium">Cargando la bitácora…</span>
          </div>
        ) : visibleScans.length === 0 ? (
          <EmptyState
            icon={History}
            title="Sin entregas todavía"
            description="Cuando entregues el primer plato del día, aparecerá aquí."
          />
        ) : (
          <ul className="divide-y divide-belen-blue/10">
            {visibleScans.map((scan) => {
              const isMeal = scan.action === SCAN_ACTION.MEAL
              const Icon = isMeal ? UtensilsCrossed : XCircle
              const label = SCAN_ACTION_LABEL[scan.action] || SCAN_ACTION_LABEL[SCAN_ACTION.REJECTED]

              return (
                <li key={scan.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={[
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1',
                      isMeal
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-red-50 text-red-700 ring-red-200',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-belen-ink">
                      {scan.serial || 'Entrada desconocida'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {scan.reason ? scan.reason : label} · {formatTime(scan.scannedAt)}
                    </p>
                  </div>

                  <Badge status={isMeal ? 'inside' : 'rejected'}>{label}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas de la página                                                 */
/* ------------------------------------------------------------------ */

function CounterTile({ label, value, loading, className }) {
  return (
    <div className={`rounded-2xl px-2 py-3 text-center ring-1 sm:px-3 ${className}`}>
      <p className="text-[10px] font-bold uppercase leading-tight tracking-wide opacity-80 sm:text-[11px] sm:tracking-wider">
        {label}
      </p>
      <p className="mt-0.5 font-display text-2xl font-extrabold leading-none sm:text-3xl">
        {loading ? <Spinner size="sm" /> : value}
      </p>
    </div>
  )
}

/**
 * Pantalla de resultado a página completa. Se lee de un vistazo y a un metro de distancia:
 * verde = entrégale el plato, rojo = no le entregues nada (el mensaje explica por qué).
 */
function MealResultScreen({ result, config, onNext, onClose }) {
  const { action, ticket, message, ok } = result

  const isMeal = action === SCAN_ACTION.MEAL
  const theme = isMeal
    ? { bg: 'bg-emerald-600', Icon: UtensilsCrossed, title: 'Comida entregada' }
    : { bg: 'bg-red-600', Icon: XCircle, title: 'Rechazado' }

  const { Icon } = theme
  const holderType = ticket?.holderType ? HOLDER_TYPE_LABEL[ticket.holderType] : null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={theme.title}
      className={`fixed inset-0 z-[60] flex flex-col overflow-y-auto text-white ${theme.bg}`}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8 sm:px-6 lg:max-w-xl">
        <div className="flex flex-col items-center text-center">
          <Icon
            className="h-28 w-28 sm:h-32 sm:w-32 lg:h-40 lg:w-40"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <h2 className="mt-3 font-display text-4xl font-extrabold uppercase tracking-tight sm:text-5xl lg:text-6xl">
            {theme.title}
          </h2>

          {ticket?.holderName && (
            <p className="mt-3 text-2xl font-bold leading-tight sm:text-3xl lg:text-4xl">
              {ticket.holderName}
            </p>
          )}

          {holderType && (
            <span className="mt-2 rounded-full bg-white/20 px-3 py-1 text-sm font-bold uppercase tracking-wide">
              {holderType}
            </span>
          )}
        </div>

        {/* El servicio ya devuelve el motivo en español: ya retiró, no ha entrado, ya salió, QR inválido. */}
        {!ok && message && (
          <p className="mt-5 rounded-2xl bg-white/15 px-4 py-3 text-center text-base font-semibold leading-snug">
            {message}
          </p>
        )}

        {ticket ? (
          <dl className="mt-5 space-y-px overflow-hidden rounded-2xl bg-white/10 text-sm">
            <ResultRow label="Empresa" value={ticket.companyName} />
            <ResultRow label="Código de cliente" value={ticket.clientCode} />
            <ResultRow label="Serial" value={ticket.serial} mono />
            <ResultRow
              label="Cita"
              value={
                ticket.day || ticket.hour
                  ? `${dayLabel(config, ticket.day)} · ${formatHourRange(ticket.hour)}`
                  : null
              }
            />
            <ResultRow label="Hora de ingreso" value={formatTime(ticket.checkInAt)} />
            {/* En un rechazo por «ya retiró su comida», esta hora es justo lo que el encargado
                necesita para explicárselo a la persona. */}
            {(isMeal || ticket.mealAt) && (
              <ResultRow label="Hora de entrega" value={formatTime(ticket.mealAt)} />
            )}
          </dl>
        ) : (
          <p className="mt-5 text-center text-base font-medium text-white/80">
            No hay ninguna entrada asociada a este código.
          </p>
        )}

        <div className="mt-7 space-y-3">
          <button
            type="button"
            onClick={onNext}
            autoFocus
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-extrabold uppercase tracking-wide text-belen-ink shadow-card transition-transform active:scale-[0.98]"
          >
            <ScanLine className="h-5 w-5" aria-hidden="true" />
            Escanear siguiente
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-semibold text-white transition-colors hover:bg-white/25"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Cerrar y apagar la cámara
          </button>
        </div>
      </div>
    </div>
  )
}

function ResultRow({ label, value, mono = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4 bg-white/5 px-4 py-2.5">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-white/70">
        {label}
      </dt>
      <dd
        className={[
          'min-w-0 break-words text-right font-semibold',
          mono ? 'font-mono tracking-wide' : '',
        ].join(' ')}
      >
        {value || '—'}
      </dd>
    </div>
  )
}
