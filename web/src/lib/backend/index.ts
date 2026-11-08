import { CLOUD } from '../../cloud.config'
import { LocalBackend } from './local'
import { SupabaseBackend } from './supabase'
import type { Backend } from './types'

function pick(): Backend {
  const forced = import.meta.env.VITE_BACKEND as string | undefined
  let localFlag = false
  try { localFlag = localStorage.getItem('sg.backend') === 'local' } catch { /* ignore */ }
  if (CLOUD && forced !== 'local' && !localFlag) return new SupabaseBackend(CLOUD)
  return new LocalBackend()
}

export const backend: Backend = pick()
export type { Backend } from './types'
