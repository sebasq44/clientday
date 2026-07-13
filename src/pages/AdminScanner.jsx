import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  History,
  Keyboard,
  LogIn,
  LogOut,
  RotateCcw,
  ScanLine,
  XCircle,
} from 'lucide-react'

import { useAuth } from '../hooks/useAuth'
import { useConfig } from '../hooks/useConfig'
import { processScan, subscribeScans } from '../services/scanService'
import { subscribeTickets } from '../services/ticketsService'
import {
  HOLDER_TYPE_LABEL,
  SCAN_ACTION,
  TICKET_STATUS,
  formatSerial,
} from '../lib/constants'
import { dayLabel, formatHourRange, formatTime } from '../lib/format'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'

/** Id del contenedor donde html5-qrcode inyecta el vídeo de la cámara. */
const READER_ID = 'qr-reader'

/**
 * Arranca la cámara priorizando SIEMPRE la trasera (principal) en móviles, que es
 * la cómoda para escanear QR. Cascada de estrategias de la más estricta a la más
 * tolerante, porque no todos los navegadores respetan igual la restricción facingMode:
 *   1) exact:'environment' → OBLIGA a la trasera (falla si el equipo no la tiene).
 *   2) 'environment'       → preferencia no estricta (respaldo).
 *   3) enumerar cámaras    → elegir explícitamente la trasera por su etiqueta.
 */
async function startRearCamera(scanner, scanConfig, onDecode, onError) {
  const constraints = [{ facingMode: { exact: 'environment' } }, { facingMode: 'environment' }]

  for (const source of constraints) {
    try {
      await scanner.start(source, scanConfig, onDecode, onError)
      return
    } catch (err) {
      // OverconstrainedError/NotFoundError: sin trasera (p. ej. una laptop). Probamos la siguiente.
      console.warn(
        '[AdminScanner] facingMode no disponible, probando siguiente estrategia:',
        err?.message || err,
      )
    }
  }

  // Último recurso: enumerar y elegir la trasera por etiqueta (en móvil suele ser la última).
  const cameras = await Html5Qrcode.getCameras()
  if (!cameras || cameras.length === 0) {
    throw new Error('No se detectó ninguna cámara en el dispositivo.')
  }
  const rear =
    cameras.find((c) => /back|rear|trasera|posterior|environment/i.test(c.label || '')) ||
    cameras[cameras.length - 1]
  await scanner.start(rear.id, scanConfig, onDecode, onError)
}

/** Cuántos escaneos de la bitácora se pintan bajo el escáner. */
const LOG_VISIBLE = 12

/** Cómo se presenta cada acción en la bitácora y en la pantalla de resultado. */
const ACTION_META = {
  [SCAN_ACTION.CHECK_IN]: { label: 'Entrada', badge: 'inside', Icon: LogIn },
  [SCAN_ACTION.CHECK_OUT]: { label: 'Salida', badge: 'exited', Icon: LogOut },
  [SCAN_ACTION.REJECTED]: { label: 'Rechazado', badge: 'rejected', Icon: XCircle },
}

/* ------------------------------------------------------------------ */
/* Realimentación física: vibración + bip generado con la Web Audio API */
/* ------------------------------------------------------------------ */

let audioContext = null

/** El AudioContext se crea perezosamente: los navegadores solo lo permiten tras un gesto. */
function getAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioCtor) return null

  if (!audioContext) audioContext = new AudioCtor()
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {})
  }
  return audioContext
}

/** Bip corto: agudo y breve si el escaneo fue válido, grave y largo si se rechazó. */
function beep(success) {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const duration = success ? 0.18 : 0.45
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = success ? 'sine' : 'square'
    oscillator.frequency.setValueAtTime(success ? 1320 : 180, ctx.currentTime)

    // Rampa exponencial: evita el chasquido de encender/apagar el oscilador en seco.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(success ? 0.22 : 0.3, ctx.currentTime + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + duration + 0.02)
  } catch {
    // El sonido es un extra: si el navegador lo bloquea, el escaneo sigue funcionando.
  }
}

/** Vibra el teléfono: un toque seco al aceptar, doble golpe al rechazar. */
function vibrate(success) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(success ? 100 : [100, 50, 100])
  } catch {
    // Algunos navegadores de escritorio exponen vibrate() y lanzan al usarlo. No es crítico.
  }
}

/** Recuadro de puntería proporcional al ancho del visor (móvil en vertical incluido). */
function qrboxFromViewfinder(viewfinderWidth, viewfinderHeight) {
  const smallestSide = Math.min(viewfinderWidth || 0, viewfinderHeight || 0)
  const size = Math.max(160, Math.floor(smallestSide * 0.72))
  return { width: size, height: size }
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function AdminScanner() {
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
      console.error('[AdminScanner] No se pudieron abrir las suscripciones:', error)
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

  /* --- Contadores en vivo --- */
  const counts = useMemo(() => {
    let inside = 0
    let exited = 0
    let pending = 0

    for (const ticket of tickets) {
      if (ticket.status === TICKET_STATUS.INSIDE) inside += 1
      else if (ticket.status === TICKET_STATUS.EXITED) exited += 1
      else pending += 1
    }

    return { inside, exited, pending, total: tickets.length }
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
      console.warn('[AdminScanner] El lector ya estaba detenido:', error?.message || error)
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
          console.warn('[AdminScanner] No se pudo pausar el lector:', error?.message || error)
        }
      }

      try {
        const outcome = await processScan(token, user?.uid)
        if (!aliveRef.current) return outcome

        vibrate(outcome.ok)
        beep(outcome.ok)
        setResult(outcome)
        return outcome
      } catch (error) {
        // processScan ya absorbe los fallos previsibles; esto es la red de seguridad final.
        console.error('[AdminScanner] Error inesperado al procesar el escaneo:', error)
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
        { fps: 10, qrbox: qrboxFromViewfinder },
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
      console.error('[AdminScanner] No se pudo iniciar la cámara:', error)
      scannerRef.current = null
      setCameraActive(false)
      setCameraError(
        'No pudimos abrir la cámara. Concede el permiso en el navegador y asegúrate de entrar por HTTPS. ' +
          'Mientras tanto, puedes registrar la entrada tecleando el serial.',
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
      console.warn('[AdminScanner] No se pudo reanudar el lector:', error?.message || error)
    }
  }, [])

  /* --- Respaldo: registrar por serial cuando la cámara falla --- */
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

      // El portero puede teclear "GEN-0007" o simplemente "7": ambos deben encontrar la entrada.
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
        const outcome = await handleToken(ticket.qrToken)
        if (outcome) setSerialInput('')
      } finally {
        if (aliveRef.current) setSerialBusy(false)
      }
    },
    [config?.ticketPrefix, handleToken, serialInput, tickets, ticketsLoading, toast],
  )

  const visibleScans = useMemo(() => scans.slice(0, LOG_VISIBLE), [scans])

  return (
    <div className="space-y-5">
      {result && (
        <ScanResultScreen result={result} config={config} onNext={scanNext} onClose={stopCamera} />
      )}

      {/* Contadores en vivo */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <CounterTile
          label="Dentro"
          value={counts.inside}
          loading={ticketsLoading}
          className="bg-emerald-50 text-emerald-700 ring-emerald-200"
        />
        <CounterTile
          label="Salieron"
          value={counts.exited}
          loading={ticketsLoading}
          className="bg-slate-100 text-slate-600 ring-slate-200"
        />
        <CounterTile
          label="Faltan"
          value={counts.pending}
          loading={ticketsLoading}
          className="bg-belen-blue/5 text-belen-blue ring-belen-blue/20"
        />
      </div>

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
        title="Control de acceso"
        subtitle="Apunta al QR de la entrada. El primer escaneo registra la entrada; el segundo, la salida."
      >
        <div className="space-y-4">
          {/*
            IMPORTANTE: #qr-reader lo gestiona html5-qrcode por innerHTML (lo vacía en start()).
            No debe contener hijos de React o al reconciliarlos React haría removeChild sobre nodos
            que la librería ya borró (NotFoundError → pantalla en blanco). Por eso el contenedor va
            SIEMPRE vacío y los placeholders son hermanos en un overlay absoluto.
          */}
          <div className="relative mx-auto min-h-[15rem] w-full max-w-sm overflow-hidden rounded-2xl bg-belen-ink/95 [&_video]:rounded-2xl">
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
              <Spinner size="sm" /> Procesando la entrada…
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
        title="Registro manual"
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
            Registrar
          </Button>
        </form>
      </Card>

      {/* Bitácora en vivo */}
      <Card title="Últimos escaneos" subtitle="Bitácora en vivo de la puerta.">
        {scansLoading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-belen-blue">
            <Spinner size="md" />
            <span className="text-sm font-medium">Cargando la bitácora…</span>
          </div>
        ) : visibleScans.length === 0 ? (
          <EmptyState
            icon={History}
            title="Sin escaneos todavía"
            description="Cuando registres la primera entrada del día, aparecerá aquí."
          />
        ) : (
          <ul className="divide-y divide-belen-blue/10">
            {visibleScans.map((scan) => {
              const meta = ACTION_META[scan.action] || ACTION_META[SCAN_ACTION.REJECTED]
              const { Icon } = meta

              return (
                <li key={scan.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={[
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1',
                      scan.action === SCAN_ACTION.CHECK_IN
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : scan.action === SCAN_ACTION.CHECK_OUT
                          ? 'bg-belen-blue/5 text-belen-blue ring-belen-blue/20'
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
                      {scan.reason ? scan.reason : meta.label} · {formatTime(scan.scannedAt)}
                    </p>
                  </div>

                  <Badge status={meta.badge}>{meta.label}</Badge>
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
    <div className={`rounded-2xl px-3 py-3 text-center ring-1 ${className}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-extrabold leading-none sm:text-3xl">
        {loading ? <Spinner size="sm" /> : value}
      </p>
    </div>
  )
}

/**
 * Pantalla de resultado a página completa. Se lee de un vistazo desde lejos y en la calle:
 * verde = pasa, azul = salió, rojo = no pasa.
 */
function ScanResultScreen({ result, config, onNext, onClose }) {
  const { action, ticket, message, ok } = result

  const isCheckIn = action === SCAN_ACTION.CHECK_IN
  const isCheckOut = action === SCAN_ACTION.CHECK_OUT

  const theme = isCheckIn
    ? { bg: 'bg-emerald-600', Icon: CheckCircle2, title: 'ENTRADA' }
    : isCheckOut
      ? { bg: 'bg-belen-blue', Icon: LogOut, title: 'SALIDA' }
      : { bg: 'bg-red-600', Icon: XCircle, title: 'RECHAZADO' }

  const { Icon } = theme
  const holderType = ticket?.holderType ? HOLDER_TYPE_LABEL[ticket.holderType] : null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={theme.title}
      className={`fixed inset-0 z-[60] flex flex-col overflow-y-auto text-white ${theme.bg}`}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8">
        <div className="flex flex-col items-center text-center">
          <Icon className="h-28 w-28 sm:h-32 sm:w-32" strokeWidth={2.25} aria-hidden="true" />
          <h2 className="mt-3 font-display text-4xl font-extrabold uppercase tracking-tight sm:text-5xl">
            {theme.title}
          </h2>

          {ticket?.holderName && (
            <p className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">{ticket.holderName}</p>
          )}

          {holderType && (
            <span className="mt-2 rounded-full bg-white/20 px-3 py-1 text-sm font-bold uppercase tracking-wide">
              {holderType}
            </span>
          )}
        </div>

        {!ok && message && (
          <p className="mt-5 rounded-2xl bg-white/15 px-4 py-3 text-center text-base font-semibold leading-snug">
            {message}
          </p>
        )}

        {ticket ? (
          <dl className="mt-5 space-y-px overflow-hidden rounded-2xl bg-white/10 text-sm">
            <ResultRow label="Empresa" value={ticket.companyName} />
            <ResultRow label="Código de cliente" value={ticket.clientCode} />
            <ResultRow label="Agente" value={ticket.agentName} />
            <ResultRow label="Serial" value={ticket.serial} mono />
            <ResultRow
              label="Cita"
              value={
                ticket.day || ticket.hour
                  ? `${dayLabel(config, ticket.day)} · ${formatHourRange(ticket.hour)}`
                  : null
              }
            />
            {!ok && <ResultRow label="Entró" value={formatTime(ticket.checkInAt)} />}
            {!ok && <ResultRow label="Salió" value={formatTime(ticket.checkOutAt)} />}
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
