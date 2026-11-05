import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

// Los valores van en un archivo .env (local) y en Environment Variables (Vercel).
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Sin databaseURL no hay conexión: la app arranca en modo simulación.
export const db = cfg.databaseURL ? getDatabase(initializeApp(cfg)) : null
