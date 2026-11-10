import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, FolderPlus, ImagePlus, ListPlus, MoreHorizontal, Plus, SquarePlus, StickyNote } from 'lucide-react'
import { PhotoSourceSheet, ProjectPickerSheet } from './PhotoSource'
import { SessionSheet } from './Tabs'
import { useMediaQuery } from '../lib/hooks'
import { cameraFile, saveCameraPhoto } from '../lib/download'
import { useApp, addNote, createItem, toast, uploadFiles } from '../store/app'
import { NewItemSheet } from './ItemBits'
import { Button, Sheet, cx } from './ui'
import { t } from '../i18n'

function countNodes(n: { children?: unknown[] }[]): number {
  return n.reduce((k, x) => k + 1 + countNodes((x.children ?? []) as { children?: unknown[] }[]), 0)
}

/**
 * The one obvious "+" of the app: a floating button on phones and a "New" button on desktop.
 * At the top level it offers a new project, inside an item a new subtask; plus new from template and
 * (inside an item) upload photos/videos.
 */
export function AddMenu({ parentId, parentTitle, parentKind = parentId ? 'item' : undefined, aboveBar = false, variant = 'both' }: { parentId: string | null; parentTitle?: string; parentKind?: 'item' | 'folder'; aboveBar?: boolean; variant?: 'both' | 'fab' | 'button' }) {
  const [sheet, setSheet] = useState<null | 'menu' | 'item' | 'folder' | 'template' | 'source' | 'pickProject'>(null)
  /** "Add time log": the project it goes on (asked first on home / in a folder). */
  const [logFor, setLogFor] = useState<string | null>(null)
  const touch = useMediaQuery('(pointer: coarse)')
  const nav = useNavigate()
  const file = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  return (
    <>
      {variant !== 'fab' && <div className="hidden sm:block">
        <Button variant="primary" size="sm" onClick={() => setSheet('menu')}><Plus size={17} /> {t('add.new')}</Button>
      </div>}
      {variant !== 'button' && <button
        aria-label={t('add.title')}
        onClick={() => setSheet('menu')}
        className={cx(
          'fixed right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lift transition active:scale-95 sm:hidden',
          aboveBar ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]',
        )}
      >
        <Plus size={26} />
      </button>}
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => { if (parentId) void uploadFiles(parentId, [...(e.target.files ?? [])]); e.target.value = '' }}
      />
      {/* "Take photo" (phones): the back camera, same upload path and target as the picker */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const shot = [...(e.target.files ?? [])].map(cameraFile); e.target.value = ''; if (!shot.length || !parentId) return; void uploadFiles(parentId, shot); shot.forEach(saveCameraPhoto) }} />
      <AddSheet
        open={sheet === 'menu'}
        onClose={() => setSheet(null)}
        canUpload={!!parentId}
        parentTitle={parentTitle}
        inFolder={parentKind === 'folder'}
        canFolder={!parentId || parentKind === 'folder'}
        onPick={(what) => {
          // phones: camera or gallery? computers have no camera here: straight to the picker
          if (what === 'upload') { if (touch) setSheet('source'); else { setSheet(null); file.current?.click() } }
          else if (what === 'time') { if (parentId && parentKind !== 'folder') { setSheet(null); setLogFor(parentId) } else setSheet('pickProject') }
          else if (what === 'note' && parentId) { setSheet(null); const id = addNote(parentId); nav(`/i/${parentId}?tab=notes&note=${id}`) }
          else if (what !== 'note') setSheet(what)
        }}
      />
      <PhotoSourceSheet open={sheet === 'source'} onClose={() => setSheet(null)} onCamera={() => camera.current?.click()} onPick={() => file.current?.click()} />
      {sheet === 'pickProject' && <ProjectPickerSheet scopeId={parentId} onClose={() => setSheet(null)} onPick={(id) => { setSheet(null); setLogFor(id) }} />}
      {logFor && <SessionSheet itemId={logFor} session={null} onClose={() => setLogFor(null)} />}
      <NewItemSheet open={sheet === 'item'} onClose={() => setSheet(null)} parentId={parentId} stay={!!parentId} />
      <NewItemSheet open={sheet === 'folder'} onClose={() => setSheet(null)} parentId={parentId} kind="folder" stay={!!parentId} />
      {sheet === 'template' && <TemplatePickerSheet parentId={parentId} onClose={() => setSheet(null)} />}
    </>
  )
}

function AddSheet({ open, onClose, onPick, canUpload, parentTitle, inFolder, canFolder }: {
  open: boolean; onClose: () => void; onPick: (w: 'item' | 'folder' | 'template' | 'upload' | 'note' | 'time') => void; canUpload: boolean; parentTitle?: string; inFolder: boolean; canFolder: boolean
}) {
  const hasProjects = useApp((s) => s.data.items.some((i) => i.kind !== 'folder'))
  const templates = useApp((s) => s.data.templates)
  /** One row; `more` adds a "⋯" button on the right (e.g. "from a template"). */
  const Opt = ({ icon, title, hint, onClick, more }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void; more?: { label: string; run: () => void } }) => (
    <div className="flex items-center gap-1 rounded-2xl transition hover:bg-surface-2">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-4 px-3 py-3 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">{icon}</span>
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          <span className="block text-[13px] text-muted">{hint}</span>
        </span>
      </button>
      {more && (
        <button onClick={more.run} aria-label={more.label} title={more.label} className="mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-line/60 hover:text-ink">
          <MoreHorizontal size={20} />
        </button>
      )}
    </div>
  )
  // "⋯" next to New project / New subtask opens the templates (only when there are any)
  const fromTemplate = templates.length ? { label: t('add.template'), run: () => onPick('template') } : undefined
  return (
    <Sheet open={open} onClose={onClose} title={t('add.title')}>
      <div className="flex flex-col gap-1">
        {canUpload && !inFolder
          ? <Opt icon={<ListPlus size={21} />} title={t('add.subtask')} hint={t('add.subtaskHint', { title: parentTitle ?? '' })} onClick={() => onPick('item')} more={fromTemplate} />
          : <Opt icon={<SquarePlus size={21} />} title={t('add.project')} hint={inFolder ? t('add.projectInFolder', { title: parentTitle ?? '' }) : t('add.projectHint')} onClick={() => onPick('item')} more={fromTemplate} />}
        {canFolder && <Opt icon={<FolderPlus size={21} />} title={t('add.folder')} hint={inFolder ? t('add.folderInFolder', { title: parentTitle ?? '' }) : t('add.folderHint')} onClick={() => onPick('folder')} />}
        {canUpload && <Opt icon={<StickyNote size={21} />} title={t('add.note')} hint={t('add.noteHint', { title: parentTitle ?? '' })} onClick={() => onPick('note')} />}
        {canUpload && <Opt icon={<ImagePlus size={21} />} title={t('add.upload')} hint={t('add.uploadHint', { title: parentTitle ?? '' })} onClick={() => onPick('upload')} />}
        {(canUpload && !inFolder) || hasProjects ? <Opt icon={<Clock size={21} />} title={t('add.time')} hint={canUpload && !inFolder ? t('add.timeHint', { title: parentTitle ?? '' }) : t('add.timePick')} onClick={() => onPick('time')} /> : null}
      </div>
    </Sheet>
  )
}

/** Picks a template and creates a NEW project or subtask from it (inside parentId, or at the top level). */
export function TemplatePickerSheet({ parentId, onClose }: { parentId: string | null; onClose: () => void }) {
  const templates = useApp((s) => s.data.templates)
  const nav = useNavigate()
  return (
    <Sheet open onClose={onClose} title={t('add.template')}>
      {!templates.length && <p className="text-sm text-muted">{t('settings.noTemplates')}</p>}
      <div className="flex flex-col gap-1">
        {templates.map((x) => (
          <button
            key={x.id}
            onClick={async () => {
              onClose()
              const nid = await createItem(parentId, '', x.id)
              if (!parentId) nav(`/i/${nid}`)
              else toast(t('item.createdFromTemplate', { title: x.item_title || x.name }), 'info', { label: t('share.open'), run: () => nav(`/i/${nid}`) })
            }}
            className="flex flex-col items-start rounded-xl px-3 py-3 text-left hover:bg-surface-2"
          >
            <span className="font-medium" dir="auto">{x.name}</span>
            <span className="text-sm text-muted">{t('item.templateWillCreate', { title: x.item_title || x.name, n: countNodes(x.tree) })}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
