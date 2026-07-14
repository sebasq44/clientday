import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ShieldAlert, LogOut } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ERRORS, ROLE_HOME } from '../lib/constants'
import Logo from './Logo'
import Spinner from './ui/Spinner'
import Button from './ui/Button'

/**
 * Envuelve las rutas del panel: exige sesión de Firebase Auth Y que exista admins/{uid}.
 * - Cargando  -> pantalla completa con el logo y un spinner.
 * - Sin sesión -> redirige a /admin/login.
 * - Con sesión pero sin ser usuario del panel -> pantalla "Sin permisos" con botón de cerrar sesión.
 * - Con `roles` y el rol del usuario NO está permitido -> lo reenvía a su pantalla principal.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string[]} [props.roles] roles permitidos para esta ruta (si se omite, cualquier usuario del panel).
 */
export default function ProtectedRoute({ children, roles }) {
  const { user, isAdmin, role, loading, logout } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-belen-cream px-6">
        <Logo variant="full" className="h-16 w-auto" />
        <div className="belen-divider w-40">
          <span />
        </div>
        <div className="flex items-center gap-3 text-belen-blue">
          <Spinner size="md" />
          <p className="text-sm font-medium">Verificando tu sesión…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />
  }

  if (!isAdmin) {
    const handleLogout = async () => {
      setSigningOut(true)
      try {
        await logout()
      } finally {
        setSigningOut(false)
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-belen-cream px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-card">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 ring-1 ring-red-200">
            <ShieldAlert className="h-8 w-8 text-red-600" aria-hidden="true" />
          </div>

          <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-belen-blue">
            Sin permisos
          </h1>

          <div className="belen-divider my-4">
            <span />
          </div>

          <p className="text-sm text-slate-600">{ERRORS.NOT_ADMIN}</p>

          {user.email && (
            <p className="mt-3 break-all text-xs text-slate-500">
              Sesión iniciada como <span className="font-semibold">{user.email}</span>
            </p>
          )}

          <p className="mt-4 text-xs text-slate-500">
            Si crees que es un error, pide al administrador que registre tu cuenta en el panel.
          </p>

          <div className="mt-6">
            <Button
              variant="primary"
              size="md"
              icon={LogOut}
              loading={signingOut}
              onClick={handleLogout}
              className="w-full"
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // El usuario es del panel pero su rol no tiene acceso a ESTA ruta: lo mandamos a su inicio.
  if (Array.isArray(roles) && roles.length > 0 && !roles.includes(role)) {
    return <Navigate to={ROLE_HOME[role] || '/admin'} replace />
  }

  return children
}
