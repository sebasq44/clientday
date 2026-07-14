import confetti from 'canvas-confetti'

/** Colores de la marca: azul y naranja Belén, con blanco y dorado para dar chispa. */
const BRAND_COLORS = ['#1B3B8B', '#F26A21', '#ffffff', '#2f52ad', '#ff8a4c']

/** ¿El usuario pidió al sistema menos movimiento? Entonces no lanzamos nada. */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Celebración al confirmar la reserva: dos ráfagas laterales que se cruzan y una lluvia
 * final más suave. Los colores son los de la invitación oficial.
 *
 * El canvas se dibuja por encima de todo (zIndex alto) y `disableForReducedMotion` deja
 * fuera a quien pidió menos animación.
 */
export function celebrateReservation() {
  if (prefersReducedMotion()) return

  const base = {
    disableForReducedMotion: true,
    colors: BRAND_COLORS,
    zIndex: 60,
    scalar: 0.95,
  }

  // 1) Estallido central inmediato.
  confetti({
    ...base,
    particleCount: 90,
    spread: 78,
    startVelocity: 42,
    origin: { x: 0.5, y: 0.55 },
  })

  // 2) Dos chorros laterales que se cruzan (dan sensación de "cañones" del escenario).
  setTimeout(() => {
    confetti({
      ...base,
      particleCount: 55,
      angle: 60,
      spread: 62,
      startVelocity: 48,
      origin: { x: 0, y: 0.68 },
    })
    confetti({
      ...base,
      particleCount: 55,
      angle: 120,
      spread: 62,
      startVelocity: 48,
      origin: { x: 1, y: 0.68 },
    })
  }, 160)

  // 3) Lluvia final, lenta y ancha: deja el momento "asentado".
  setTimeout(() => {
    confetti({
      ...base,
      particleCount: 70,
      spread: 120,
      startVelocity: 26,
      gravity: 0.65,
      decay: 0.92,
      origin: { x: 0.5, y: 0.35 },
    })
  }, 420)
}
