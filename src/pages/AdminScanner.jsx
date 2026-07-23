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
  MessageCircle,
  RotateCcw,
  ScanLine,
  XCircle,
} from 'lucide-react'

import { useAuth } from '../hooks/useAuth'
import { useAgents } from '../hooks/useAgents'
import { useConfig } from '../hooks/useConfig'
import { peekScanAction, processScan, subscribeScans } from '../services/scanService'
import { subscribeTickets } from '../services/ticketsService'
import {
  HOLDER_TYPE_LABEL,
  SCAN_ACTION,
  TICKET_STATUS,
  formatSerial,
} from '../lib/constants'
import {
  dayLabel,
  formatHourRange,
  formatISODate,
  formatTime,
  todayISODate,
} from '../lib/format'
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

/** Id del contenedor donde html5-qrcode inyecta el vídeo de la cámara. */
const READER_ID = 'qr-reader'

/** Cuántos escaneos de la bitácora se pintan bajo el escáner. */
const LOG_VISIBLE = 12

/** Cómo se presenta cada acción en la bitácora y en la pantalla de resultado. */
const ACTION_META = {
  [SCAN_ACTION.CHECK_IN]: { label: 'Entrada', badge: 'inside', Icon: LogIn },
  [SCAN_ACTION.CHECK_OUT]: { label: 'Salida', badge: 'exited', Icon: LogOut },
  [SCAN_ACTION.REJECTED]: { label: 'Rechazado', badge: 'rejected', Icon: XCircle },
}

/** Prefijo internacional de Costa Rica: todos los agentes tienen número +506. */
const CR_DIAL_CODE = '506'

/**
 * Arma el enlace de WhatsApp con el mensaje ya escrito para avisarle al agente que su cliente
 * acaba de entrar. Devuelve null si el agente no tiene número registrado.
 *
 * El enlace se abre en una pestaña NUEVA: así, cuando el guarda vuelve al navegador después de
 * pulsar «Enviar» en WhatsApp, se encuentra el escáner exactamente como lo dejó.
 */
function buildWhatsappNoticeUrl({ agent, ticket, config }) {
  const digits = String(agent?.whatsapp || '').replace(/\D/g, '')
  if (!digits) return null

  // Si el número ya trae el 506, no lo duplicamos.
  const phone = digits.startsWith(CR_DIAL_CODE) ? digits : `${CR_DIAL_CODE}${digits}`

  const eventName = [config?.eventName, config?.eventYear].filter(Boolean).join(' ') || 'el evento'
  const company = ticket.companyName ? ` de ${ticket.companyName}` : ''
  const code = ticket.clientCode ? ` (código ${ticket.clientCode})` : ''
  const kind = HOLDER_TYPE_LABEL[ticket.holderType] || ''

  const message = [
    `Hola ${agent?.name || ''}`.trim() + ',',
    '',
    `Tu cliente ${ticket.holderName}${company}${code} acaba de ingresar a ${eventName}.`,
    `Entrada: ${ticket.serial}${kind ? ` · ${kind}` : ''}`,
  ].join('\n')

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function AdminScanner() {
  const { user } = useAuth()
  const { config } = useConfig()
  const { agents } = useAgents()
  const toast = useToast()

  const [cameraActive, setCameraActive] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const [result, setResult] = useState(null)
  const [processing, setProcessing] = useState(false)
  // Salida pendiente de confirmar: { token, ticket }. Se registra solo si el guarda confirma.
  const [pendingCheckout, setPendingCheckout] = useState(null)

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

  /* --- Agente del ticket recién escaneado (para avisarle por WhatsApp) --- */
  const resultAgent = useMemo(() => {
    const agentId = result?.ticket?.agentId
    if (!agentId) return null
    return agents.find((a) => a.id === agentId) || null
  }, [agents, result])

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

  /** Pausa el vídeo (sin apagar la cámara) para no disparar el mismo QR decenas de veces. */
  const pauseScanner = useCallback(() => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      if (scanner.getState() === Html5QrcodeScannerState.SCANNING) scanner.pause(true)
    } catch (error) {
      console.warn('[AdminScanner] No se pudo pausar el lector:', error?.message || error)
    }
  }, [])

  /** Reanuda el vídeo pausado. */
  const resumeScanner = useCallback(() => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      if (scanner.getState() === Html5QrcodeScannerState.PAUSED) scanner.resume()
    } catch (error) {
      console.warn('[AdminScanner] No se pudo reanudar el lector:', error?.message || error)
    }
  }, [])

  /** Registra de verdad el escaneo (transacción) y pinta la pantalla de resultado. */
  const runScan = useCallback(
    async (token) => {
      setProcessing(true)
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
        if (aliveRef.current) setProcessing(false)
      }
    },
    [user?.uid],
  )

  /* --- Resolución de un token ---
   * Antes de registrar, hacemos una lectura previa (peek): si el escaneo fuese una SALIDA, no la
   * registramos de una vez, sino que pedimos confirmación (evita marcar salidas por descuido).
   * Para entrada, rechazo o si el peek falla, se registra directo como antes. */
  const handleToken = useCallback(
    async (rawToken) => {
      const token = String(rawToken ?? '').trim()
      if (!token || busyRef.current) return null

      busyRef.current = true
      pauseScanner()

      try {
        const preview = await peekScanAction(token)
        if (!aliveRef.current) return null

        if (preview.wouldBe === 'check_out' && preview.ticket) {
          // Salida: mostramos la confirmación y esperamos al guarda (la cámara sigue en pausa).
          setPendingCheckout({ token, ticket: preview.ticket })
          return null
        }

        return await runScan(token)
      } finally {
        busyRef.current = false
      }
    },
    [pauseScanner, runScan],
  )

  /** El guarda confirmó la salida: ahora sí la registramos. */
  const confirmCheckout = useCallback(async () => {
    const pending = pendingCheckout
    if (!pending) return
    setPendingCheckout(null)
    await runScan(pending.token)
  }, [pendingCheckout, runScan])

  /** El guarda canceló la salida: descartamos y volvemos a escanear. */
  const cancelCheckout = useCallback(() => {
    setPendingCheckout(null)
    resumeScanner()
  }, [resumeScanner])

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
      setSerialInput('')
      try {
        await handleToken(ticket.qrToken)
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
        <ScanResultScreen
          result={result}
          config={config}
          agent={resultAgent}
          onNext={scanNext}
          onClose={stopCamera}
        />
      )}

      {pendingCheckout && !result && (
        <CheckoutConfirmScreen
          ticket={pendingCheckout.ticket}
          processing={processing}
          onConfirm={confirmCheckout}
          onCancel={cancelCheckout}
        />
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
    <div className={`rounded-2xl px-2 py-3 text-center ring-1 sm:px-3 ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80 sm:text-[11px] sm:tracking-wider">
        {label}
      </p>
      <p className="mt-0.5 font-display text-2xl font-extrabold leading-none sm:text-3xl">
        {loading ? <Spinner size="sm" /> : value}
      </p>
    </div>
  )
}

/**
 * Confirmación de SALIDA a página completa. Registrar una salida es prácticamente irreversible
 * (inutiliza el QR), así que antes de hacerlo pedimos al guarda que confirme.
 */
function CheckoutConfirmScreen({ ticket, processing, onConfirm, onCancel }) {
  const holderType = ticket?.holderType ? HOLDER_TYPE_LABEL[ticket.holderType] : null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Confirmar salida"
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-belen-blue text-white"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8 sm:px-6 lg:max-w-xl">
        <div className="flex flex-col items-center text-center">
          <LogOut className="h-24 w-24 sm:h-28 sm:w-28" strokeWidth={2.25} aria-hidden="true" />
          <p className="mt-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">
            ¿Registrar salida?
          </p>
          {ticket?.holderName && (
            <h2 className="mt-2 font-display text-3xl font-extrabold uppercase leading-tight sm:text-4xl">
              {ticket.holderName}
            </h2>
          )}
          {holderType && (
            <span className="mt-2 rounded-full bg-white/20 px-3 py-1 text-sm font-bold uppercase tracking-wide">
              {holderType}
            </span>
          )}
        </div>

        <dl className="mt-5 space-y-px overflow-hidden rounded-2xl bg-white/10 text-sm">
          <ResultRow label="Empresa" value={ticket?.companyName} />
          <ResultRow label="Código de cliente" value={ticket?.clientCode} />
          <ResultRow label="Serial" value={ticket?.serial} mono />
          <ResultRow label="Hora de ingreso" value={formatTime(ticket?.checkInAt)} />
        </dl>

        <p className="mt-4 text-center text-sm font-medium text-white/80">
          Después de registrar la salida, este QR ya no podrá volver a usarse.
        </p>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={processing}
            autoFocus
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-extrabold uppercase tracking-wide text-belen-blue shadow-card transition-transform active:scale-[0.98] disabled:opacity-70"
          >
            {processing ? (
              <Spinner size="sm" />
            ) : (
              <>
                <LogOut className="h-5 w-5" aria-hidden="true" />
                Sí, registrar salida
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-semibold text-white transition-colors hover:bg-white/25 disabled:opacity-70"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Pantalla de resultado a página completa. Se lee de un vistazo desde lejos y en la calle:
 * verde = pasa, azul = salió, rojo = no pasa.
 */
function ScanResultScreen({ result, config, agent, onNext, onClose }) {
  const { action, ticket, message, ok } = result

  const isCheckIn = action === SCAN_ACTION.CHECK_IN
  const isCheckOut = action === SCAN_ACTION.CHECK_OUT

  // Solo al registrar la ENTRADA se le avisa al agente que su cliente ya llegó.
  const whatsappUrl =
    isCheckIn && ticket ? buildWhatsappNoticeUrl({ agent, ticket, config }) : null

  // Alerta (no bloqueo): la invitación es para un día distinto al de hoy. Solo aplica al ENTRAR.
  const wrongDay = isCheckIn && ticket?.day && ticket.day !== todayISODate()

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
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8 sm:px-6 lg:max-w-xl">
        <div className="flex flex-col items-center text-center">
          <Icon className="h-28 w-28 sm:h-32 sm:w-32 lg:h-40 lg:w-40" strokeWidth={2.25} aria-hidden="true" />
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

        {/* ALERTA (no bloqueo): la invitación es para otro día. La entrada YA quedó registrada,
            pero avisamos fuerte para que el guarda decida qué hacer. */}
        {wrongDay && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-amber-400 px-4 py-3 text-left text-amber-950 shadow-lg ring-2 ring-amber-200">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-extrabold uppercase tracking-wide">Atención: otro día</p>
              <p className="text-sm font-semibold leading-snug">
                Esta invitación es para el <strong>{dayLabel(config, ticket.day)}</strong>, pero hoy
                es <strong>{formatISODate(todayISODate())}</strong>.
              </p>
            </div>
          </div>
        )}

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
            {/* Horas: en ENTRADA basta la de ingreso; en SALIDA se muestran ambas para que el
                guarda vea de un vistazo cuánto estuvo dentro. En un rechazo, también ambas. */}
            {(isCheckIn || isCheckOut || !ok) && (
              <ResultRow label="Hora de ingreso" value={formatTime(ticket.checkInAt)} />
            )}
            {(isCheckOut || !ok) && (
              <ResultRow label="Hora de salida" value={formatTime(ticket.checkOutAt)} />
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

          {/* Aviso al agente por WhatsApp (solo en ENTRADA). Se abre en una pestaña nueva:
              el guarda pulsa «Enviar» en WhatsApp y al volver al navegador encuentra el
              escáner tal como lo dejó. */}
          {isCheckIn && whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-base font-extrabold uppercase tracking-wide text-white shadow-card transition-transform active:scale-[0.98]"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              Notificar por WhatsApp
            </a>
          )}

          {isCheckIn && !whatsappUrl && ticket && (
            <p className="text-center text-xs font-medium text-white/70">
              {agent?.name || 'El agente'} no tiene un WhatsApp registrado. Agrégalo en
              «Agentes» para poder avisarle.
            </p>
          )}
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
