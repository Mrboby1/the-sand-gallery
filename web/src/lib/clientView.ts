import { useSyncExternalStore } from 'react'

// "Client view": hides costs and prices on finished items, so the gallery can be shown to a client.
// Remembered per device.
const KEY = 'sg.clientView'
const listeners = new Set<() => void>()

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setClientView(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* ignore */ }
  listeners.forEach((l) => l())
}

export function useClientView(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => void listeners.delete(cb) }, read, () => false)
}
