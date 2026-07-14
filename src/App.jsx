import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/ui/Toast'
import ProtectedRoute from './components/ProtectedRoute'
import AdminLayout from './components/AdminLayout'
import { ROLE } from './lib/constants'

import PublicForm from './pages/PublicForm'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminReservations from './pages/AdminReservations'
import AdminAgents from './pages/AdminAgents'
import AdminSettings from './pages/AdminSettings'
import AdminScanner from './pages/AdminScanner'
import AdminAttendance from './pages/AdminAttendance'
import AdminUsers from './pages/AdminUsers'

// Rutas donde entran los tres roles.
const ALL_ROLES = [ROLE.SUPERADMIN, ROLE.AGENTE, ROLE.SEGURIDAD]
// Rutas exclusivas del administrador general.
const SUPER_ONLY = [ROLE.SUPERADMIN]
// El escáner de la puerta es SOLO para seguridad (y el administrador). Los agentes de ventas
// no escanean entradas.
const SCANNER_ROLES = [ROLE.SUPERADMIN, ROLE.SEGURIDAD]

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          {/* Público */}
          <Route path="/" element={<PublicForm />} />
          <Route path="/admin/login" element={<AdminLogin />} />

          {/* Panel administrador */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            {/* Solo el administrador general */}
            <Route
              index
              element={
                <ProtectedRoute roles={SUPER_ONLY}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="agents"
              element={
                <ProtectedRoute roles={SUPER_ONLY}>
                  <AdminAgents />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute roles={SUPER_ONLY}>
                  <AdminSettings />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute roles={SUPER_ONLY}>
                  <AdminUsers />
                </ProtectedRoute>
              }
            />

            {/* Los tres roles. La propia página adapta lo que cada rol puede ver/hacer. */}
            <Route
              path="reservations"
              element={
                <ProtectedRoute roles={ALL_ROLES}>
                  <AdminReservations />
                </ProtectedRoute>
              }
            />
            <Route
              path="scanner"
              element={
                <ProtectedRoute roles={SCANNER_ROLES}>
                  <AdminScanner />
                </ProtectedRoute>
              }
            />
            <Route
              path="attendance"
              element={
                <ProtectedRoute roles={ALL_ROLES}>
                  <AdminAttendance />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  )
}
