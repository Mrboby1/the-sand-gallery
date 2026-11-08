// Public cloud configuration (safe to commit: the Supabase anon key and URL are public by design).
// From infra/CLOUD.md. Set to null (or localStorage sg.backend=local) to run on the local browser-only backend.
import type { CloudConfig } from './lib/backend/supabase'

export const CLOUD: CloudConfig | null = {
  supabaseUrl: 'https://etpckqbzxaqbupvatcuy.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cGNrcWJ6eGFxYnVwdmF0Y3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTQzNDgsImV4cCI6MjEwOTczMDM0OH0.B0nGdU06yayLXeTo8k8RlmaqFu3KJT3YrxCSyUd17Ls',
  workerUrl: 'https://api.thesandgallery.workers.dev',
}
