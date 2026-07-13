import { useId } from 'react'

/**
 * Marca de Empaques Belén — Día del Cliente 2026.
 * Todo es SVG en línea: no hay imágenes externas, así que se ve nítido a 32px y a 300px.
 *
 * variant:
 *   'full'    → isotipo + DÍA DEL CLIENTE + 2026 + lema
 *   'mark'    → solo el isotipo (dos eslabones hexagonales entrelazados)
 *   'compact' → isotipo + "EMPAQUES belén" en una línea
 */
const BLUE = '#1B3B8B'
const ORANGE = '#F26A21'
const FONT = "Poppins, 'Segoe UI', system-ui, sans-serif"

// Geometría del isotipo: dos anillos hexagonales que se cruzan.
const RADIUS = 24
const STROKE = 9
const CENTER_Y = 32
const BLUE_CX = 30
const ORANGE_CX = 62

/** Hexágono cerrado (vértices cada 60°, con puntas a izquierda y derecha). */
function hexagonPath(cx, cy, radius) {
  const points = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i)
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `M${points.join('L')}Z`
}

const BLUE_HEX = hexagonPath(BLUE_CX, CENTER_Y, RADIUS)
const ORANGE_HEX = hexagonPath(ORANGE_CX, CENTER_Y, RADIUS)

/**
 * El isotipo, en su propio sistema de coordenadas (92 x 64).
 * El entrelazado se consigue repintando el eslabón azul recortado a la mitad superior:
 * arriba el azul pasa por encima del naranja, abajo el naranja pasa por encima del azul.
 */
function MarkPaths({ clipId }) {
  const hexProps = {
    fill: 'none',
    strokeWidth: STROKE,
    strokeLinejoin: 'round',
  }

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x="-4" y="-4" width="100" height={CENTER_Y + 4} />
        </clipPath>
      </defs>

      {/* 1. Eslabón azul */}
      <path d={BLUE_HEX} stroke={BLUE} {...hexProps} />
      {/* 2. Eslabón naranja: queda encima del azul en todo el cruce */}
      <path d={ORANGE_HEX} stroke={ORANGE} {...hexProps} />
      {/* 3. Azul otra vez, solo en la mitad de arriba: cierra el entrelazado */}
      <path d={BLUE_HEX} stroke={BLUE} clipPath={`url(#${clipId})`} {...hexProps} />
    </>
  )
}

export default function Logo({ variant = 'full', className = '', ...rest }) {
  const rawId = useId()
  // useId() trae ':' y eso rompe las referencias url(#...) en algunos navegadores.
  const clipId = `belen-mark-${rawId.replace(/:/g, '')}`

  if (variant === 'mark') {
    return (
      <svg
        viewBox="0 0 92 64"
        className={className}
        role="img"
        aria-label="Empaques Belén"
        {...rest}
      >
        <title>Empaques Belén</title>
        <MarkPaths clipId={clipId} />
      </svg>
    )
  }

  if (variant === 'compact') {
    return (
      <svg
        viewBox="0 0 320 64"
        className={className}
        role="img"
        aria-label="Empaques Belén"
        {...rest}
      >
        <title>Empaques Belén</title>

        <g transform="translate(0, 7) scale(0.78)">
          <MarkPaths clipId={clipId} />
        </g>

        <text x="82" y="41" fontFamily={FONT} fontSize="25" fill={BLUE}>
          <tspan fontWeight="700" letterSpacing="0.5">
            EMPAQUES
          </tspan>
          <tspan fontWeight="400" dx="7">
            belén
          </tspan>
        </text>
      </svg>
    )
  }

  // variant === 'full'
  return (
    <svg
      viewBox="0 0 320 246"
      className={className}
      role="img"
      aria-label="Día del Cliente 2026 — Empaques Belén"
      {...rest}
    >
      <title>Día del Cliente 2026 — Empaques Belén</title>

      <g transform="translate(114, 4)">
        <MarkPaths clipId={clipId} />
      </g>

      <text
        x="160"
        y="104"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="32"
        fontWeight="800"
        letterSpacing="3"
        fill={BLUE}
      >
        DÍA DEL
      </text>

      <text
        x="160"
        y="147"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="44"
        fontWeight="800"
        letterSpacing="4"
        fill={ORANGE}
      >
        CLIENTE
      </text>

      <text
        x="160"
        y="183"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="26"
        fontWeight="700"
        letterSpacing="8"
        fill={BLUE}
      >
        2026
      </text>

      {/* Franja divisoria naranja con el rombo central de la invitación */}
      <line x1="86" y1="205" x2="150" y2="205" stroke={ORANGE} strokeWidth="2" opacity="0.65" />
      <rect
        x="155.5"
        y="200.5"
        width="9"
        height="9"
        fill={ORANGE}
        transform="rotate(45 160 205)"
      />
      <line x1="170" y1="205" x2="234" y2="205" stroke={ORANGE} strokeWidth="2" opacity="0.65" />

      <text
        x="160"
        y="233"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="16"
        fontStyle="italic"
        fontWeight="500"
        fill={BLUE}
      >
        Conexiones que impulsan
      </text>
    </svg>
  )
}
