// Dev-only demo data for the LOCAL backend (open the app with ?seed=1). Never used in the cloud build path.
import { backend } from '../lib/backend'
import type { Item, Media, Session } from '../lib/types'
import { makeUploadParts } from '../lib/media'

const palettes = [
  ['#f6d38b', '#d9822b', '#7a3b12'],
  ['#9ad1e6', '#2f6f9f', '#13324e'],
  ['#c9e7c0', '#5f9e6e', '#23452c'],
  ['#f2b8a2', '#c0564a', '#4b1c18'],
  ['#e5d4f5', '#9b87c9', '#3b2a5c'],
  ['#fbe7c6', '#e0a458', '#6b4a2b'],
]

/** Paints a soft "glass object on a table" picture so tiles look like real photos. */
async function fakePhoto(seed: number, w = 960, h = 1200): Promise<File> {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  const [a, b, d] = palettes[seed % palettes.length]
  g.fillStyle = '#efe6d8'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#d8c6aa'; g.fillRect(0, h * 0.63, w, h)
  const cx = w / 2 + ((seed * 37) % 120) - 60
  const cy = h * 0.5
  const shapes = seed % 3
  // shadow
  g.fillStyle = '#c4ae8d'
  g.beginPath(); g.ellipse(cx, h * 0.66, w * 0.24, 26, 0, 0, Math.PI * 2); g.fill()
  // body
  g.fillStyle = b
  void a; void d
  g.beginPath()
  if (shapes === 0) { // cup
    g.moveTo(cx - 170, cy - 230); g.lineTo(cx + 170, cy - 230); g.quadraticCurveTo(cx + 160, cy + 120, cx + 90, cy + 160); g.lineTo(cx - 90, cy + 160); g.quadraticCurveTo(cx - 160, cy + 120, cx - 170, cy - 230)
  } else if (shapes === 1) { // vase
    g.moveTo(cx - 60, cy - 300); g.lineTo(cx + 60, cy - 300); g.bezierCurveTo(cx + 40, cy - 150, cx + 230, cy - 40, cx + 120, cy + 160); g.lineTo(cx - 120, cy + 160); g.bezierCurveTo(cx - 230, cy - 40, cx - 40, cy - 150, cx - 60, cy - 300)
  } else { // bowl
    g.moveTo(cx - 260, cy - 40); g.lineTo(cx + 260, cy - 40); g.bezierCurveTo(cx + 250, cy + 120, cx + 120, cy + 160, cx, cy + 165); g.bezierCurveTo(cx - 120, cy + 160, cx - 250, cy + 120, cx - 260, cy - 40)
  }
  g.closePath(); g.fill()
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.86))
  return new File([blob], `photo-${seed}.jpg`, { type: 'image/jpeg' })
}

export async function seedDemo() {
  if (backend.mode !== 'local') return
  await backend.signInWithGoogle()
  const snap = await backend.loadAll()
  if (snap.items.length) return
  const st = Object.fromEntries(snap.statuses.map((s) => [s.name, s.id]))
  const now = Date.now()
  const H = 3_600_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const items: Item[] = []
  const mk = (title: string, parent: string | null, status: string, tags: string[] = [], extra: Partial<Item> = {}) => {
    const it: Item = {
      id: crypto.randomUUID(), parent_id: parent, title, notes: '', status_id: st[status] ?? null, tags, due_date: null,
      cover_media_id: null, sort_order: items.filter((i) => i.parent_id === parent).length + 1,
      created_at: iso(now - (40 - items.length) * 86400_000), updated_at: iso(now - items.length * 3600_000), ...extra,
    }
    items.push(it)
    return it
  }
  const set = mk('Amber tea set', null, 'In progress', ['set', 'amber'], { notes: 'Six cups + teapot for Maya. Amber frit, clear overlay.\n\nAnneal 482°C, 1h soak.' })
  const cups = [1, 2, 3, 4].map((n) => mk(`Cup ${n}`, set.id, n <= 2 ? 'Done' : n === 3 ? 'In progress' : 'Idea', ['cup']))
  for (const c of cups) for (const s of ['Gather & shape', 'Handle', 'Cold work']) mk(s, c.id, c.status_id === st['Done'] ? 'Done' : 'Idea')
  const pot = mk('Teapot', set.id, 'On hold', ['teapot'])
  const vase = mk('Cobalt wave vase', null, 'Done', ['vase', 'blue'], { due_date: new Date(now + 5 * 86400_000).toISOString().slice(0, 10) })
  const bowls = mk('Sea-glass bowls', null, 'Sold', ['bowl', 'green'])
  mk('Large bowl', bowls.id, 'Sold'); mk('Small bowl', bowls.id, 'Sold')
  const lamp = mk('Lamp shade idea', null, 'Idea', ['lamp'])
  const ruby = mk('Ruby goblets', null, 'In progress', ['goblet', 'red'])
  const lilac = mk('Lilac pendant', null, 'Done', ['jewelry'])
  await backend.insert('items', items)
  await backend.insert('notes', items.filter((i) => i.notes).map((i) => ({ id: crypto.randomUUID(), item_id: i.id, body: i.notes, pinned: false, created_at: i.created_at, updated_at: i.updated_at })))

  const sessions: Session[] = []
  const sess = (it: Item, daysAgo: number, startH: number, hours: number) => {
    const d = new Date(now - daysAgo * 86400_000); d.setHours(startH, 0, 0, 0)
    sessions.push({ id: crypto.randomUUID(), item_id: it.id, started_at: iso(d.getTime()), ended_at: iso(d.getTime() + hours * H) })
  }
  sess(set, 9, 10, 1.5); sess(cups[0], 6, 9, 2.25); sess(cups[1], 5, 14, 1.75); sess(cups[2], 2, 10, 2.5); sess(cups[2], 1, 16, 1.1)
  sess(vase, 12, 11, 3.2); sess(vase, 3, 9, 1.4); sess(bowls, 20, 13, 4); sess(ruby, 4, 15, 2); sess(lilac, 8, 18, 0.8); sess(pot, 15, 10, 1)
  await backend.insert('sessions', sessions)

  const covers: [Item, number][] = [[set, 5], [cups[0], 0], [cups[1], 5], [cups[2], 0], [vase, 1], [bowls, 2], [ruby, 3], [lilac, 4], [pot, 5]]
  const media: Media[] = []
  for (const [it, seed] of covers) {
    const n = it === set ? 4 : it === vase ? 3 : 1
    for (let k = 0; k < n; k++) {
      const f = await fakePhoto(seed + k * 7)
      const prep = await makeUploadParts(f)
      const res = await backend.uploadMedia(it.id, prep.parts)
      media.push({ id: crypto.randomUUID(), item_id: it.id, object_key: res.object_key, thumb_key: res.thumb_key, kind: 'photo', mime: f.type, size_bytes: f.size, width: prep.width, height: prep.height, duration_s: null, phase: k === 0 ? 'finished' : 'process', created_at: iso(now - k * 3600_000) })
    }
  }
  await backend.insert('media', media)
  for (const [it] of covers) {
    const m = media.find((x) => x.item_id === it.id)
    if (m) await backend.update('items', it.id, { cover_media_id: m.id })
  }
  void lamp
  await backend.insert('cost_lines', [
    { id: crypto.randomUUID(), item_id: set.id, label: 'Amber frit', qty: 2, unit_cost: 45, created_at: iso(now) },
    { id: crypto.randomUUID(), item_id: set.id, label: 'Clear rod (kg)', qty: 3, unit_cost: 28, created_at: iso(now) },
    { id: crypto.randomUUID(), item_id: cups[0].id, label: 'Gas', qty: 1, unit_cost: 12, created_at: iso(now) },
  ])
  await backend.insert('templates', [{ id: crypto.randomUUID(), name: 'New cup', item_title: 'Cup', tags: ['cup'], tree: [{ title: 'Gather & shape' }, { title: 'Handle' }, { title: 'Cold work' }], created_at: iso(now) }])
  await backend.saveSettings({ ...snap.settings, hourly_rate: 120, currency: 'ILS', markup_pct: 15 })
}
