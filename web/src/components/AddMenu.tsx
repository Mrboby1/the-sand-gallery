import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderPlus, ImagePlus, LayoutTemplate, Plus } from 'lucide-react'
import { useApp, createItem, toast, uploadFiles } from '../store/app'
import { NewItemSheet } from './ItemBits'
import { Button, Sheet, cx } from './ui'
import { t } from '../i18n'

function countNodes(n: { children?: unknown[] }[]): number {
  return n.reduce((k, x) => k + 1 + countNodes((x.children ?? []) as { children?: unknown[] }[]), 0)
}

/**
 * The one obvious "+" of the app: a floating button on phones and a "New" button on desktop.
 * It offers: new folder / project, new from template, and (inside an item) upload photos/videos.
 */
export function AddMenu({ parentId, parentTitle, aboveBar = false, variant = 'both' }: { parentId: string | null; parentTitle?: string; aboveBar?: boolean; variant?: 'both' | 'fab' | 'button' }) {
  const [sheet, setSheet] = useState<null | 'menu' | 'folder' | 'template'>(null)
  const file = useRef<HTMLInputElement>(null)
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
      <AddSheet
        open={sheet === 'menu'}
        onClose={() => setSheet(null)}
        canUpload={!!parentId}
        parentTitle={parentTitle}
        onPick={(what) => {
          if (what === 'upload') { setSheet(null); file.current?.click() }
          else setSheet(what)
        }}
      />
      <NewItemSheet open={sheet === 'folder'} onClose={() => setSheet(null)} parentId={parentId} stay={!!parentId} />
      {sheet === 'template' && <TemplatePickerSheet parentId={parentId} onClose={() => setSheet(null)} />}
    </>
  )
}

function AddSheet({ open, onClose, onPick, canUpload, parentTitle }: {
  open: boolean; onClose: () => void; onPick: (w: 'folder' | 'template' | 'upload') => void; canUpload: boolean; parentTitle?: string
}) {
  const templates = useApp((s) => s.data.templates)
  const Opt = ({ icon, title, hint, onClick, disabled }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition hover:bg-surface-2 disabled:opacity-40">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
    </button>
  )
  return (
    <Sheet open={open} onClose={onClose} title={t('add.title')}>
      <div className="flex flex-col gap-1">
        <Opt icon={<FolderPlus size={21} />} title={t('add.folder')} hint={t('add.folderHint')} onClick={() => onPick('folder')} />
        <Opt icon={<LayoutTemplate size={21} />} title={t('add.template')} hint={templates.length ? t('add.templateHint') : t('settings.noTemplates')} onClick={() => onPick('template')} disabled={!templates.length} />
        {canUpload && <Opt icon={<ImagePlus size={21} />} title={t('add.upload')} hint={t('add.uploadHint', { title: parentTitle ?? '' })} onClick={() => onPick('upload')} />}
      </div>
    </Sheet>
  )
}

/** Picks a template and creates a NEW folder from it (inside parentId, or at the top level). */
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
