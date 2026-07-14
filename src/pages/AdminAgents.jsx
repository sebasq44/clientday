import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarCheck2,
  ImagePlus,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react'

import { Badge, Button, Card, EmptyState, Input, Modal, Spinner, useToast } from '../components/ui'
import { useAgents } from '../hooks/useAgents'
import { useReservations } from '../hooks/useReservations'
import {
  compressImageToBase64,
  createAgent,
  deleteAgent,
  updateAgent,
} from '../services/agentsService'
import { createAgentAccess, revokeAgentAccess } from '../services/usersService'
import { RESERVATION_STATUS } from '../lib/constants'
import { clean, isValidEmail } from '../lib/format'

const EMPTY_FORM = { name: '', email: '', whatsapp: '', photoBase64: null, active: true }

/** Solo dígitos: el WhatsApp se guarda sin espacios, guiones ni prefijo (+506 es fijo). */
const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 8)

/** Peso aproximado en KB del contenido de un dataURL base64. */
function dataUrlKb(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || ''
  if (!base64) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
  return Math.max(1, Math.round(bytes / 1024))
}

/** Iniciales para el avatar cuando el agente no tiene foto. */
function initials(name) {
  const parts = clean(name).split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : ''
  return (first + last).toUpperCase()
}

/** Interruptor accesible con la piel de la marca. */
function Toggle({ checked, onChange, disabled = false, busy = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-emerald-500' : 'bg-slate-300',
      ].join(' ')}
    >
      <span
        className={[
          'inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
        ].join(' ')}
      >
        {busy && <Spinner size="xs" className="text-belen-blue" />}
      </span>
    </button>
  )
}

/** Avatar circular del agente. */
function Avatar({ agent, size = 'md' }) {
  const box = size === 'lg' ? 'h-24 w-24 text-2xl' : 'h-16 w-16 text-lg'

  if (agent?.photoBase64) {
    return (
      <img
        src={agent.photoBase64}
        alt={`Foto de ${agent.name}`}
        className={`${box} shrink-0 rounded-full object-cover ring-2 ring-belen-orange/40`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} inline-flex shrink-0 items-center justify-center rounded-full bg-belen-blue/5 font-display font-extrabold text-belen-blue ring-2 ring-belen-blue/15`}
    >
      {initials(agent?.name)}
    </span>
  )
}

export default function AdminAgents() {
  const toast = useToast()
  const { agents, loading, error } = useAgents()
  const { reservations, loading: loadingReservations } = useReservations()

  // --- Formulario (crear / editar) ---
  const [formOpen, setFormOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  // --- Foto ---
  const [dragging, setDragging] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [photoError, setPhotoError] = useState('')
  const fileInputRef = useRef(null)
  const progressTimer = useRef(null)

  // --- Eliminar ---
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deactivating, setDeactivating] = useState(false)

  // --- Interruptor activo/inactivo ---
  const [togglingId, setTogglingId] = useState(null)

  // --- Acceso al panel (crear cuenta del agente) ---
  const [accessTarget, setAccessTarget] = useState(null)
  const [accessForm, setAccessForm] = useState({ email: '', password: '' })
  const [accessErrors, setAccessErrors] = useState({})
  const [creatingAccess, setCreatingAccess] = useState(false)

  // --- Revocar acceso ---
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(
    () => () => {
      if (progressTimer.current) window.clearInterval(progressTimer.current)
    },
    [],
  )

  /** Citas aprobadas por agente (las que ya tienen entradas emitidas). */
  const approvedByAgent = useMemo(() => {
    const counts = {}
    reservations.forEach((reservation) => {
      if (reservation.status !== RESERVATION_STATUS.APPROVED) return
      counts[reservation.agentId] = (counts[reservation.agentId] || 0) + 1
    })
    return counts
  }, [reservations])

  const activeCount = useMemo(() => agents.filter((agent) => agent.active).length, [agents])

  // ---------------------------------------------------------------- Formulario

  const openCreate = () => {
    setEditingAgent(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setPhotoError('')
    setProgress(0)
    setFormOpen(true)
  }

  const openEdit = (agent) => {
    setEditingAgent(agent)
    setForm({
      name: agent.name || '',
      email: agent.email || '',
      whatsapp: agent.whatsapp || '',
      photoBase64: agent.photoBase64 || null,
      active: agent.active !== false,
    })
    setErrors({})
    setPhotoError('')
    setProgress(0)
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving || compressing) return
    setFormOpen(false)
    setEditingAgent(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setPhotoError('')
    setProgress(0)
    setDragging(false)
  }

  const handleFile = useCallback(
    async (file) => {
      if (!file) return

      setPhotoError('')
      setCompressing(true)
      setProgress(8)

      // La compresión ocurre en un solo paso dentro del <canvas>, así que animamos el avance
      // hasta el 90 % y lo cerramos al terminar: el usuario ve que algo está pasando.
      if (progressTimer.current) window.clearInterval(progressTimer.current)
      progressTimer.current = window.setInterval(() => {
        setProgress((value) => (value >= 90 ? 90 : value + Math.max(2, Math.round((94 - value) / 6))))
      }, 90)

      try {
        const dataUrl = await compressImageToBase64(file)
        setForm((current) => ({ ...current, photoBase64: dataUrl }))
        setProgress(100)
      } catch (err) {
        setProgress(0)
        setPhotoError(err.message)
        toast.error(err.message)
      } finally {
        if (progressTimer.current) {
          window.clearInterval(progressTimer.current)
          progressTimer.current = null
        }
        setCompressing(false)
      }
    },
    [toast],
  )

  const handleDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (event) => {
    const file = event.target.files?.[0]
    // Limpiamos el input para poder volver a elegir el mismo archivo si hace falta.
    event.target.value = ''
    if (file) handleFile(file)
  }

  const validate = () => {
    const next = {}
    if (!clean(form.name)) next.name = 'El nombre del agente es obligatorio.'
    if (clean(form.email) && !isValidEmail(form.email)) {
      next.email = 'Escribe un correo válido, por ejemplo agente@empaquesbelen.com.'
    }
    // El WhatsApp es opcional, pero si lo escriben tiene que ser un número tico completo.
    const wa = onlyDigits(form.whatsapp)
    if (wa && wa.length !== 8) {
      next.whatsapp = 'El WhatsApp debe tener 8 dígitos (sin espacios ni guiones).'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (compressing) {
      toast.info('Espera a que termine de optimizarse la foto.')
      return
    }
    if (!validate()) return

    setSaving(true)
    try {
      const payload = {
        name: clean(form.name),
        email: clean(form.email),
        whatsapp: onlyDigits(form.whatsapp),
        photoBase64: form.photoBase64 || null,
        active: Boolean(form.active),
      }

      if (editingAgent) {
        await updateAgent(editingAgent.id, payload)
        toast.success(`Se guardaron los cambios de ${payload.name}.`)
      } else {
        await createAgent(payload)
        toast.success(`${payload.name} se agregó a la lista de agentes.`)
      }

      setFormOpen(false)
      setEditingAgent(null)
      setForm(EMPTY_FORM)
      setProgress(0)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------- Activo / inactivo

  const handleToggleActive = async (agent, nextActive) => {
    setTogglingId(agent.id)
    try {
      await updateAgent(agent.id, { active: nextActive })
      toast.success(
        nextActive
          ? `${agent.name} vuelve a aparecer en el formulario público.`
          : `${agent.name} ya no aparecerá en el formulario público.`,
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTogglingId(null)
    }
  }

  // ---------------------------------------------------------------- Eliminar

  const openDelete = (agent) => {
    setDeleteTarget(agent)
    setDeleteError('')
  }

  const closeDelete = () => {
    if (deleting || deactivating) return
    setDeleteTarget(null)
    setDeleteError('')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteAgent(deleteTarget.id)
      toast.success(`${deleteTarget.name} se eliminó de la lista de agentes.`)
      setDeleteTarget(null)
    } catch (err) {
      // El caso típico: el agente tiene reservas aprobadas y no se puede borrar.
      setDeleteError(err.message)
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleDeactivateInstead = async () => {
    if (!deleteTarget) return
    setDeactivating(true)
    try {
      await updateAgent(deleteTarget.id, { active: false })
      toast.success(`${deleteTarget.name} quedó inactivo y conserva su historial.`)
      setDeleteTarget(null)
      setDeleteError('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeactivating(false)
    }
  }

  // ---------------------------------------------------------------- Acceso al panel

  const openAccess = (agent) => {
    setAccessTarget(agent)
    // Sugerimos el correo del agente si ya lo tiene registrado.
    setAccessForm({ email: agent.email || '', password: '' })
    setAccessErrors({})
  }

  const closeAccess = () => {
    if (creatingAccess) return
    setAccessTarget(null)
    setAccessForm({ email: '', password: '' })
    setAccessErrors({})
  }

  const validateAccess = () => {
    const next = {}
    if (!isValidEmail(accessForm.email)) {
      next.email = 'Escribe un correo válido, por ejemplo agente@empaquesbelen.com.'
    }
    if (!accessForm.password || accessForm.password.length < 6) {
      next.password = 'La contraseña debe tener al menos 6 caracteres.'
    }
    setAccessErrors(next)
    return Object.keys(next).length === 0
  }

  const handleCreateAccess = async (event) => {
    event.preventDefault()
    if (!accessTarget) return
    if (!validateAccess()) return

    const email = clean(accessForm.email)
    setCreatingAccess(true)
    try {
      await createAgentAccess({
        agentId: accessTarget.id,
        agentName: accessTarget.name,
        agentEmail: accessTarget.email,
        email,
        password: accessForm.password,
      })
      toast.success(`Acceso creado para ${email}`)
      setAccessTarget(null)
      setAccessForm({ email: '', password: '' })
      setAccessErrors({})
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreatingAccess(false)
    }
  }

  // ---------------------------------------------------------------- Revocar acceso

  const openRevoke = (agent) => setRevokeTarget(agent)

  const closeRevoke = () => {
    if (revoking) return
    setRevokeTarget(null)
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await revokeAgentAccess({ agentId: revokeTarget.id, uid: revokeTarget.uid })
      toast.success(`${revokeTarget.name} ya no puede entrar al panel.`)
      setRevokeTarget(null)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRevoking(false)
    }
  }

  // ---------------------------------------------------------------- Render

  const photoKb = form.photoBase64 ? dataUrlKb(form.photoBase64) : 0

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold uppercase tracking-wide text-belen-blue sm:text-2xl">
            Agentes de ventas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Solo los agentes activos aparecen en el formulario público de reservas.
          </p>
        </div>

        <Button icon={Plus} onClick={openCreate} className="w-full sm:w-auto">
          Agregar agente
        </Button>
      </header>

      <Card
        title="Equipo comercial"
        subtitle={
          loading
            ? 'Cargando agentes…'
            : error
              ? 'No se pudieron cargar los agentes.'
              : `${agents.length} ${agents.length === 1 ? 'agente' : 'agentes'} · ${activeCount} ${
                  activeCount === 1 ? 'activo' : 'activos'
                }`
        }
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-belen-blue">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-slate-500">Cargando agentes…</p>
          </div>
        ) : error ? (
          <EmptyState
            icon={TriangleAlert}
            title="No pudimos cargar los agentes"
            description={error}
            action={
              <Button icon={RefreshCw} onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            }
          />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Todavía no hay agentes"
            description="Agrega al primer agente de ventas para que los clientes puedan elegirlo al reservar su cita."
            action={
              <Button icon={Plus} onClick={openCreate}>
                Agregar agente
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => {
              const approved = approvedByAgent[agent.id] || 0
              const isToggling = togglingId === agent.id

              return (
                <li
                  key={agent.id}
                  className="flex flex-col gap-4 rounded-2xl bg-belen-cream/60 p-4 ring-1 ring-belen-blue/10 transition-shadow hover:shadow-card"
                >
                  <div className="flex items-start gap-3">
                    <Avatar agent={agent} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                        {agent.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {agent.email || 'Sin correo registrado'}
                      </p>
                      <p
                        className={[
                          'mt-0.5 truncate text-xs font-medium',
                          agent.whatsapp ? 'text-emerald-600' : 'text-slate-400',
                        ].join(' ')}
                      >
                        {agent.whatsapp
                          ? `WhatsApp +506 ${agent.whatsapp}`
                          : 'Sin WhatsApp registrado'}
                      </p>
                      <div className="mt-2">
                        <Badge status={agent.active ? 'approved' : 'cancelled'}>
                          {agent.active ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarCheck2 className="h-4 w-4 text-belen-orange" aria-hidden="true" />
                    {loadingReservations
                      ? 'Contando citas aprobadas…'
                      : `${approved} ${approved === 1 ? 'cita aprobada' : 'citas aprobadas'}`}
                  </p>

                  {/* Acceso del agente al panel */}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-belen-blue/10">
                    <div className="min-w-0">
                      {agent.hasAccess ? (
                        <>
                          <Badge status="approved">Con acceso</Badge>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {agent.accessEmail || agent.email || 'Cuenta activa'}
                          </p>
                        </>
                      ) : (
                        <Badge status="neutral">Sin acceso</Badge>
                      )}
                    </div>

                    {agent.hasAccess ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={ShieldOff}
                        onClick={() => openRevoke(agent)}
                        aria-label={`Revocar el acceso de ${agent.name}`}
                        className="text-red-600 hover:bg-red-50 active:bg-red-100"
                      >
                        Revocar acceso
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={KeyRound}
                        onClick={() => openAccess(agent)}
                        aria-label={`Dar acceso al panel a ${agent.name}`}
                      >
                        Dar acceso
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3 border-t border-belen-blue/10 pt-3">
                    <div className="flex items-center gap-2">
                      <Toggle
                        checked={agent.active}
                        busy={isToggling}
                        onChange={(next) => handleToggleActive(agent, next)}
                        label={`Activar o desactivar a ${agent.name}`}
                      />
                      <span className="text-xs font-semibold text-slate-600">
                        {agent.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        onClick={() => openEdit(agent)}
                        aria-label={`Editar a ${agent.name}`}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        onClick={() => openDelete(agent)}
                        aria-label={`Eliminar a ${agent.name}`}
                        className="text-red-600 hover:bg-red-50 active:bg-red-100"
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------ Modal crear / editar */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        size="lg"
        title={editingAgent ? 'Editar agente' : 'Agregar agente'}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeForm}
              disabled={saving || compressing}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="agent-form"
              loading={saving}
              disabled={compressing}
              className="w-full sm:w-auto"
            >
              {editingAgent ? 'Guardar cambios' : 'Agregar agente'}
            </Button>
          </>
        }
      >
        <form id="agent-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
          <Input
            label="Nombre"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            error={errors.name}
            placeholder="Nombre y apellido"
            autoComplete="off"
          />

          <Input
            label="Correo"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            error={errors.email}
            hint="Opcional. Solo es informativo: las entradas se envían al correo del cliente."
            placeholder="agente@empaquesbelen.com"
            autoComplete="off"
          />

          {/* WhatsApp: el prefijo +506 es fijo (todos los agentes son de Costa Rica), así que
              solo se escriben los 8 dígitos. Con esto, seguridad puede avisarle al agente desde
              el escáner en cuanto su cliente entra al evento. */}
          <div>
            <label
              htmlFor="agent-whatsapp"
              className="mb-1.5 block text-sm font-semibold text-belen-ink"
            >
              WhatsApp
            </label>
            <div className="flex items-stretch">
              <span className="flex select-none items-center rounded-l-xl border border-r-0 border-belen-blue/20 bg-belen-blue/5 px-3 text-sm font-bold text-belen-blue">
                +506
              </span>
              <input
                id="agent-whatsapp"
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                value={form.whatsapp}
                onChange={(event) =>
                  setForm({ ...form, whatsapp: onlyDigits(event.target.value) })
                }
                placeholder="88887777"
                aria-invalid={Boolean(errors.whatsapp)}
                className={[
                  'w-full rounded-r-xl border px-3 py-2.5 text-sm font-medium tracking-wide outline-none transition-colors',
                  'focus:ring-2 focus:ring-belen-orange',
                  errors.whatsapp
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-belen-blue/20 bg-white text-belen-ink',
                ].join(' ')}
              />
            </div>
            {errors.whatsapp ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.whatsapp}</p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                Opcional. 8 dígitos, sin espacios ni guiones. Seguridad podrá avisarle por WhatsApp
                cuando su cliente entre al evento.
              </p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-belen-ink">Foto</span>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex flex-col items-center gap-2">
                {form.photoBase64 ? (
                  <img
                    src={form.photoBase64}
                    alt="Vista previa de la foto del agente"
                    className="h-24 w-24 rounded-full object-cover ring-2 ring-belen-orange/40"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-belen-blue/5 ring-2 ring-dashed ring-belen-blue/20"
                  >
                    <UserRound className="h-10 w-10 text-belen-blue/40" />
                  </span>
                )}

                {form.photoBase64 && !compressing && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, photoBase64: null })
                      setProgress(0)
                      setPhotoError('')
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Quitar foto
                  </button>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => !compressing && fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (!compressing) fileInputRef.current?.click()
                    }
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setDragging(false)
                  }}
                  onDrop={handleDrop}
                  className={[
                    'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
                    compressing ? 'cursor-wait opacity-70' : '',
                    dragging
                      ? 'border-belen-orange bg-belen-orange/5'
                      : 'border-belen-blue/25 bg-belen-cream/60 hover:border-belen-orange hover:bg-belen-orange/5',
                  ].join(' ')}
                >
                  {compressing ? (
                    <Spinner size="md" className="text-belen-blue" />
                  ) : (
                    <ImagePlus className="h-7 w-7 text-belen-blue/60" aria-hidden="true" />
                  )}

                  <p className="text-sm font-semibold text-belen-blue">
                    {compressing ? 'Optimizando imagen…' : 'Arrastra la foto aquí'}
                  </p>
                  <p className="text-xs text-slate-500">
                    o haz clic para elegir un archivo (JPG o PNG, máximo 8 MB)
                  </p>

                  <span className="pointer-events-none mt-1 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-belen-blue ring-1 ring-inset ring-belen-blue/20">
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Seleccionar archivo
                  </span>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handleFileInput}
                    tabIndex={-1}
                  />
                </div>

                {compressing && (
                  <div className="mt-3">
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-belen-blue/10"
                      role="progressbar"
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Progreso de la optimización de la imagen"
                    >
                      <div
                        className="h-full rounded-full bg-belen-orange transition-[width] duration-150 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-slate-500">
                      Comprimiendo la foto… {progress}%
                    </p>
                  </div>
                )}

                {!compressing && form.photoBase64 && (
                  <p className="mt-3 text-xs font-semibold text-emerald-700">
                    Imagen optimizada: {photoKb} KB
                  </p>
                )}

                {photoError && (
                  <p role="alert" className="mt-3 text-xs font-medium text-red-600">
                    {photoError}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl bg-belen-cream/70 px-4 py-3 ring-1 ring-belen-blue/10">
            <Toggle
              checked={form.active}
              onChange={(next) => setForm({ ...form, active: next })}
              label="Agente activo"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-belen-ink">
                {form.active ? 'Activo' : 'Inactivo'}
              </p>
              <p className="text-xs text-slate-500">
                Los agentes inactivos no aparecen en el formulario público de reservas.
              </p>
            </div>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------ Modal eliminar */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={closeDelete}
        size="sm"
        title="Eliminar agente"
        footer={
          <>
            <Button variant="ghost" onClick={closeDelete} disabled={deleting || deactivating}>
              Cancelar
            </Button>

            {deleteError ? (
              <Button
                variant="secondary"
                loading={deactivating}
                disabled={deleting}
                onClick={handleDeactivateInstead}
              >
                Desactivar en su lugar
              </Button>
            ) : (
              <Button
                variant="danger"
                icon={Trash2}
                loading={deleting}
                disabled={deactivating}
                onClick={handleDelete}
              >
                Eliminar
              </Button>
            )}
          </>
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar agent={deleteTarget} />
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                  {deleteTarget.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {deleteTarget.email || 'Sin correo registrado'}
                </p>
              </div>
            </div>

            {deleteError ? (
              <div className="flex gap-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
                <div className="min-w-0 text-sm text-red-700">
                  <p className="font-semibold">No se puede eliminar</p>
                  <p className="mt-1 leading-snug">{deleteError}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-slate-600">
                ¿Seguro que quieres eliminar a <strong>{deleteTarget.name}</strong>? Esta acción no se
                puede deshacer. Si el agente ya tiene citas aprobadas, deberás desactivarlo en lugar
                de eliminarlo.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------ Modal dar acceso */}
      <Modal
        open={Boolean(accessTarget)}
        onClose={closeAccess}
        size="md"
        title="Dar acceso al panel"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeAccess}
              disabled={creatingAccess}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="agent-access-form"
              icon={KeyRound}
              loading={creatingAccess}
              className="w-full sm:w-auto"
            >
              Crear acceso
            </Button>
          </>
        }
      >
        {accessTarget && (
          <form id="agent-access-form" onSubmit={handleCreateAccess} className="space-y-5" noValidate>
            <div className="flex items-center gap-3">
              <Avatar agent={accessTarget} />
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                  {accessTarget.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {accessTarget.email || 'Sin correo registrado'}
                </p>
              </div>
            </div>

            <p className="rounded-xl bg-belen-cream/70 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-1 ring-belen-blue/10">
              Se creará una cuenta para que <strong>{accessTarget.name}</strong> entre al panel y
              gestione únicamente <strong>sus</strong> solicitudes. Tu sesión de administrador seguirá
              abierta.
            </p>

            <Input
              label="Correo de acceso"
              type="email"
              required
              value={accessForm.email}
              onChange={(event) => setAccessForm({ ...accessForm, email: event.target.value })}
              error={accessErrors.email}
              placeholder="agente@empaquesbelen.com"
              autoComplete="off"
            />

            <Input
              label="Contraseña"
              type="text"
              required
              value={accessForm.password}
              onChange={(event) => setAccessForm({ ...accessForm, password: event.target.value })}
              error={accessErrors.password}
              hint="Mínimo 6 caracteres. Entrégasela al agente; podrá cambiarla más adelante."
              placeholder="Mínimo 6 caracteres"
              autoComplete="new-password"
            />
          </form>
        )}
      </Modal>

      {/* ------------------------------------------------ Modal revocar acceso */}
      <Modal
        open={Boolean(revokeTarget)}
        onClose={closeRevoke}
        size="sm"
        title="Revocar acceso"
        footer={
          <>
            <Button variant="ghost" onClick={closeRevoke} disabled={revoking}>
              Cancelar
            </Button>
            <Button variant="danger" icon={ShieldOff} loading={revoking} onClick={handleRevoke}>
              Revocar acceso
            </Button>
          </>
        }
      >
        {revokeTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar agent={revokeTarget} />
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-extrabold uppercase tracking-wide text-belen-blue">
                  {revokeTarget.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {revokeTarget.accessEmail || revokeTarget.email || 'Sin correo registrado'}
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-slate-600">
              <strong>{revokeTarget.name}</strong> dejará de poder entrar al panel y gestionar sus
              solicitudes. Podrás volver a darle acceso cuando quieras.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
