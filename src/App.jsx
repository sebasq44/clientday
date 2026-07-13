import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/ui/Toast'
import ProtectedRoute from './components/ProtectedRoute'
import AdminLayout from './components/AdminLayout'

import PublicForm from './pages/PublicForm'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminReservations from './pages/AdminReservations'
import AdminAgents from './pages/AdminAgents'
import AdminSettings from './pages/AdminSettings'
import AdminScanner from './pages/AdminScanner'
import AdminAttendance from './pages/AdminAttendance'

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
            <Route index element={<AdminDashboard />} />
            <Route path="reservations" element={<AdminReservations />} />
            <Route path="agents" element={<AdminAgents />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="scanner" element={<AdminScanner />} />
            <Route path="attendance" element={<AdminAttendance />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  )
}
