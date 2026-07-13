import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CalendarCheck,
  UserCheck,
  ScanLine,
  Users,
  Settings,
  Menu,
  X,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import Logo from './Logo'

/** Navegación del panel. `end` limita la coincidencia exacta del índice (/admin). */
const NAV_ITEMS = [
  { to: '/admin', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/admin/reservations', label: 'Reservas', icon: CalendarCheck },
  { to: '/admin/attendance', label: 'Asistencia', icon: UserCheck },
  { to: '/admin/scanner', label: 'Escáner', icon: ScanLine },
  { to: '/admin/agents', label: 'Agentes', icon: Users },
  { to: '/admin/settings', label: 'Ajustes', icon: Settings },
]

/** Título de la sección actual a partir de la ruta. */
function sectionTitle(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/admin'
  const match = NAV_ITEMS.filter((item) => item.to === clean || clean.startsWith(`${item.to}/`)).sort(
    (a, b) => b.to.length - a.to.length
  )[0]
  return match ? match.label : 'Panel'
}

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // Cierra el cajón al navegar.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Cierra el cajón con Escape y bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    if (!menuOpen) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [menuOpen])

  const handleLogout = async () => {
    setSigningOut(true)
    try {
      await logout()
    } finally {
      setSigningOut(false)
    }
  }

  const linkClasses = ({ isActive }) =>
    [
      'flex items-center gap-3 border-l-4 px-4 py-3 text-sm font-semibold transition-colors',
      isActive
        ? 'border-belen-orange bg-white/10 text-white'
        : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white',
    ].join(' ')

  return (
    <div className="min-h-screen bg-belen-cream">
      {/* Fondo oscuro del cajón (solo móvil) */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-belen-ink/50 md:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Barra lateral: fija en escritorio, cajón deslizante en móvil */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-belen-blue transition-transform duration-200 ease-out md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        aria-label="Navegación del panel"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-5">
          <div className="rounded-xl bg-white px-3 py-2 shadow-card">
            <Logo variant="compact" className="h-8 w-auto" />
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="px-4 pb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-belen-orange">
          Día del Cliente
        </p>

        <nav className="flex-1 overflow-y-auto pb-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClasses}>
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/50">Administrador</p>
          <p className="mt-1 break-all text-sm font-medium text-white" title={user?.email || ''}>
            {user?.email || 'Sin correo'}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={signingOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </aside>

      {/* Columna de contenido */}
      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-belen-blue/10 bg-white/95 px-4 py-3 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-belen-blue transition-colors hover:bg-belen-blue/5 md:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>

          <h1 className="font-display text-lg font-extrabold uppercase tracking-tight text-belen-blue md:text-xl">
            {sectionTitle(location.pathname)}
          </h1>

          <span className="ml-auto hidden text-xs font-semibold uppercase tracking-[0.18em] text-belen-orange sm:block">
            Conexiones que impulsan
          </span>
        </header>

        <main className="p-4 md:p-8 max-w-7xl mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
