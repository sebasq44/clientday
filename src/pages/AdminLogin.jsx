import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Eye, EyeOff, LogIn, LogOut } from 'lucide-react'
import Logo from '../components/Logo'
import { Button, Input, Spinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { ERRORS, ROLE_HOME } from '../lib/constants'
import { isValidEmail } from '../lib/format'

/** Patrón de puntos muy tenue sobre el degradado azul. */
const DOT_PATTERN = {
  backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.85) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
}

/** Fondo compartido por la pantalla de carga y por la de acceso. */
function LoginBackdrop({ children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-belen-blue via-belen-blue to-belen-blue-dark px-4 py-10">
      <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={DOT_PATTERN} aria-hidden="true" />
      {/* Halo naranja tenue, como el acento de la invitación */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-belen-orange/20 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  )
}

export default function AdminLogin() {
  const { user, isAdmin, role, loading: authLoading, login, logout } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const sessionWithoutPermissions = Boolean(user) && !isAdmin && !authLoading

  // La sesión entró, pero la cuenta no está registrada en admins/{uid}.
  useEffect(() => {
    if (sessionWithoutPermissions) {
      setSubmitting(false)
      setFormError(ERRORS.NOT_ADMIN)
    }
  }, [sessionWithoutPermissions])

  // Ya hay sesión válida: a la pantalla principal según el rol (admin → resumen,
  // agente → sus reservas, seguridad → escáner).
  if (user && isAdmin) {
    return <Navigate to={ROLE_HOME[role] || '/admin'} replace />
  }

  // Comprobando la sesión guardada al abrir la página.
  if (authLoading && !submitting) {
    return (
      <LoginBackdrop>
        <div className="flex flex-col items-center gap-4 text-white">
          <Spinner size="md" />
          <p className="text-sm font-medium">Verificando tu sesión…</p>
        </div>
      </LoginBackdrop>
    )
  }

  const validate = () => {
    const next = { email: '', password: '' }
    const trimmedEmail = email.trim()

    if (!trimmedEmail) next.email = 'Escribe tu correo.'
    else if (!isValidEmail(trimmedEmail)) next.email = 'El correo no tiene un formato válido.'

    if (!password) next.password = 'Escribe tu contraseña.'

    setFieldErrors(next)
    return !next.email && !next.password
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')

    if (!validate()) return

    setSubmitting(true)
    try {
      await login(email.trim(), password)
      // No apagamos `submitting`: el contexto está verificando admins/{uid} y, en cuanto
      // termine, este componente se reemplaza por <Navigate to="/admin" />.
    } catch (error) {
      setSubmitting(false)
      setPassword('')
      setFormError(error?.message || 'No pudimos iniciar sesión. Inténtalo de nuevo.')
    }
  }

  const handleLogout = async () => {
    setSigningOut(true)
    try {
      await logout()
      setFormError('')
      setPassword('')
    } catch (error) {
      setFormError(error?.message || 'No pudimos cerrar la sesión. Inténtalo de nuevo.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <LoginBackdrop>
      <div className="rounded-2xl bg-white p-7 shadow-card sm:p-9">
        <Logo variant="full" className="mx-auto h-32 w-auto" />

        <h1 className="mt-6 text-center font-display text-lg font-extrabold uppercase tracking-tight text-belen-blue sm:text-xl">
          Panel administrativo
        </h1>
        <p className="mt-1.5 text-center text-sm text-slate-500">
          Ingresa con tu cuenta autorizada de Empaques Belén.
        </p>

        <div className="belen-divider my-6">
          <span />
        </div>

        {formError && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{formError}</p>

              {sessionWithoutPermissions && (
                <>
                  {user?.email && (
                    <p className="mt-1 break-all text-xs text-red-600/90">
                      Sesión iniciada como <span className="font-semibold">{user.email}</span>
                    </p>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    icon={LogOut}
                    loading={signingOut}
                    onClick={handleLogout}
                    className="mt-3 w-full sm:w-auto"
                  >
                    <span className="whitespace-normal">Cerrar sesión y usar otra cuenta</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Input
            label="Correo"
            type="email"
            name="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }))
            }}
            error={fieldErrors.email}
            placeholder="admin@empaquesbelen.com"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            inputMode="email"
            disabled={submitting}
            required
          />

          <div className="relative">
            <Input
              label="Contraseña"
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: '' }))
              }}
              error={fieldErrors.password}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={submitting}
              className="pr-12"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-1 top-[1.75rem] flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-belen-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon={LogIn}
            loading={submitting}
            className="w-full"
          >
            Entrar
          </Button>
        </form>
      </div>

      <div className="mt-6 text-center">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Volver al formulario
        </Link>
      </div>
    </LoginBackdrop>
  )
}
