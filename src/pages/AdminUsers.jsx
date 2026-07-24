import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, UserPlus, Trash2, Shield, Crown, Briefcase, Users as UsersIcon } from 'lucide-react'

import { useAuth } from '../hooks/useAuth'
import { subscribePanelUsers, createSecurityUser, removePanelUser } from '../services/usersService'
import { ROLE, ROLE_LABEL } from '../lib/constants'
import { formatDateTime } from '../lib/format'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import { useToast } from '../components/ui/Toast'

/** Estilo del distintivo de cada rol (dentro de la paleta belén + slate). */
const ROLE_BADGE = {
  superadmin: { cls: 'bg-belen-blue/10 text-belen-blue ring-1 ring-belen-blue/20', Icon: Crown },
  agente: { cls: 'bg-belen-orange/10 text-belen-orange-dark ring-1 ring-belen-orange/30', Icon: Briefcase },
  seguridad: { cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', Icon: Shield },
}

function RoleBadge({ role }) {
  const meta = ROLE_BADGE[role] || ROLE_BADGE.seguridad
  const Icon = meta.Icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {ROLE_LABEL[role] || role}
    </span>
  )
}

export default function AdminUsers() {
  const { user } = useAuth()
  const toast = useToast()

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const [toRemove, setToRemove] = useState(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    let active = true
    const unsubscribe = subscribePanelUsers((list) => {
      if (!active) return
      setUsers(list)
      setLoading(false)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const groups = useMemo(() => {
    const withRole = users.map((u) => ({ ...u, role: u.role || ROLE.SUPERADMIN }))
    return {
      superadmins: withRole.filter((u) => u.role === ROLE.SUPERADMIN),
      agentes: withRole.filter((u) => u.role === ROLE.AGENTE),
      seguridad: withRole.filter((u) => u.role === ROLE.SEGURIDAD),
    }
  }, [users])

  const openModal = () => {
    setForm({ name: '', email: '', password: '' })
    setFormErrors({})
    setModalOpen(true)
  }

  const validate = () => {
    const errors = {}
    if (!form.name.trim()) errors.name = 'Escribe el nombre.'
    if (!form.email.trim()) errors.email = 'Escribe el correo.'
    if (!form.password || form.password.length < 6) {
      errors.password = 'Mínimo 6 caracteres.'
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreate = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      await createSecurityUser({
        name: form.name,
        email: form.email,
        password: form.password,
      })
      toast.success(`Cuenta de seguridad creada para ${form.email.trim()}.`)
      setModalOpen(false)
    } catch (error) {
      toast.error(error?.message || 'No se pudo crear la cuenta de seguridad.')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!toRemove) return
    setRemoving(true)
    try {
      await removePanelUser(toRemove.uid)
      toast.success(`Acceso de ${toRemove.name || toRemove.email} eliminado.`)
      setToRemove(null)
    } catch (error) {
      toast.error(error?.message || 'No se pudo eliminar el acceso.')
    } finally {
      setRemoving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-belen-blue">
            Usuarios del panel
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Crea cuentas de <strong>Seguridad</strong> (solo escáner y listas). Las cuentas de{' '}
            <strong>Asesor</strong> se crean desde{' '}
            <Link to="/admin/agents" className="font-semibold text-belen-orange hover:underline">
              Asesores
            </Link>
            , al dar acceso a cada asesor.
          </p>
        </div>
        <Button variant="primary" size="md" icon={UserPlus} onClick={openModal} className="w-full sm:w-auto">
          Agregar seguridad
        </Button>
      </div>

      {/* Administradores */}
      <Card title="Administrador general" subtitle="Acceso total al sistema">
        <ul className="divide-y divide-slate-100">
          {groups.superadmins.map((u) => (
            <li key={u.uid} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-belen-ink">
                  {u.name || 'Administrador'}
                  {u.uid === user?.uid && (
                    <span className="ml-2 text-xs font-normal text-slate-400">(tú)</span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
              </div>
              <RoleBadge role={ROLE.SUPERADMIN} />
            </li>
          ))}
        </ul>
      </Card>

      {/* Seguridad */}
      <Card
        title="Seguridad"
        subtitle="Solo escáner de entradas y listas de invitaciones/asistencia"
      >
        {groups.seguridad.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Aún no hay usuarios de seguridad"
            description="Crea cuentas para el personal que escaneará las entradas en la puerta."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.seguridad.map((u) => (
              <li key={u.uid} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-belen-ink">{u.name || u.email}</p>
                  <p className="truncate text-xs text-slate-500">{u.email}</p>
                  {u.createdAt && (
                    <p className="text-[11px] text-slate-400">Creado el {formatDateTime(u.createdAt)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <RoleBadge role={ROLE.SEGURIDAD} />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() => setToRemove(u)}
                    aria-label={`Eliminar acceso de ${u.name || u.email}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Agentes con acceso */}
      <Card
        title="Asesores con acceso"
        subtitle="Gestiona el alta y la contraseña de cada uno desde la pantalla Asesores"
      >
        {groups.agentes.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="Ningún asesor tiene acceso todavía"
            description="Ve a Asesores y usa «Dar acceso» en el asesor que quieras habilitar."
            action={
              <Link to="/admin/agents">
                <Button variant="secondary" size="sm">
                  Ir a Asesores
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.agentes.map((u) => (
              <li key={u.uid} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-belen-ink">{u.name || u.email}</p>
                  <p className="truncate text-xs text-slate-500">{u.email}</p>
                </div>
                <RoleBadge role={ROLE.AGENTE} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Modal: crear seguridad */}
      <Modal
        open={modalOpen}
        onClose={() => (saving ? null : setModalOpen(false))}
        title="Nueva cuenta de Seguridad"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" size="md" onClick={handleCreate} loading={saving}>
              Crear cuenta
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Esta cuenta solo podrá abrir el escáner y ver las listas. Anota el correo y la contraseña
            para entregárselos a la persona.
          </p>
          <Input
            label="Nombre"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={formErrors.name}
            placeholder="Ej. Portería principal"
          />
          <Input
            label="Correo de acceso"
            type="email"
            required
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            error={formErrors.email}
            placeholder="seguridad@empaquesbelen.com"
          />
          <Input
            label="Contraseña"
            type="text"
            required
            autoComplete="off"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            error={formErrors.password}
            hint="Mínimo 6 caracteres. Se la entregas a la persona; puede cambiarla luego."
            placeholder="Contraseña para esta cuenta"
          />
        </div>
      </Modal>

      {/* Modal: confirmar eliminación */}
      <Modal
        open={!!toRemove}
        onClose={() => (removing ? null : setToRemove(null))}
        title="Eliminar acceso"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setToRemove(null)} disabled={removing}>
              Cancelar
            </Button>
            <Button variant="danger" size="md" onClick={handleRemove} loading={removing}>
              Eliminar acceso
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          <strong>{toRemove?.name || toRemove?.email}</strong> dejará de poder entrar al panel. Su
          cuenta de correo seguirá existiendo en Firebase, pero sin ningún permiso. ¿Continuar?
        </p>
      </Modal>
    </div>
  )
}
