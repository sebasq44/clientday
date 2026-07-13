# Día del Cliente 2026 — Empaques Belén

Aplicación web para gestionar las reservas del evento anual **Día del Cliente** de Empaques Belén:
un formulario público donde el cliente reserva su cita y un panel de administración donde se aprueban
las solicitudes, se emiten las entradas con código QR, se envían por correo y se escanean en la puerta
el día del evento.

> Lema del evento: **«Conexiones que impulsan»**.

**Stack:** React 18 + Vite 6 + Tailwind 3 + React Router 6 + Firebase v11 (Firestore + Authentication) +
Google Apps Script (envío de correos) + `qrcode` / `html5-qrcode`.

---

## 1. Qué es la app y cómo funciona

La app tiene dos caras que comparten la misma base de datos (Cloud Firestore):

- **Formulario público** (`/`): el cliente escribe sus datos, elige al **agente de ventas** que lo
  acompañará, el **día** y la **hora**, indica si lleva acompañante y si asistirá a la Masterclass, y
  envía la solicitud. La reserva nace en estado **`pending`** (pendiente).
- **Panel de administración** (`/admin`): protegido con usuario y contraseña.

El flujo completo, de principio a fin:

1. **El cliente reserva** desde `/`. El formulario muestra en vivo qué horas están libres para cada
   agente y no deja elegir una hora ya ocupada.
2. **Un administrador aprueba** la solicitud desde `/admin/reservations`. Al aprobar, y de forma
   **atómica** (una sola transacción de Firestore):
   - se **bloquea el horario** de ese agente (nadie más podrá reservar ese día + hora + agente);
   - se **emiten 1 o 2 entradas** (titular y, si lo hay, acompañante) con un serial correlativo
     (`GEN-0001`, `GEN-0002`, …) que **nunca se reutiliza**;
   - cada entrada lleva un **token QR** único.

   > Regla de negocio clave: un agente **no puede** tener dos clientes en el mismo (día, hora). Si dos
   > administradores intentan aprobar dos reservas para el mismo hueco, la segunda **falla** con un
   > mensaje claro y no emite ninguna entrada.
3. **Se envía el correo con las entradas.** Justo después de aprobar, la app llama a un pequeño
   servicio de Google Apps Script que construye el correo, incrusta los QR y lo envía al cliente. Si el
   correo falla (o el envío aún no está configurado), la reserva **sigue aprobada** y en el panel queda
   un botón **«Reenviar correo»**.
4. **El día del evento**, en la puerta, un administrador abre `/admin/scanner` desde el teléfono y
   escanea el QR de cada asistente:
   - 1.er escaneo → **Entrada** (queda «Dentro del evento»);
   - 2.º escaneo → **Salida** (queda «Ya salió»);
   - 3.er escaneo o QR inexistente → **Rechazado**.
   Todo intento queda registrado en una bitácora de auditoría. La vista `/admin/attendance` muestra en
   vivo quién está dentro, quién salió y quién no ha asistido.

---

## 2. Instalación (entorno local)

Requisitos: **Node.js 18 o superior** y **npm**.

```bash
# 1. Instalar dependencias (ya vienen declaradas en package.json)
npm install

# 2. Levantar el servidor de desarrollo
npm run dev
```

Vite mostrará una URL local (por defecto `http://localhost:5173`). Ábrela en el navegador:

- `/` → formulario público.
- `/admin/login` → acceso al panel.

> Nota: para que la app funcione de verdad necesitas completar los pasos de **Firebase** (sección 3).
> El envío de correos (sección 4) es opcional para probar, pero obligatorio para que el cliente reciba
> su entrada.

Otros comandos útiles:

```bash
npm run build     # genera la versión de producción en dist/
npm run preview   # sirve localmente lo que hay en dist/ (para revisar el build)
npm run lint      # comprobación de estilo con ESLint
```

---

## 3. Firebase paso a paso

La configuración pública del proyecto ya está escrita en `src/lib/firebase.js` (apunta al proyecto
`client-day`). No es un secreto: la seguridad real la dan las **reglas de Firestore**. Si vas a usar un
proyecto de Firebase distinto, reemplaza ese objeto `firebaseConfig` por el de tu proyecto (lo obtienes
en *Configuración del proyecto → Tus apps → SDK de configuración*).

### 3.1. Activar Cloud Firestore

1. Entra a <https://console.firebase.google.com> y abre tu proyecto.
2. Menú lateral: **Compilación → Firestore Database → Crear base de datos**.
3. Elige una ubicación y créala en **modo de producción** (las reglas que pegarás abajo son las que
   mandan; no uses el modo de prueba en producción).

### 3.2. Activar Authentication (correo y contraseña)

1. Menú lateral: **Compilación → Authentication → Comenzar**.
2. Pestaña **Sign-in method → Correo electrónico/contraseña → activar → Guardar**.

### 3.3. Crear el usuario administrador

1. En **Authentication → Users → Add user (Agregar usuario)**.
2. Escribe el correo (por ejemplo `admin@empaquesbelen.com`) y una contraseña segura → **Add user**.
3. En la lista de usuarios, **copia el `User UID`** de esa cuenta (un texto tipo
   `xY7bQk3mSfW2pL9dR4tHnA1cVe83`).

### 3.4. Crear a mano el documento `admins/{uid}`

La app **no** decide quién es administrador por su correo, sino por la existencia de un documento en la
colección `admins` cuyo **ID es el UID** del usuario. Ese documento se crea a mano, a propósito: así
nadie puede auto-concederse permisos aunque manipule la app.

1. **Firestore Database → pestaña Datos → Iniciar colección** (o «+ Agregar colección»).
   - ID de la colección: `admins` (exactamente así, en minúsculas).
   - ID del documento: **pega el UID** del paso 3.3 (⚠️ no uses «ID automático»).
   - Campo `email` (tipo *string*) → el correo del administrador.
   - Campo `createdAt` (tipo *timestamp*) → la fecha y hora de hoy.
2. Guarda.

Para dar de alta a otro administrador, repite 3.3 y 3.4 con su cuenta. Para revocar el acceso, **borra**
su documento de `admins/` (aunque su usuario de Authentication siga existiendo, dejará de tener permisos).

### 3.5. Pegar las reglas de seguridad

1. **Firestore Database → pestaña Reglas**.
2. Borra todo y pega el contenido completo del archivo **`FIRESTORE_RULES.txt`** (desde
   `rules_version = '2';` hasta la última llave `}`).
3. **Publicar**.

Estas reglas dejan público solo lo imprescindible (configuración del evento, lista de agentes, horarios
ocupados y la *creación* de una solicitud, que se valida campo por campo) y reservan todo lo demás
—reservas, entradas, escaneos, contador— a los administradores.

### 3.6. Primer arranque

La primera vez que un administrador inicia sesión, la app crea sola los documentos base
`config/general` (parámetros del evento) y `counters/tickets` (contador de seriales). No hay que crearlos
a mano. Luego puedes ajustar días, horas, agentes y demás desde **/admin/settings** y **/admin/agents**.

---

## 4. Apps Script paso a paso (envío de correos)

El correo con las entradas **no** se envía desde el navegador, sino desde un pequeño *Web App* de Google
Apps Script que usa Gmail. Los archivos ya están listos en la carpeta `apps-script/`.

1. Entra a <https://script.google.com> **con la cuenta de Gmail/Workspace desde la que quieres que salgan
   los correos** (esa cuenta será el remitente) → **Proyecto nuevo**. Ponle un nombre, por ejemplo
   «Día del Cliente 2026 — Correos».
2. Borra el contenido de `Codigo.gs` y pega el archivo **`apps-script/Codigo.gs`** completo.
3. Junto a «Archivos» pulsa **«+» → HTML** y crea un archivo llamado **exactamente** `plantilla-email`
   (Apps Script le añade solo la extensión `.html`). Pega dentro el archivo
   **`apps-script/plantilla-email.html`**.
   > El nombre debe ser exactamente `plantilla-email`, porque el código lo carga con
   > `HtmlService.createTemplateFromFile('plantilla-email')`.
4. Guarda (Ctrl+S).
5. **Implementar → Nueva implementación**:
   - Tipo (engranaje): **Aplicación web**.
   - **Ejecutar como: Yo** (tu cuenta).
   - **Quién tiene acceso: Cualquier usuario, incluso anónimo**.
   - **Implementar**.
6. Google pedirá **autorizar los permisos de Gmail**: «Autorizar acceso» → elige tu cuenta →
   «Configuración avanzada» → «Ir a &lt;nombre del proyecto&gt; (no seguro)» → «Permitir». Es tu propio
   script, es normal que salga ese aviso.
7. Copia la **URL de la aplicación web** (termina en `/exec`).
8. Pégala en `src/lib/firebase.js`, en la constante `APPS_SCRIPT_URL`:

   ```js
   export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec'
   ```

9. Comprueba que vive: abre esa URL en el navegador. Debe responder un JSON de salud
   `{ "ok": true, "service": "…", "status": "activo" }`.

**Secreto compartido.** `APPS_SCRIPT_SECRET` en `src/lib/firebase.js` debe coincidir con `SHARED_SECRET`
dentro de `apps-script/Codigo.gs`. Ambos vienen ya con el mismo valor
(`belen-dia-del-cliente-2026`); si lo cambias, cámbialo en **los dos** sitios.

> Cada vez que edites el script, vuelve a **Implementar → Gestionar implementaciones → editar (lápiz) →
> Versión: Nueva versión → Implementar**, o los cambios no se aplicarán a la URL ya publicada.
>
> Límites de Gmail: 100 destinatarios/día en cuentas `@gmail.com` gratuitas y 1.500/día en Google
> Workspace. Si se superan, el correo queda en «Falló» y podrás reintentarlo desde el panel.

---

## 5. Despliegue (producción)

1. Genera la versión de producción:

   ```bash
   npm run build
   ```

   Esto crea la carpeta **`dist/`** con archivos estáticos.

2. Publica `dist/` en cualquier hosting estático (Firebase Hosting, Netlify, Vercel, un servidor Nginx…).

### Con Firebase Hosting (recomendado)

```bash
npm install -g firebase-tools   # si aún no lo tienes
firebase login
firebase init hosting           # elige tu proyecto; carpeta pública: dist ; SPA: Sí
npm run build
firebase deploy --only hosting
```

Al inicializar, responde **«Sí»** a *«Configure as a single-page app (rewrite all urls to /index.html)»*.
Esto es imprescindible: la app usa rutas del lado del cliente (`/admin`, `/admin/scanner`, …) y sin la
reescritura, al recargar una de esas rutas el hosting devolvería un 404.

Si tu `firebase.json` no quedó con la reescritura, asegúrate de que incluya:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

> **Importante:** el enlace del **formulario público** que compartes con los clientes es la **raíz `/`**
> del sitio (por ejemplo `https://tu-sitio.web.app/`). El panel vive bajo `/admin`. Desde el propio panel
> (pantalla de Resumen) hay un botón **«Copiar enlace del formulario»** que copia esa URL raíz.

> Cualquier hosting estático sirve, pero **debe** reenviar todas las rutas a `index.html` (regla de
> *SPA fallback*). En Netlify, un archivo `_redirects` con `/*  /index.html  200`; en Vercel, la
> reescritura equivalente.

---

## 6. Uso diario

Todo el trabajo se hace desde `/admin` (inicia sesión en `/admin/login` con la cuenta administradora).

- **Resumen** (`/admin`): indicadores en vivo (pendientes, aprobadas, personas esperadas, dentro del
  evento, Masterclass, correos fallidos), calendario de ocupación por agente y día, y el botón para
  copiar el enlace del formulario.
- **Aprobar / rechazar reservas** (`/admin/reservations`):
  - **Aprobar**: bloquea el horario, emite las entradas y envía el correo. Si el hueco ya se ocupó, la
    aprobación se cancela sola con un aviso.
  - **Rechazar**: pide un motivo (queda guardado); no emite entradas.
  - **Cancelar** una reserva ya aprobada: libera el horario y **anula** sus entradas (sus QR dejan de
    servir).
  - **Reenviar correo**: reintenta el envío de las entradas cuando el correo falló o aún no salió.
  - **Ver entradas / Imprimir**: muestra la réplica de la entrada con su QR y permite imprimirla.
  - **Exportar CSV**: descarga las reservas filtradas (se abre bien en Excel, con tildes).
- **Agentes** (`/admin/agents`): crea, edita, activa/desactiva y elimina agentes. La foto se comprime
  sola a ≤200 KB. Solo los agentes **activos** aparecen en el formulario público. Un agente con reservas
  aprobadas no se puede borrar (se ofrece **desactivarlo** para conservar el historial).
- **Ajustes** (`/admin/settings`): nombre y año del evento, abrir/cerrar el formulario, mostrar u ocultar
  el bloque de acompañante y la pregunta de Masterclass, **días** y **horas** disponibles, y el prefijo
  del serial de las entradas.
- **Escáner** (`/admin/scanner`) — **para el día del evento, desde el móvil**:
  1. Abre esta ruta en el teléfono. Debe servirse por **HTTPS** (Firebase Hosting ya lo hace); los
     navegadores no permiten la cámara en `http://`.
  2. Pulsa **«Abrir cámara»** y concede el permiso.
  3. Apunta al QR: el 1.er escaneo registra **Entrada**, el 2.º **Salida**, y a partir de ahí lo
     **rechaza**. Suena un bip y vibra el teléfono según el resultado.
  4. Si la cámara falla, usa el **Registro manual**: teclea el serial (`GEN-0007`) o solo el número (`7`).
- **Asistencia** (`/admin/attendance`): quién está dentro, quién salió y quién no ha asistido, en vivo,
  con filtros y exportación a CSV.

---

## 7. Índices de Firestore

Con las consultas actuales **no necesitas crear índices compuestos a mano**: todas usan un único campo
de orden o filtros de igualdad que Firestore resuelve con sus índices automáticos de un solo campo
(reservas por fecha, entradas por serial, tickets por `reservationId`, escaneos por fecha, búsqueda del
QR por `qrToken`, etc.).

Si en algún momento Firestore devuelve un error del tipo *«The query requires an index»* (por ejemplo al
ampliar alguna consulta o al eliminar un agente con muchas reservas), **el propio mensaje de error trae
un enlace directo**: ábrelo y pulsa **«Crear índice»**. Firestore lo genera con la configuración exacta
que necesita la consulta; en un par de minutos queda «Habilitado» y la operación vuelve a funcionar.

También puedes crearlos manualmente en **Firestore Database → pestaña Índices → Agregar índice**, pero lo
más rápido y seguro es usar el enlace del error.

---

## Estructura del proyecto (referencia rápida)

```
src/
  lib/          firebase, constantes, formato, datos semilla
  services/     acceso a Firestore (config, agentes, reservas, tickets, escaneo, correo, disponibilidad)
  hooks/        sesión (useAuth) y suscripciones en vivo (config, agentes, reservas)
  components/   sistema de diseño (ui/), Logo, ProtectedRoute, AdminLayout, TicketPreview
  pages/        formulario público y las 6 vistas del panel
apps-script/    Codigo.gs + plantilla-email.html (Web App de correos)
FIRESTORE_RULES.txt   reglas de seguridad para pegar en la consola de Firebase
```

El documento **`ARCHITECTURE.md`** es el contrato técnico (modelo de datos, estados, reglas de negocio):
consúltalo antes de tocar el código.
