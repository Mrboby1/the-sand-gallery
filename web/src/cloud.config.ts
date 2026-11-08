// Public cloud configuration (safe to commit: the Supabase anon key and URL are public by design).
// Filled in from infra/CLOUD.md. When null, the app runs on the local (browser-only) backend.
import type { CloudConfig } from './lib/backend/supabase'

export const CLOUD: CloudConfig | null = null
