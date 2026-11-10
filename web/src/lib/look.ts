import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../store/app'
import { DEFAULT_HUES, applyColors, type CustomColors } from './customColors'
import type { Item, Settings } from './types'

/**
 * Per-project looks.
 * - settings.look_mode 'same': one look (the colour settings) everywhere.
 * - 'separate': a project (an item at the top level or directly in a folder) may have its own colours in items.look;
 *   until it is changed it uses the global look. Switching back to 'same' keeps every project's look, unused.
 * - A project's subtasks either share its look ('same') or step their sand colour through a gradient from the
 *   project's sand to a second colour, evenly across the subtasks in order ('gradient').
 * Theme and style stay per device; only the colours are per project.
 */
export interface SubtaskLook { mode: 'same' | 'gradient'; hue: number; light: number }
export type ProjectLook = Partial<CustomColors> & { sub?: SubtaskLook }

export const COLOR_KEYS = ['hg_hue', 'sand_hue', 'bg_hue', 'freeze_hue', 'hg_light', 'sand_light', 'bg_light', 'freeze_light'] as const

export function globalColors(s: Partial<Settings>): CustomColors {
  return {
    hg_hue: s.hg_hue ?? null, sand_hue: s.sand_hue ?? null, bg_hue: s.bg_hue ?? null, freeze_hue: s.freeze_hue ?? null,
    hg_light: s.hg_light ?? null, sand_light: s.sand_light ?? null, bg_light: s.bg_light ?? null, freeze_light: s.freeze_light ?? null,
  }
}

/** The project an item belongs to (itself if it is one): walk up until the parent is a folder or the top. */
export function projectOf(id: string, byId: Map<string, Item>): Item | undefined {
  let it = byId.get(id)
  for (let n = 0; it && n < 60; n++) {
    if (it.kind === 'folder') return undefined
    const parent = it.parent_id ? byId.get(it.parent_id) : undefined
    if (!parent || parent.kind === 'folder') return it
    it = parent
  }
  return undefined
}

/** A project's subtasks in reading order (depth first, by sort order). */
export function subtaskOrder(projectId: string, items: Item[]): string[] {
  const kids = new Map<string, Item[]>()
  for (const i of items) if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i])
  const out: string[] = []
  const walk = (id: string, depth = 0) => { if (depth > 60) return; for (const k of (kids.get(id) ?? []).sort((a, b) => a.sort_order - b.sort_order)) { out.push(k.id); walk(k.id, depth + 1) } }
  walk(projectId)
  return out
}

/** The project's own colours (its look, else the global ones). */
export function projectColors(project: Item, global: CustomColors): CustomColors {
  const look = (project.look ?? null) as ProjectLook | null
  if (!look) return global
  const c = { ...global }
  for (const k of COLOR_KEYS) if (k in look) (c as Record<string, number | null>)[k] = (look as Record<string, number | null | undefined>)[k] ?? null
  return c
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Hue the short way round the colour wheel. */
const lerpHue = (a: number, b: number, t: number) => { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360 }

/** The colours to show for an item (null = no item: the global look). */
export function effectiveColors(itemId: string | null, items: Item[], settings: Partial<Settings>): CustomColors {
  const global = globalColors(settings)
  if (!itemId || settings.look_mode !== 'separate') return global
  const byId = new Map(items.map((i) => [i.id, i]))
  const project = projectOf(itemId, byId)
  if (!project) return global
  const base = projectColors(project, global)
  const sub = ((project.look ?? null) as ProjectLook | null)?.sub
  if (project.id === itemId || !sub || sub.mode !== 'gradient') return base
  const order = subtaskOrder(project.id, items)
  const idx = order.indexOf(itemId)
  if (idx < 0 || !order.length) return base
  const t = (idx + 1) / order.length // the last subtask reaches the second colour
  const fromHue = base.sand_hue ?? DEFAULT_HUES.sand, fromLight = base.sand_light ?? 0
  return { ...base, sand_hue: Math.round(lerpHue(fromHue, sub.hue, t)), sand_light: Math.round(lerp(fromLight, sub.light, t)) }
}

/** Applies the look for the page that is open (a project and its subtasks may have their own). */
export function LookApplier() {
  const loc = useLocation()
  const items = useApp((s) => s.data.items)
  const settings = useApp((s) => s.data.settings)
  const phase = useApp((s) => s.phase)
  const itemId = loc.pathname.startsWith('/i/') ? loc.pathname.slice(3).split('/')[0] : null
  const colors = useMemo(() => effectiveColors(itemId, items, settings), [itemId, items, settings])
  const key = JSON.stringify(colors)
  useEffect(() => { if (phase === 'ready') applyColors(colors) }, [key, phase]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
