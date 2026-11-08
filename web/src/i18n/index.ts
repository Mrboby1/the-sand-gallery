import { en, type Messages } from './en'

/**
 * Tiny i18n layer. Every UI string goes through t(). To add a language: copy en.ts to e.g. he.ts,
 * translate the values, and register it in `catalogs` below.
 */
const catalogs: Record<string, Messages> = { en }
let current: Messages = en
export let locale = 'en'

export function setLocale(l: string) {
  if (catalogs[l]) {
    current = catalogs[l]
    locale = l
    document.documentElement.lang = l
  }
}

export type MsgKey = keyof Messages

export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  let s: string = current[key] ?? en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

/** Picks base.one / base.other: tn('item.subitems', n). */
export function tn(base: string, n: number, vars?: Record<string, string | number>): string {
  const key = (n === 1 ? `${base}.one` : `${base}.other`) as MsgKey
  return t(key, { n, ...vars })
}
