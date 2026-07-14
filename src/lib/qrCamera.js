import { Html5Qrcode } from 'html5-qrcode'

/**
 * Utilidades compartidas por los dos módulos que usan la cámara:
 *   · /admin/scanner → Entrada / Salida
 *   · /admin/food    → Comida
 *
 * Aquí vive la parte delicada (cámara trasera, recuadro de puntería, bip y vibración) para no
 * duplicarla en cada página.
 */

/* ------------------------------------------------------------------ */
/* Cámara                                                              */
/* ------------------------------------------------------------------ */

/**
 * Arranca la cámara priorizando SIEMPRE la trasera (principal) en móviles, que es la cómoda para
 * escanear QR. Cascada de estrategias, de la más estricta a la más tolerante, porque no todos los
 * navegadores respetan igual la restricción facingMode:
 *   1) exact:'environment' → OBLIGA a la trasera (falla si el equipo no la tiene).
 *   2) 'environment'       → preferencia no estricta (respaldo).
 *   3) enumerar cámaras    → elegir explícitamente la trasera por su etiqueta.
 */
export async function startRearCamera(scanner, scanConfig, onDecode, onError) {
  const constraints = [{ facingMode: { exact: 'environment' } }, { facingMode: 'environment' }]

  for (const source of constraints) {
    try {
      await scanner.start(source, scanConfig, onDecode, onError)
      return
    } catch (err) {
      // OverconstrainedError/NotFoundError: sin trasera (p. ej. una laptop). Probamos la siguiente.
      console.warn(
        '[qrCamera] facingMode no disponible, probando siguiente estrategia:',
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

/** Recuadro de puntería proporcional al ancho del visor (móvil en vertical incluido). */
export function qrboxFromViewfinder(viewfinderWidth, viewfinderHeight) {
  const smallestSide = Math.min(viewfinderWidth || 0, viewfinderHeight || 0)
  const size = Math.max(160, Math.floor(smallestSide * 0.72))
  return { width: size, height: size }
}

/* ------------------------------------------------------------------ */
/* Realimentación física: vibración + bip generado con la Web Audio API */
/* ------------------------------------------------------------------ */

let audioContext = null

/** El AudioContext se crea perezosamente: los navegadores solo lo permiten tras un gesto. */
export function getAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioCtor) return null

  if (!audioContext) audioContext = new AudioCtor()
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {})
  }
  return audioContext
}

/** Bip corto: agudo y breve si el escaneo fue válido, grave y largo si se rechazó. */
export function beep(success) {
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
export function vibrate(success) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(success ? 100 : [100, 50, 100])
  } catch {
    // Algunos navegadores de escritorio exponen vibrate() y lanzan al usarlo. No es crítico.
  }
}
