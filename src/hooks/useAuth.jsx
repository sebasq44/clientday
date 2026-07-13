import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { COL } from '../lib/constants'
import { ensureSeedData } from '../lib/seed'

/**
 * Traducción de los códigos de error de Firebase Auth a mensajes en español
 * listos para mostrarle al administrador.
 */
const AUTH_ERROR_MESSAGES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/missing-email': 'Escribe tu correo.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada. Contacta al administrador.',
  'auth/too-many-requests':
    'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.',
  'auth/network-request-failed':
    'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
  'auth/operation-not-allowed':
    'El inicio de sesión con correo y contraseña está deshabilitado en Firebase.',
  'auth/internal-error': 'Ocurrió un error inesperado al iniciar sesión. Inténtalo de nuevo.',
}

/** Devuelve el mensaje en español correspondiente al código de error de Firebase. */
export function translateAuthError(code) {
  return AUTH_ERROR_MESSAGES[code] || 'No pudimos iniciar sesión. Inténtalo de nuevo.'
}

const AuthContext = createContext({
  user: null,
  isAdmin: false,
  loading: true,
  login: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // Evita ejecutar el seed más de una vez por sesión de administrador.
  const seededUidRef = useRef(null)
  // Descarta respuestas de comprobaciones de admin que ya quedaron obsoletas.
  const authRunRef = useRef(0)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const run = ++authRunRef.current

      if (!firebaseUser) {
        seededUidRef.current = null
        setUser(null)
        setIsAdmin(false)
        setLoading(false)
        return
      }

      setLoading(true)

      let admin = false
      try {
        const adminSnap = await getDoc(doc(db, COL.ADMINS, firebaseUser.uid))
        admin = adminSnap.exists()
      } catch (error) {
        // Sin permisos de lectura o sin red: tratamos al usuario como NO administrador.
        admin = false
        console.error('No se pudo verificar los permisos de administrador:', error)
      }

      // Otro cambio de sesión ocurrió mientras consultábamos: descartamos este resultado.
      if (run !== authRunRef.current) return

      setUser(firebaseUser)
      setIsAdmin(admin)
      setLoading(false)

      if (admin && seededUidRef.current !== firebaseUser.uid) {
        seededUidRef.current = firebaseUser.uid
        try {
          await ensureSeedData()
        } catch (error) {
          // Un fallo del seed no debe tumbar el panel: la configuración puede crearse a mano.
          console.error('No se pudieron crear los datos iniciales (config/general, counters):', error)
        }
      }
    })

    return unsubscribe
  }, [])

  const login = useCallback(async (email, password) => {
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        String(email || '').trim(),
        String(password || '')
      )
      return credential.user
    } catch (error) {
      throw new Error(translateAuthError(error?.code))
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Error al cerrar sesión:', error)
      throw new Error('No pudimos cerrar la sesión. Inténtalo de nuevo.')
    }
  }, [])

  const value = useMemo(
    () => ({ user, isAdmin, loading, login, logout }),
    [user, isAdmin, loading, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Acceso al contexto de sesión: { user, isAdmin, loading, login, logout } */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  }
  return context
}
