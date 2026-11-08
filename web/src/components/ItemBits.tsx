import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Copy, CornerDownRight, FilePlus2, Hash, Layers, Link2, Plus, X } from 'lucide-react'
import type { Item } from '../lib/types'
import {
  useApp, childrenOf, createItem, createShare, descendantIds, moveItem, revokeShare, shareUrl, toast, updateItem, findTemplateByName, saveAsTemplate,
} from '../store/app'
import { Button, Input, Sheet, confirmDialog, cx, promptDialog } from './ui'
import { t } from '../i18n'

// ---------------------------------------------------------------- templates
/** Asks for a name (prefilled with the item title) and saves; a same-named template is replaced after a confirm. */
export async function saveTemplateFlow(item: Item) {
  const name = await promptDialog(t('item.saveTemplate'), item.title, t('common.save'))
  if (!name) return
  const dup = findTemplateByName(name)
  if (dup && !(await confirmDialog(t('item.templateReplace', { name: dup.name }), { okLabel: t('item.templateReplaceOk') }))) return
  await saveAsTemplate(item.id, name)
}

// ---------------------------------------------------------------- tags
export function allTags(items: Item[]): string[] {
  const s = new Set<string>()
  for (const i of items) for (const tg of i.tags) s.add(tg)
  return [...s].sort((a, b) => a.localeCompare(b))
}

export function TagEditor({ item }: { item: Item }) {
  const items = useApp((s) => s.data.items)
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')
  const suggestions = useMemo(() => allTags(items).filter((tg) => !item.tags.includes(tg) && tg.toLowerCase().includes(val.toLowerCase())).slice(0, 6), [items, item.tags, val])
  const add = (tag: string) => {
    const clean = tag.trim().replace(/^#/, '').toLowerCase()
    if (clean && !item.tags.includes(clean)) void updateItem(item.id, { tags: [...item.tags, clean] })
    setVal('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.tags.map((tg) => (
        <span key={tg} className="group inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 pl-2.5 pr-1 text-[13px] text-ink/90">
          <Hash size={12} className="text-muted" />{tg}
          <button aria-label={`Remove ${tg}`} onClick={() => updateItem(item.id, { tags: item.tags.filter((x) => x !== tg) })} className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink">
            <X size={12} />
          </button>
        </span>
      ))}
      {adding ? (
        <div className="relative">
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(val) }
              if (e.key === 'Escape') { setAdding(false); setVal('') }
            }}
            onBlur={() => setTimeout(() => { if (val.trim()) add(val); setAdding(false) }, 150)}
            placeholder={t('item.addTag')}
            className="h-7 w-32 rounded-full border border-accent bg-surface px-3 text-[13px] outline-none"
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 top-8 z-30 min-w-40 rounded-xl border border-line bg-surface p-1 shadow-lift">
              {suggestions.map((s) => (
                <button key={s} onMouseDown={(e) => { e.preventDefault(); add(s) }} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2">#{s}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-[13px] text-muted transition hover:border-accent hover:text-accent-strong">
          <Plus size={13} /> {t('item.addTag')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- new item
/** New item dialog. `stay`: keep the current page (adding several subtasks) and offer Open in a toast. */
export function NewItemSheet({ open, onClose, parentId, stay }: { open: boolean; onClose: () => void; parentId: string | null; stay?: boolean }) {
  const templates = useApp((s) => s.data.templates)
  const [title, setTitle] = useState('')
  const [tpl, setTpl] = useState<string | null>(null)
  const nav = useNavigate()
  const submit = async () => {
    const id = await createItem(parentId, title.trim(), tpl ?? undefined)
    const made = useApp.getState().data.items.find((i) => i.id === id)
    setTitle(''); setTpl(null); onClose()
    if (stay) toast(t('item.created', { title: made?.title ?? '' }), 'info', { label: t('share.open'), run: () => nav(`/i/${id}`) })
    else nav(`/i/${id}`)
  }
  return (
    <Sheet open={open} onClose={onClose} title={parentId ? t('item.newSub') : t('item.new')}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="flex flex-col gap-4">
        <Input autoFocus dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tpl ? templates.find((x) => x.id === tpl)?.item_title : t('item.titlePlaceholder')} className="h-12 text-lg" />
        {templates.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] font-medium text-muted">{t('item.fromTemplate')}</div>
            <div className="flex flex-wrap gap-2">
              <TplChip active={!tpl} onClick={() => setTpl(null)} icon={<FilePlus2 size={14} />}>{t('item.blank')}</TplChip>
              {templates.map((x) => (
                <TplChip key={x.id} active={tpl === x.id} onClick={() => setTpl(x.id)} icon={<Layers size={14} />}>
                  <span dir="auto">{x.name}</span> <span className="opacity-60">· {countNodes(x.tree)}</span>
                </TplChip>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!title.trim() && !tpl}>{t('common.create')}</Button>
        </div>
      </form>
    </Sheet>
  )
}
function countNodes(n: { children?: unknown[] }[]): number {
  return n.reduce((k, x) => k + 1 + countNodes((x.children ?? []) as { children?: unknown[] }[]), 0)
}
function TplChip({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition', active ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line hover:bg-surface-2')}>
      {icon}{children}
    </button>
  )
}

// ---------------------------------------------------------------- move
export function MoveSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const items = useApp((s) => s.data.items)
  const banned = useMemo(() => new Set([item.id, ...descendantIds(items, item.id)]), [items, item.id])
  const render = (parent: string | null, depth: number): React.ReactNode[] =>
    childrenOf(items, parent).filter((c) => !banned.has(c.id)).flatMap((c) => [
      <button
        key={c.id}
        onClick={() => { void moveItem(item.id, c.id); onClose() }}
        disabled={item.parent_id === c.id}
        className="flex w-full items-center gap-2 rounded-xl py-2 pr-3 text-left text-sm hover:bg-surface-2 disabled:opacity-40"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        {depth > 0 && <CornerDownRight size={13} className="text-muted" />}
        <span className="truncate">{c.title}</span>
      </button>,
      ...render(c.id, depth + 1),
    ])
  return (
    <Sheet open onClose={onClose} title={t('item.move')}>
      <div className="max-h-[60vh] overflow-y-auto">
        <button onClick={() => { void moveItem(item.id, null); onClose() }} disabled={!item.parent_id} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-surface-2 disabled:opacity-40">
          <ChevronRight size={14} /> {t('item.moveRoot')}
        </button>
        {render(null, 0)}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- share
export function ShareSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const allLinks = useApp((s) => s.data.share_links)
  const links = allLinks.filter((l) => l.item_id === item.id && !l.revoked_at)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (url: string, id: string) => {
    try { await navigator.clipboard.writeText(url) } catch { /* ignore */ }
    setCopied(id)
    toast(t('share.copied'))
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <Sheet open onClose={onClose} title={t('share.title')}>
      <p className="mb-4 text-[15px] leading-relaxed text-muted">{t('share.body', { title: item.title })}</p>
      <div className="flex flex-col gap-2">
        {links.map((l) => {
          const url = shareUrl(l)
          return (
            <div key={l.id} className="rounded-2xl bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2 truncate text-sm"><Link2 size={14} className="shrink-0 text-accent" /><span className="truncate tabular">{url}</span></div>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => copy(url, l.id)}>{copied === l.id ? <Check size={14} /> : <Copy size={14} />} {t('share.copy')}</Button>
                <Button size="sm" variant="outline" onClick={() => window.open(url, '_blank', 'noopener')}>{t('share.open')}</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => { void revokeShare(l.id); toast(t('share.revoked')) }}>{t('share.revoke')}</Button>
              </div>
            </div>
          )
        })}
        {!links.length && (
          <Button variant="primary" size="lg" disabled={busy} onClick={async () => { setBusy(true); try { const l = await createShare(item.id); await copy(shareUrl(l), l.id) } finally { setBusy(false) } }}>
            <Link2 size={18} /> {t('share.create')}
          </Button>
        )}
      </div>
    </Sheet>
  )
}
