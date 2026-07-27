import { useEffect, useState } from 'react'
import Logo from './Logo'
import { HOLDER_TYPE_LABEL } from '../lib/constants'
import { generateQrDataUrl } from '../services/ticketsService'

/**
 * Gafete imprimible del Día del Cliente 2026.
 *
 * Tamaño físico EXACTO: 5.5 cm de ancho × 8.5 cm de alto (formato gafete vertical). Reproduce el
 * diseño de la invitación: isotipo + «DÍA DEL CLIENTE 2026» arriba, el QR y el nombre de la persona
 * en el recuadro central, y el logo «EMPAQUES belén» abajo, con el detalle naranja en la esquina.
 *
 * Genera el QR internamente a partir de `ticket.qrToken` (igual que TicketPreview), así el gafete
 * es autónomo: quien lo use solo pasa la entrada.
 *
 * @param {object} props
 * @param {object} props.ticket  entrada (holderName, serial, holderType, qrToken)
 */
export default function GafetePreview({ ticket }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const qrToken = ticket?.qrToken || ''

  useEffect(() => {
    let active = true
    if (!qrToken) {
      setQrDataUrl('')
      return undefined
    }
    generateQrDataUrl(qrToken)
      .then((url) => {
        if (active) setQrDataUrl(url)
      })
      .catch(() => {
        if (active) setQrDataUrl('')
      })
    return () => {
      active = false
    }
  }, [qrToken])

  const holderType = ticket?.holderType ? HOLDER_TYPE_LABEL[ticket.holderType] : ''

  return (
    <div
      className="gafete relative flex flex-col overflow-hidden rounded-2xl border-2 border-belen-blue bg-white"
      style={{ width: '5.5cm', height: '8.5cm', padding: '0.35cm' }}
    >
      {/* Detalle naranja en la esquina inferior izquierda (decorativo, como en la invitación) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 bg-belen-orange"
        style={{ width: '1.4cm', height: '1.1cm', borderTopRightRadius: '100%' }}
      />

      {/* Cabecera: DÍA DEL CLIENTE 2026 + lema */}
      <div className="relative flex justify-center pt-1">
        <Logo variant="full" className="h-auto w-[3.4cm]" />
      </div>

      {/* Recuadro central: QR + nombre */}
      <div className="relative mt-1 flex flex-1 items-center justify-center">
        <div className="flex w-full flex-col items-center rounded-xl border-2 border-belen-blue px-1.5 py-1.5">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Código QR de ${ticket?.holderName || 'la entrada'}`}
              style={{ width: '2.5cm', height: '2.5cm' }}
              className="block"
            />
          ) : (
            <div
              style={{ width: '2.5cm', height: '2.5cm' }}
              className="flex items-center justify-center bg-slate-100 text-[6px] text-slate-400"
            >
              QR
            </div>
          )}

          <p className="mt-1 w-full truncate text-center text-[10px] font-extrabold uppercase leading-tight text-belen-blue">
            {ticket?.holderName || '—'}
          </p>
          {holderType && (
            <p className="text-center text-[7px] font-semibold uppercase tracking-wide text-belen-orange">
              {holderType}
            </p>
          )}
        </div>
      </div>

      {/* Pie: serial + logo EMPAQUES belén */}
      <div className="relative mt-1 flex flex-col items-center gap-0.5">
        {ticket?.serial && (
          <p className="text-[7px] font-bold uppercase tracking-wider text-belen-blue/70">
            Nº {ticket.serial}
          </p>
        )}
        <Logo variant="compact" className="h-auto w-[2.9cm]" />
      </div>
    </div>
  )
}
