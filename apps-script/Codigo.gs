/**
 * ============================================================================
 *  DÍA DEL CLIENTE 2026 — EMPAQUES BELÉN
 *  Web App de Google Apps Script que envía por correo las entradas con su QR.
 * ============================================================================
 *
 *  CÓMO DESPLEGARLO (pasos exactos)
 *  --------------------------------
 *  1. Entra a https://script.google.com con la cuenta de Gmail / Google Workspace
 *     DESDE LA QUE quieres que salgan los correos (el remitente será esa cuenta).
 *  2. Crea un proyecto nuevo: «Proyecto nuevo». Ponle de nombre, por ejemplo,
 *     «Día del Cliente 2026 — Correos».
 *  3. Borra el contenido de Codigo.gs y pega ESTE archivo completo.
 *  4. Crea un segundo archivo: botón «+» junto a «Archivos» > «HTML». Llámalo
 *     exactamente  plantilla-email  (Apps Script le añade solo la extensión .html).
 *     Pega dentro el contenido de apps-script/plantilla-email.html.
 *     OJO: el nombre debe ser EXACTAMENTE ese, porque el código lo carga con
 *     HtmlService.createTemplateFromFile('plantilla-email').
 *  5. Guarda (Ctrl+S).
 *  6. Pulsa «Implementar» > «Nueva implementación».
 *       - Icono del engranaje > tipo: «Aplicación web».
 *       - Descripción: la que quieras (ej. «v1 correos entradas»).
 *       - Ejecutar como: «Yo» (tu cuenta).
 *       - Quién tiene acceso: «Cualquier usuario, incluso anónimo».
 *       - «Implementar».
 *  7. Google pedirá autorización: «Autorizar acceso» > elige tu cuenta >
 *     «Configuración avanzada» > «Ir a <nombre del proyecto> (no seguro)» >
 *     «Permitir». Es tu propio script: es normal que salga ese aviso.
 *  8. Copia la «URL de la aplicación web» que te da al final. Termina en /exec.
 *  9. Pega esa URL en la constante APPS_SCRIPT_URL de  src/lib/firebase.js :
 *
 *        export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec'
 *
 * 10. Comprueba que funciona: abre esa URL en el navegador. Debe responder un JSON
 *     de salud  { "ok": true, "service": "...", "status": "activo" }.
 *
 *  IMPORTANTE: cada vez que edites este script debes hacer «Implementar» >
 *  «Gestionar implementaciones» > editar (lápiz) > Versión: «Nueva versión» >
 *  «Implementar», o los cambios NO se aplicarán a la URL ya publicada.
 *
 *  NOTA SOBRE CORS: el panel manda el POST con Content-Type 'text/plain;charset=utf-8'
 *  a propósito. Así el navegador lo trata como «simple request» y no lanza el preflight
 *  OPTIONS, que Apps Script no responde. El cuerpo sigue siendo JSON y aquí se parsea
 *  con JSON.parse(e.postData.contents).
 *
 *  LÍMITES DE GMAIL: 100 destinatarios/día en cuentas @gmail.com gratuitas y 1.500/día
 *  en Google Workspace. Si se supera, GmailApp lanza una excepción y este script
 *  devuelve { ok:false, error:'...' }; el panel deja la reserva en «Falló» y permite
 *  reintentar el envío más tarde.
 */

/** Debe coincidir con APPS_SCRIPT_SECRET de src/lib/firebase.js */
const SHARED_SECRET = 'belen-dia-del-cliente-2026';

const SENDER_NAME = 'Empaques Belén';
const SUBJECT = 'Tu entrada · Día del Cliente 2026 — Empaques Belén';
const EVENT_HOURS = '9:00am 4:00pm';
const TAGLINE = 'Conexiones que impulsan';

const HOLDER_TYPE_LABEL = {
  titular: 'Titular',
  acompanante: 'Acompañante',
};

/** Respuesta JSON estándar del Web App. */
function jsonOutput(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** GET → chequeo de salud. Sirve para comprobar que la URL está viva. */
function doGet(e) {
  return jsonOutput({
    ok: true,
    service: 'Día del Cliente 2026 — Empaques Belén (envío de entradas)',
    status: 'activo',
    time: new Date().toISOString(),
  });
}

/** '10:00' → '10:00 — 11:00' (cada cita dura una hora). */
function buildHourRange(hour) {
  const raw = String(hour || '').trim();
  const parts = raw.split(':');
  if (parts.length !== 2) return raw;

  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return raw;

  const pad = function (n) {
    return n < 10 ? '0' + n : String(n);
  };
  return pad(h) + ':' + pad(m) + ' — ' + pad((h + 1) % 24) + ':' + pad(m);
}

/** Versión en texto plano del correo (para clientes que no muestran HTML). */
function buildPlainText(reservation, tickets, hourRange) {
  const lines = [];
  lines.push('DÍA DEL CLIENTE 2026 — EMPAQUES BELÉN');
  lines.push(TAGLINE);
  lines.push('');
  lines.push('Hola ' + reservation.fullName + ',');
  lines.push('');
  lines.push('Tu reserva quedó confirmada. Estos son los datos de tu cita:');
  lines.push('');
  lines.push('  Empresa:  ' + reservation.companyName);
  lines.push('  Código de cliente:  ' + reservation.clientCode);
  lines.push('  Agente de ventas:  ' + reservation.agentName);
  lines.push('  Día:  ' + reservation.dayLabel + ' (' + reservation.dayLetter + ')');
  lines.push('  Hora de tu cita:  ' + hourRange);
  lines.push('  Horario del evento:  ' + EVENT_HOURS);
  lines.push('');

  if (reservation.masterclass) {
    lines.push('Además, quedaste inscrito en la Masterclass. ¡Te esperamos!');
    lines.push('');
  }

  lines.push(tickets.length === 1 ? 'TU ENTRADA:' : 'TUS ENTRADAS:');
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    lines.push('  · ' + t.serial + ' — ' + t.holderName + ' (' + t.holderTypeLabel + ')');
  }
  lines.push('');
  lines.push(
    'El código QR de cada entrada va incrustado en la versión HTML de este correo y ' +
      'también adjunto como imagen PNG. Preséntalo en la entrada del evento (impreso o ' +
      'desde el teléfono). Cada entrada es válida por 1 día único.'
  );
  lines.push('');
  lines.push('¡Nos vemos!');
  lines.push('Empaques Belén');

  return lines.join('\n');
}

/**
 * POST → recibe el cuerpo del §11 del contrato y envía el correo con las entradas.
 *
 * Entrada:
 *   { secret, to, reservation: { fullName, companyName, clientCode, agentName,
 *                                dayLabel, dayLetter, hour, masterclass },
 *     tickets: [ { serial, holderName, holderType, qrPng } ] }
 *   qrPng = PNG del QR en base64 CRUDO (sin el prefijo 'data:image/png;base64,').
 *
 * Salida:  { ok: true, sent: N }   |   { ok: false, error: 'mensaje' }
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Petición vacía: no se recibió ningún cuerpo JSON.');
    }

    const body = JSON.parse(e.postData.contents);

    // 1. Autorización por secreto compartido.
    if (!body || body.secret !== SHARED_SECRET) {
      return jsonOutput({ ok: false, error: 'No autorizado' });
    }

    // 2. Validación de la carga.
    const to = String(body.to || '').trim();
    if (!to) throw new Error('Falta el correo del destinatario.');

    const reservationIn = body.reservation || {};
    const reservation = {
      fullName: String(reservationIn.fullName || ''),
      companyName: String(reservationIn.companyName || ''),
      clientCode: String(reservationIn.clientCode || ''),
      agentName: String(reservationIn.agentName || ''),
      dayLabel: String(reservationIn.dayLabel || ''),
      dayLetter: String(reservationIn.dayLetter || ''),
      hour: String(reservationIn.hour || ''),
      masterclass: reservationIn.masterclass === true,
    };

    const rawTickets = body.tickets;
    if (!rawTickets || !rawTickets.length) {
      throw new Error('No se recibió ninguna entrada para enviar.');
    }

    // 3. Cada QR se decodifica a un blob PNG: va INLINE (cid) y TAMBIÉN como adjunto suelto,
    //    para que el cliente pueda guardarlo en el teléfono.
    const inlineImages = {};
    const attachments = [];
    const tickets = [];

    for (let i = 0; i < rawTickets.length; i++) {
      const raw = rawTickets[i];
      const serial = String(raw.serial || '').trim();
      if (!serial) throw new Error('Una de las entradas llegó sin número de serie.');

      const qrPng = String(raw.qrPng || '').trim();
      if (!qrPng) throw new Error('La entrada ' + serial + ' llegó sin su código QR.');

      const bytes = Utilities.base64Decode(qrPng);
      const blob = Utilities.newBlob(bytes, 'image/png', 'qr-' + serial + '.png').setName(
        'qr-' + serial + '.png'
      );

      const cid = 'qr_' + serial;
      inlineImages[cid] = blob;
      // copyBlob(): el adjunto no debe compartir el blob que ya usa inlineImages.
      attachments.push(blob.copyBlob().setName('entrada-' + serial + '.png'));

      const holderType = String(raw.holderType || '');
      tickets.push({
        serial: serial,
        holderName: String(raw.holderName || ''),
        holderType: holderType,
        holderTypeLabel: HOLDER_TYPE_LABEL[holderType] || 'Titular',
        cid: cid,
      });
    }

    // 4. HTML del correo a partir de la plantilla.
    const hourRange = buildHourRange(reservation.hour);
    const template = HtmlService.createTemplateFromFile('plantilla-email');
    template.reservation = reservation;
    template.tickets = tickets;
    template.hourRange = hourRange;
    template.eventHours = EVENT_HOURS;
    template.tagline = TAGLINE;

    const htmlBody = template.evaluate().getContent();
    const plainBody = buildPlainText(reservation, tickets, hourRange);

    // 5. Envío.
    GmailApp.sendEmail(to, SUBJECT, plainBody, {
      htmlBody: htmlBody,
      inlineImages: inlineImages,
      attachments: attachments,
      name: SENDER_NAME,
    });

    return jsonOutput({ ok: true, sent: tickets.length });
  } catch (err) {
    return jsonOutput({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}
