import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Folder as FolderIcon, FolderInput, FolderPlus, Link2, MoreHorizontal, Pencil, SquarePlus, Trash2 } from 'lucide-react'
import type { Item, Media } from '../lib/types'
import { useApp, childrenOf, deleteWithUndo, moveItem, updateItem } from '../store/app'
import { useCoverFor, useTotals } from '../lib/hooks'
import { fmtDuration } from '../lib/time'
import { Thumb } from './Tile'
import { AlbumTile } from './FinishedView'
import { ItemPress } from './ItemMenu'
import { MediaSection } from './MediaGrid'
import { NotesTab } from './Tabs'
import { AddMenu } from './AddMenu'
import { TopBar } from './Shell'
import { MoveSheet, NewItemSheet, ShareSheet } from './ItemBits'
import { Button, Menu, MenuItem, Sheet, cx, promptDialog } from './ui'
import { t, tn } from '../i18n'

export const isFolder = (i: { kind?: string } | null | undefined) => i?.kind === 'folder'

/** Folders first, then projects, each in their saved order. */
export function foldersFirst<T extends { kind?: string; sort_order: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || a.sort_order - b.sort_order)
}

const TILT = [-7, 1.5, 8]
const LEFT = [6, 29, 52]

/**
 * The look of a folder: a tab and a back panel, up to three pictures of what is inside peeking out, and the front
 * flap. Pure presentation (also used on share pages, with plain <img>s).
 */
export function FolderShape({ thumbs, size = 'm', count }: { thumbs: ReactNode[]; size?: 's' | 'm' | 'l'; count?: number }) {
  const r = size === 's' ? 'rounded-[12px]' : 'rounded-[18px]'
  const papers = thumbs.length ? thumbs : [null, null]
  return (
    <div className="folder relative aspect-[6/5]">
      <div className={cx('folder-back absolute left-0 top-0 h-[17%] w-[44%] rounded-t-[12px]')} />
      <div className={cx('folder-back absolute inset-x-0 bottom-0 top-[9%] rounded-tl-none', r)} />
      {papers.slice(0, 3).map((th, i) => (
        <div
          key={i}
          className="folder-paper absolute overflow-hidden rounded-[8px] bg-surface shadow-sm ring-2 ring-surface transition duration-300 group-hover:-translate-y-[6%]"
          style={{ left: `${papers.length === 1 ? 29 : papers.length === 2 ? LEFT[i] + 11 : LEFT[i]}%`, top: `${i === 1 ? 4 : 8}%`, width: '42%', height: '56%', transform: `rotate(${TILT[papers.length === 1 ? 1 : i]}deg)` }}
        >
          {th ?? <div className="h-full w-full bg-surface" />}
        </div>
      ))}
      <div className={cx('folder-front absolute inset-x-0 bottom-0 h-[52%] overflow-hidden transition-[height] duration-300 group-hover:h-[49%]', r)}>
        <div className="gloss-only pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 via-white/5 to-transparent" />
        {!!count && size !== 's' && (
          <span className="absolute bottom-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[11.5px] font-medium tabular text-ink/75">
            <FolderIcon size={11} /> {count}
          </span>
        )}
      </div>
    </div>
  )
}

/** Up to three pictures for a folder: covers of what is inside, then the folder's own photos. */
export function useFolderThumbs() {
  const items = useApp((s) => s.data.items)
  const media = useApp((s) => s.data.media)
  const covers = useCoverFor()
  return useMemo(() => (folder: Item): Media[] => {
    const out: Media[] = []
    const seen = new Set<string>()
    for (const k of foldersFirst(childrenOf(items, folder.id)).reverse()) {
      const c = covers.cover(k)
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c) }
      if (out.length >= 3) break
    }
    if (out.length < 3) {
      const own = media.filter((m) => m.item_id === folder.id && !seen.has(m.id)).sort((a, b) => b.created_at.localeCompare(a.created_at))
      out.push(...own.slice(0, 3 - out.length))
    }
    return out
  }, [items, media, covers])
}

export function FolderTile({ item, size = 'm' }: { item: Item; size?: 's' | 'm' | 'l' }) {
  const thumbsFor = useFolderThumbs()
  const covers = useCoverFor()
  const kids = covers.countKids(item.id)
  const photos = covers.countMedia(item.id)
  return (
    <Link to={`/i/${item.id}`} className="group rise block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label={t('folder.aria', { title: item.title })}>
      <FolderShape size={size} count={kids} thumbs={thumbsFor(item).map((m) => <Thumb key={m.id} media={m} alt="" className="h-full w-full object-[50%_62%]" />)} />
      <div className={cx('px-0.5', size === 's' ? 'pt-1.5' : 'pt-2.5')}>
        <div dir="auto" className={cx('font-display font-semibold leading-snug [overflow-wrap:anywhere]', size === 's' ? 'line-clamp-1 text-[12.5px]' : size === 'm' ? 'line-clamp-2 text-[16px]' : 'line-clamp-2 text-[18px]')}>{item.title}</div>
        {size !== 's' && (
          <div className="mt-0.5 text-[12.5px] text-muted">
            {kids ? tn('folder.items', kids) : t('folder.empty')}{photos ? ` · ${tn('item.media', photos)}` : ''}
          </div>
        )}
      </div>
    </Link>
  )
}

export function FolderRow({ item, path }: { item: Item; path?: string }) {
  const covers = useCoverFor()
  const kids = covers.countKids(item.id)
  return (
    <Link to={`/i/${item.id}`} className="rise flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-surface-2">
      <div className="folder-back flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-accent-strong"><FolderIcon size={24} strokeWidth={1.7} /></div>
      <div className="min-w-0 flex-1">
        <div dir="auto" className="truncate font-medium">{item.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted">{path ? `${path} · ` : ''}{kids ? tn('folder.items', kids) : t('folder.empty')}</div>
      </div>
    </Link>
  )
}

/** Delete a folder: move what is inside out to the parent, or delete everything. */
export function FolderDeleteSheet({ item, onClose, onDeleted }: { item: Item; onClose: () => void; onDeleted?: () => void }) {
  const items = useApp((s) => s.data.items)
  const kids = childrenOf(items, item.id)
  const parent = item.parent_id ? items.find((i) => i.id === item.parent_id) : undefined
  const where = parent?.title ?? t('nav.home')
  return (
    <Sheet open onClose={onClose} title={t('folder.deleteTitle')}>
      <p className="mb-4 text-[15px] leading-relaxed text-muted">
        {kids.length ? t('folder.deleteBody', { title: item.title, n: tn('folder.items', kids.length) }) : t('folder.deleteEmpty', { title: item.title })}
      </p>
      <div className="flex flex-col gap-2">
        {kids.length > 0 && (
          <Button
            variant="primary"
            onClick={async () => {
              onClose()
              for (const k of kids) await moveItem(k.id, item.parent_id)
              onDeleted?.()
              deleteWithUndo(item.id)
            }}
          >
            <FolderInput size={16} /> {t('folder.deleteKeep', { where })}
          </Button>
        )}
        <Button variant="danger" onClick={() => { onClose(); onDeleted?.(); deleteWithUndo(item.id) }}>
          <Trash2 size={16} /> {kids.length ? t('folder.deleteAll') : t('folder.delete')}
        </Button>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </Sheet>
  )
}

/** Inside a folder: always a gallery of what it holds, plus its notes and photos. No project management here. */
export function FolderPage({ item, crumbs }: { item: Item; crumbs: ReactNode }) {
  const items = useApp((s) => s.data.items)
  const totals = useTotals()
  const covers = useCoverFor()
  const nav = useNavigate()
  const [tab, setTab] = useState<'gallery' | 'notes'>('gallery')
  const [sheet, setSheet] = useState<null | 'project' | 'folder' | 'move' | 'share' | 'delete'>(null)
  const kids = useMemo(() => foldersFirst(childrenOf(items, item.id)), [items, item.id])
  const nFolders = kids.filter(isFolder).length
  const nProjects = kids.length - nFolders
  const total = totals.total(item.id)
  const backTo = item.parent_id ? `/i/${item.parent_id}` : '/'
  const line = [nProjects ? tn('folder.projects', nProjects) : '', nFolders ? tn('folder.folders', nFolders) : '', total > 0 ? t('folder.worked', { time: fmtDuration(total) }) : ''].filter(Boolean).join(' · ')

  const menu = (
    <Menu trigger={(toggle) => <button aria-label={t('common.more')} onClick={toggle} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"><MoreHorizontal size={21} /></button>}>
      {(close) => (
        <>
          <MenuItem icon={<Pencil size={16} />} onClick={async () => { close(); const v = await promptDialog(t('item.rename'), item.title); if (v) void updateItem(item.id, { title: v }) }}>{t('item.rename')}</MenuItem>
          <MenuItem icon={<Link2 size={16} />} onClick={() => { close(); setSheet('share') }}>{t('item.share')}</MenuItem>
          <MenuItem icon={<FolderInput size={16} />} onClick={() => { close(); setSheet('move') }}>{t('item.move')}</MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { close(); setSheet('delete') }}>{t('folder.delete')}</MenuItem>
        </>
      )}
    </Menu>
  )

  return (
    <div className="min-h-full pb-28">
      <TopBar back={backTo} crumbs={crumbs}>
        <AddMenu parentId={item.id} parentTitle={item.title} parentKind="folder" variant="button" />
        {menu}
      </TopBar>
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="rise pb-5 pt-3 text-center sm:pt-6">
          <div className="folder-back mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-accent-strong"><FolderIcon size={24} strokeWidth={1.7} /></div>
          <h1 dir="auto" className="font-display text-[32px] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-5xl">{item.title}</h1>
          {line && <p className="mt-2 text-[13px] text-muted">{line}</p>}
          <div className="mt-4 inline-flex rounded-full bg-surface-2 p-1" role="tablist">
            {(['gallery', 'notes'] as const).map((tb) => (
              <button key={tb} role="tab" aria-selected={tab === tb} onClick={() => setTab(tb)} className={cx('h-8 rounded-full px-4 text-[14px] transition', tab === tb ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted')}>
                {t(tb === 'gallery' ? 'tabs.gallery' : 'tabs.notes')}
              </button>
            ))}
          </div>
        </header>

        {tab === 'notes' && <div className="mx-auto max-w-2xl"><NotesTab item={item} /></div>}
        {tab === 'gallery' && (
          <div className="flex flex-col gap-10">
            {kids.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
                {kids.map((k) => (
                  <ItemPress key={k.id} itemId={k.id}>
                    {isFolder(k) ? <FolderTile item={k} /> : <AlbumTile item={k} cover={covers.cover(k)} count={covers.countMedia(k.id)} />}
                  </ItemPress>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line px-4 py-9 text-center">
                <span className="font-medium">{t('folder.emptyTitle')}</span>
                <span className="text-[13px] text-muted">{t('folder.emptyBody')}</span>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="primary" onClick={() => setSheet('project')}><SquarePlus size={15} /> {t('add.project')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setSheet('folder')}><FolderPlus size={15} /> {t('add.folder')}</Button>
                </div>
              </div>
            )}
            <section>
              <h2 className="mb-3 font-display text-xl font-semibold">{t('folder.photos')}</h2>
              <MediaSection item={item} />
            </section>
          </div>
        )}
      </main>
      <AddMenu parentId={item.id} parentTitle={item.title} parentKind="folder" variant="fab" />
      <NewItemSheet open={sheet === 'project'} onClose={() => setSheet(null)} parentId={item.id} stay />
      <NewItemSheet open={sheet === 'folder'} onClose={() => setSheet(null)} parentId={item.id} kind="folder" stay />
      {sheet === 'move' && <MoveSheet item={item} onClose={() => setSheet(null)} />}
      {sheet === 'share' && <ShareSheet item={item} onClose={() => setSheet(null)} />}
      {sheet === 'delete' && <FolderDeleteSheet item={item} onClose={() => setSheet(null)} onDeleted={() => nav(backTo, { replace: true })} />}
    </div>
  )
}
