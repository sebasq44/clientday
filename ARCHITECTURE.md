# Día del Cliente 2026 — Empaques Belén

**Contexto general de la aplicación. Este documento es el CONTRATO. Cualquier agente que escriba
código DEBE leerlo completo y respetarlo al pie de la letra. No inventes nombres de campos, rutas
ni props: si algo no está aquí, sigue la convención más cercana y déjalo anotado.**

---

## 1. Qué es

Evento anual de Empaques Belén. Cada cliente reserva una cita acompañado **obligatoriamente** de un
agente de ventas de la empresa. La app tiene dos caras:

- **Formulario público** (`/`): el cliente reserva. Sale con estado `pending`.
- **Panel admin** (`/admin/*`): se revisan solicitudes, se aprueban/rechazan, se administran
  parámetros (días, horas, agentes), se emiten entradas con QR, se envían por correo y se escanean
  en la puerta el día del evento.

**Regla de negocio nuclear:** un agente de ventas no puede tener dos clientes en el mismo
`(día, hora)`. Al **aprobar** una reserva, ese slot queda bloqueado de forma atómica. La reserva
solo bloquea al aprobarse, no al enviarse.

## 2. Stack

- React 18 + Vite 6 + React Router 6
- Tailwind CSS 3 (paleta `belen.*` ya definida en `tailwind.config.js`)
- Firebase v11 (Firestore + Auth email/contraseña)
- `qrcode` → genera el PNG del QR como dataURL en el cliente
- `html5-qrcode` → lector de QR con la cámara en el panel admin
- `lucide-react` → iconos
- Google Apps Script (Web App) → envía los correos con las entradas

## 3. Identidad visual (obligatoria, sale de la invitación oficial)

| Token | Valor | Uso |
|---|---|---|
| `belen-blue` | `#1B3B8B` | Titulares, marca, bordes de tarjeta |
| `belen-orange` | `#F26A21` | Acentos, CTA, línea divisoria, iconos |
| `belen-cream` | `#FBF9F6` | Fondo de página |

Tipografía: **Poppins** (ya cargada en `index.html`). Titulares en `font-extrabold uppercase`.
El lema del evento es **"Conexiones que impulsan"**. Estética: limpia, blanca, mucho aire, bordes
redondeados generosos (`rounded-2xl`), sombras suaves (`shadow-card`). Nunca uses colores fuera de
la paleta salvo los semánticos de estado (verde/rojo/ámbar) listados en §7.

## 4. Modelo de datos en Firestore (CONTRATO EXACTO — no lo cambies)

### `config/general` — documento único de parámetros

```js
{
  eventName: 'Día del Cliente',        // string
  eventYear: 2026,                     // number
  tagline: 'Conexiones que impulsan',  // string
  formOpen: true,                      // bool — si false, el formulario público muestra "cerrado"
  allowCompanion: true,                // bool — si false, se oculta el bloque de acompañante
  masterclassEnabled: true,            // bool — si false, se oculta la pregunta de masterclass
  days: [                              // array — editable desde el admin
    { id: '2026-09-08', label: '8 Septiembre', letter: 'M', enabled: true },
    { id: '2026-09-09', label: '9 Septiembre', letter: 'K', enabled: true }
  ],
  hours: [                             // array de strings HH:mm, 1 hora por cita
    '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'
  ],
  ticketPrefix: 'GEN',                 // string — prefijo del serial
  updatedAt: Timestamp
}
```

> `days[].id` es la CLAVE que se guarda en `reservation.day`. `hours[]` los valores de
> `reservation.hour`. `letter` es la M/K que aparece impresa en la entrada.

### `agents/{agentId}` — agentes de venta

```js
{
  name: 'Nombre Apellido',   // string
  photoBase64: 'data:image/jpeg;base64,...',  // string | null — dataURL COMPLETO, comprimido a <=200KB
  email: 'agente@empaquesbelen.com',          // string | '' (opcional, informativo)
  active: true,              // bool — solo los active aparecen en el formulario público
  createdAt: Timestamp
}
```

### `reservations/{reservationId}` — solicitudes

```js
{
  clientCode: 'C-1042',       // string, requerido
  fullName: 'Juan Pérez',     // string, requerido
  companyName: 'ACME S.A.',   // string, requerido
  email: 'juan@acme.com',     // string, requerido, validado
  phone: '',                  // string, opcional
  hasCompanion: false,        // bool
  companionName: '',          // string — requerido si hasCompanion === true
  agentId: 'abc123',          // string, requerido — ref a agents/{id}
  agentName: 'Nombre Apellido', // string — desnormalizado para poder listar sin joins
  day: '2026-09-08',          // string — debe existir en config.days[].id
  hour: '10:00',              // string — debe existir en config.hours[]
  masterclass: true,          // bool
  status: 'pending',          // 'pending' | 'approved' | 'rejected' | 'cancelled'
  rejectionReason: '',        // string — solo si rejected
  emailStatus: 'not_sent',    // 'not_sent' | 'sending' | 'sent' | 'failed'
  emailError: '',             // string — mensaje del último fallo de envío
  emailSentAt: Timestamp | null,
  ticketIds: [],              // string[] — ids de tickets emitidos (1 o 2)
  createdAt: Timestamp,
  approvedAt: Timestamp | null,
  reviewedBy: 'uid-del-admin' // string | null
}
```

### `slots/{slotId}` — bloqueo de disponibilidad

**`slotId` = `` `${day}_${hour}_${agentId}` ``** (ej. `2026-09-08_10:00_abc123`).
La sola existencia del documento significa OCUPADO. Se crea **dentro de una transacción** al
aprobar y se borra al rechazar/cancelar una reserva ya aprobada.

```js
{ day, hour, agentId, reservationId, createdAt }
```

### `tickets/{ticketId}` — entradas con QR

```js
{
  serial: 'GEN-0001',       // string — legible, correlativo, NUNCA se reutiliza
  qrToken: 'uuid-v4',       // string — el contenido del QR es EXACTAMENTE este token, nada más
  reservationId: 'xyz',     // string
  holderName: 'Juan Pérez', // string
  holderType: 'titular',    // 'titular' | 'acompanante'
  clientCode: 'C-1042',
  companyName: 'ACME S.A.',
  agentId: 'abc123',
  agentName: 'Nombre Apellido',
  day: '2026-09-08',
  hour: '10:00',
  masterclass: true,
  status: 'valid',          // 'valid' → 'inside' → 'exited' ; luego cualquier escaneo = inválido
  checkInAt: Timestamp | null,
  checkOutAt: Timestamp | null,
  createdAt: Timestamp
}
```

### `counters/tickets` — correlativo del serial

```js
{ next: 1 }   // se incrementa DENTRO de la misma transacción que crea los tickets
```

### `scans/{scanId}` — bitácora de escaneos (auditoría)

```js
{ ticketId, serial, action: 'check_in'|'check_out'|'rejected', reason: '', scannedAt: Timestamp, scannedBy: 'uid' }
```

### `admins/{uid}` — usuarios del panel (con rol)

```js
{
  email: 'usuario@empaquesbelen.com',
  name: 'Nombre',
  role: 'superadmin' | 'agente' | 'seguridad',  // un doc SIN role = 'superadmin' (compat.)
  agentId: 'abc123' | null,   // solo para role 'agente': lo enlaza con agents/{agentId}
  createdAt: Timestamp
}
```

La existencia de `admins/{uid}` = puede entrar al panel; el campo `role` decide QUÉ puede hacer:

- **superadmin**: acceso total. Crea a los demás usuarios (Seguridad desde /admin/users; Agentes con
  acceso desde /admin/agents). El superadmin **original** se crea a mano en la consola (su doc puede
  no tener `role`; se trata como superadmin).
- **agente**: ve y gestiona **solo sus** reservas (donde `reservation.agentId === su agentId`) y ve
  la asistencia. **NO escanea entradas** (el escáner es exclusivo de seguridad). No edita config,
  agentes ni usuarios.
- **seguridad**: solo escáner + ver invitaciones/asistencia (lectura). No aprueba ni edita nada.

Las cuentas de Firebase Auth de agente/seguridad se crean desde el cliente con una **app secundaria
de Firebase** (`lib/firebaseSecondary.js`) para no cerrar la sesión del superadmin. El doc
`admins/{uid}` lo escribe la sesión del superadmin (las reglas solo se lo permiten a él).

### `agents/{agentId}` — campos añadidos

Además de los campos de §4:

- `whatsapp`: **8 dígitos** de Costa Rica, sin espacios, guiones ni prefijo (el `+506` es fijo).
  Al registrar la ENTRADA de un cliente, el escáner ofrece un botón «Notificar por WhatsApp» que
  abre el chat del agente con un mensaje ya escrito (código y nombre del cliente). Se abre en una
  pestaña nueva para que el guarda vuelva al escáner tal como lo dejó.
- Cuenta de acceso (si la tiene): `uid` (su usuario del panel), `hasAccess: true` y `accessEmail`.

## 5. Máquina de estados

**Reserva:** `pending` → `approved` (crea slot + tickets + dispara correo) | `rejected`.
Una `approved` puede pasar a `cancelled` (libera el slot y anula sus tickets).

**Ticket (QR):** `valid` --1er escaneo--> `inside` --2º escaneo--> `exited` --3er escaneo--> RECHAZADO
(el ticket se queda en `exited`, no cambia; solo se registra el intento en `scans` con
`action: 'rejected'`). Un ticket de una reserva cancelada se marca `status: 'exited'`... **NO**:
usa un flag distinto — si la reserva se cancela, los tickets se **borran** y el serial se pierde
(no se reutiliza). Escanear un QR inexistente → "QR inválido".

**Presencia en el evento (derivada, no se guarda):**
- `inside` → "Dentro del evento"
- `exited` → "Ya salió"
- `valid` → "No ha asistido"

## 6. Reglas de concurrencia (críticas)

Toda la aprobación va en **una sola `runTransaction`**:

1. Leer `slots/{day}_{hour}_{agentId}` → si existe, **abortar** con error `SLOT_TAKEN`.
2. Leer `reservations/{id}` → si `status !== 'pending'`, abortar con `ALREADY_REVIEWED`.
3. Leer `counters/tickets` → obtener `next`.
4. Crear `slots/{slotId}`.
5. Crear 1 ó 2 docs en `tickets/` con seriales correlativos (`GEN-0001`, `GEN-0002`...).
6. Escribir `counters/tickets.next = next + nTickets`.
7. Actualizar la reserva: `status: 'approved'`, `approvedAt`, `ticketIds`, `emailStatus: 'not_sent'`.

**En Firestore todas las lecturas de una transacción deben ir ANTES de cualquier escritura.**
El envío del correo ocurre **fuera** de la transacción (es una llamada de red a Apps Script) y
actualiza `emailStatus` después. Si el correo falla, la reserva sigue aprobada y el admin puede
reintentar el envío con un botón "Reenviar correo".

## 7. Colores semánticos de estado (únicos permitidos fuera de la paleta)

| Estado | Clases |
|---|---|
| pending | `bg-amber-50 text-amber-700 ring-amber-200` |
| approved / sent / inside | `bg-emerald-50 text-emerald-700 ring-emerald-200` |
| rejected / failed | `bg-red-50 text-red-700 ring-red-200` |
| cancelled / exited / neutro | `bg-slate-100 text-slate-600 ring-slate-200` |

## 8. Rutas

| Ruta | Componente | Acceso |
|---|---|---|
| `/` | `pages/PublicForm.jsx` | público |
| `/admin/login` | `pages/AdminLogin.jsx` | público |
| `/admin` | `pages/AdminDashboard.jsx` (resumen + KPIs) | protegido |
| `/admin/reservations` | `pages/AdminReservations.jsx` | protegido |
| `/admin/agents` | `pages/AdminAgents.jsx` | protegido |
| `/admin/settings` | `pages/AdminSettings.jsx` | protegido |
| `/admin/scanner` | `pages/AdminScanner.jsx` | protegido |
| `/admin/attendance` | `pages/AdminAttendance.jsx` (dentro / salió / no asistió) | protegido |

Protegido = envuelto en `components/ProtectedRoute.jsx`, que exige sesión de Firebase Auth **y**
que exista `admins/{uid}`.

## 9. Mapa de archivos (quién escribe qué)

```
src/
  main.jsx                    [BASE - ya existe]
  App.jsx                     [BASE - ya existe] router
  index.css                   [BASE - ya existe]
  lib/
    firebase.js               [BASE - ya existe] app, db, auth
    constants.js              [BASE - ya existe] estados, etiquetas, colores
    format.js                 [BASE - ya existe] formateo de fechas/horas
    seed.js                   [BASE - ya existe] crea config/general y counters/tickets si faltan
  services/
    configService.js          [AGENTE 1] leer/escribir config/general
    agentsService.js          [AGENTE 1] CRUD agentes + compresión de foto a base64
    reservationsService.js    [AGENTE 2] crear reserva, listar, aprobar (TRANSACCIÓN), rechazar, cancelar
    ticketsService.js         [AGENTE 2] generación de QR dataURL, listar tickets
    scanService.js            [AGENTE 4] resolver QR → check_in / check_out / rechazo
    emailService.js           [AGENTE 5] POST al Apps Script + actualizar emailStatus
    availabilityService.js    [AGENTE 1] leer slots ocupados y calcular disponibilidad
  hooks/
    useAuth.jsx               [AGENTE 3] contexto de sesión + verificación de admin
    useConfig.js              [AGENTE 1] suscripción en tiempo real a config/general
    useAgents.js              [AGENTE 1] suscripción en tiempo real a agents
    useReservations.js        [AGENTE 3] suscripción en tiempo real a reservations
  components/
    ui/                       [AGENTE 6] Button, Input, Select, Badge, Card, Modal, Toast, Spinner, EmptyState
    Logo.jsx                  [AGENTE 6] logo Empaques Belén + Día del Cliente en SVG
    ProtectedRoute.jsx        [AGENTE 3]
    AdminLayout.jsx           [AGENTE 3] sidebar + topbar
    TicketPreview.jsx         [AGENTE 5] réplica visual de la entrada (para ver/imprimir)
  pages/
    PublicForm.jsx            [AGENTE 6]
    AdminLogin.jsx            [AGENTE 3]
    AdminDashboard.jsx        [AGENTE 3]
    AdminReservations.jsx     [AGENTE 3]
    AdminAgents.jsx           [AGENTE 1]
    AdminSettings.jsx         [AGENTE 1]
    AdminScanner.jsx          [AGENTE 4]
    AdminAttendance.jsx       [AGENTE 4]
apps-script/
  Codigo.gs                   [AGENTE 5] Web App que envía los correos
  plantilla-email.html        [AGENTE 5] HTML de la invitación
FIRESTORE_RULES.txt           [AGENTE 5] reglas a pegar en la consola
README.md                     [al final]
```

## 10. Convenciones de código (obligatorias)

- Todo en **español** de cara al usuario: etiquetas, mensajes, errores, placeholders.
- Nombres de variables/funciones en **inglés** (`handleSubmit`, `isLoading`).
- Componentes: `export default function Nombre() {}`.
- Servicios: funciones nombradas exportadas, `async`, que **lanzan `Error` con mensaje en español**
  ya listo para mostrar. Nunca devuelvas `null` en silencio ante un fallo.
- Nada de `alert()` / `confirm()` nativos: usa el `Modal` y el `Toast` de `components/ui/`.
- Nada de `TODO` ni funciones vacías: si algo se te escapa del alcance, impleméntalo igual.
- Estados de carga y de vacío en **toda** vista que lea de la red.
- Móvil primero. El escáner se usa desde un teléfono en la puerta del evento.
- Importa Firestore siempre desde `../lib/firebase.js`, nunca inicialices la app dos veces.
- No uses `import.meta.env` para la config de Firebase: ya está en `lib/firebase.js` en claro (es una
  config pública de cliente; la seguridad la dan las reglas de Firestore).

## 11. Contrato del correo (Apps Script)

El panel hace `POST` (con `mode: 'no-cors'` **NO** — usa `text/plain` para evitar el preflight CORS)
a la URL del Web App con este cuerpo JSON:

```json
{
  "secret": "SHARED_SECRET",
  "to": "juan@acme.com",
  "reservation": {
    "fullName": "Juan Pérez", "companyName": "ACME S.A.", "clientCode": "C-1042",
    "agentName": "Nombre Apellido", "dayLabel": "8 Septiembre", "dayLetter": "M",
    "hour": "10:00", "masterclass": true
  },
  "tickets": [
    { "serial": "GEN-0001", "holderName": "Juan Pérez", "holderType": "titular",
      "qrPng": "iVBORw0KGgo..." }
  ]
}
```

`qrPng` va **sin** el prefijo `data:image/png;base64,` (solo el base64 crudo). Apps Script lo
convierte a Blob y lo incrusta **inline** (CID) en el correo, no como adjunto suelto.

Respuesta esperada: `{ "ok": true, "sent": 2 }` o `{ "ok": false, "error": "mensaje" }`.

## 12. Definición de "terminado"

- `npm run build` pasa sin errores.
- No hay imports rotos ni componentes referenciados que no existan.
- El formulario público valida todo y no deja reservar un slot ya ocupado.
- Aprobar dos reservas al mismo agente/día/hora: la segunda **falla** con mensaje claro.
- El escáner marca entrada, luego salida, y luego rechaza.
