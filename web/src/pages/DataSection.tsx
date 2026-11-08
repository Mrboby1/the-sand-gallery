import { useEffect, useRef, useState } from 'react'
import { Check, Cloud, Download, HardDrive, Smartphone, Trash2, Upload, UserPlus } from 'lucide-react'
import { backend, flush, loadData, toast, useApp } from '../store/app'
import { LocalBackend } from '../lib/backend/local'
import type { AllowedEmail } from '../lib/backend/types'
import { ImportError, exportAll, importInto, readArchive, saveFile, type Archive, type Progress } from '../lib/portable'
import { enterOffline, leaveOffline, storageInfo, useInstall } from '../lib/offline'
import { explainOffline } from './Login'
import { Button, IconButton, Input, confirmDialog, cx } from '../components/ui'
import { t, tn } from '../i18n'

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

const countsText = (c: Record<string, number>) => t('data.counts', { items: tn('data.projects', c.items ?? 0), media: tn('data.mediaCount', c.media ?? 0) })

function ProgressLine({ p }: { p: Progress }) {
  const label = { data: t('data.step.data'), media: t('data.step.media'), pack: t('data.step.pack'), rows: t('data.step.rows'), upload: t('data.step.upload'), done: t('data.step.done') }[p.step]
  const frac = p.total ? p.done / p.total : 0
  return (
    <div className="mt-4" role="status">
      <div className="flex justify-between text-[13px] text-muted"><span>{label}</span>{p.total > 1 && <span className="tabular">{p.done} / {p.total}</span>}</div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(frac * 100)}%` }} /></div>
      <p className="mt-1.5 text-[12px] text-muted">{t('data.keepOpen')}</p>
    </div>
  )
}

/** Settings > Your data: which version this is, install, export everything, import, switch versions. */
export function DataSection() {
  const user = useApp((s) => s.user)
  const offline = backend.mode === 'local'
  const [progress, setProgress] = useState<Progress | null>(null)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageInfo>>>(null)
  const install = useInstall()
  const file = useRef<HTMLInputElement>(null)
  const busy = progress !== null

  useEffect(() => { if (offline) void storageInfo().then(setStorage) }, [offline, busy])
  // leaving the page in the middle of an export/import would lose it
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])

  const doExport = async () => {
    const ok = await confirmDialog(t('data.export.title'), {
      points: offline
        ? [t('data.export.p1'), t('data.export.offlineKey'), t('data.export.keep'), t('data.export.big')]
        : [t('data.export.p1'), t('data.export.cloudDownload'), t('data.export.keep'), t('data.export.big')],
      okLabel: t('data.export.ok'),
    })
    if (!ok) return
    setProgress({ step: 'data', done: 0, total: 1 })
    try {
      if (!offline) await flush()
      const r = await exportAll(backend, { origin: offline ? 'offline' : 'cloud', userId: user?.id ?? '', account: offline ? null : user?.email ?? null }, setProgress)
      saveFile(r.blob, r.name)
      toast(t('data.export.done', { size: fmtBytes(r.blob.size) }), 'info', undefined, 6000)
      if (r.manifest.missing.length) toast(t('data.export.missing', { n: r.manifest.missing.length }), 'error')
    } catch (e) {
      console.error(e)
      toast(e instanceof Error && e.message === 'zip-too-large' ? t('data.export.tooLarge') : t('data.export.failed'), 'error')
    } finally {
      setProgress(null)
    }
  }

  const doImport = async (f: File) => {
    let arc: Archive
    try {
      arc = await readArchive(f)
    } catch (e) {
      toast(e instanceof ImportError && e.message === 'newer-version' ? t('data.import.newer') : t('data.import.notExport'), 'error')
      return
    }
    const what = countsText(arc.manifest.counts)
    const run = async (target: typeof backend, after: () => void | Promise<void>) => {
      setProgress({ step: 'rows', done: 0, total: 1 })
      try {
        const r = await importInto(target, arc, setProgress)
        await after()
        toast(t('data.import.done', { added: countsText(r.added), skipped: r.skipped }), 'info', undefined, 7000)
        if (r.missingMedia) toast(t('data.import.missing', { n: r.missingMedia }), 'error')
      } catch (e) {
        console.error(e)
        toast(t('data.import.failed'), 'error')
      } finally {
        setProgress(null)
      }
    }
    if (offline) {
      const ok = await confirmDialog(t('data.import.title'), { points: [t('data.import.adds', { what }), t('data.import.merge'), t('data.import.localOnly')], okLabel: t('data.import.ok') })
      if (ok) await run(backend, () => loadData())
      return
    }
    if (arc.manifest.origin === 'offline') {
      // a file from an offline version never goes to the cloud: it opens as the offline version on this device
      const ok = await confirmDialog(t('data.import.offlineFile.title'), {
        points: [t('data.import.offlineFile.p1'), t('data.import.offlineFile.p2', { what }), t('offline.explain.p1'), t('offline.explain.p3'), t('offline.explain.p4')],
        okLabel: t('data.import.offlineFile.ok'),
      })
      if (ok) await run(new LocalBackend(), () => enterOffline('/'))
      return
    }
    const points = [t('data.import.adds', { what }), t('data.import.merge'), t('data.import.cloudUpload')]
    if (arc.manifest.account && arc.manifest.account !== user?.email) points.push(t('data.import.otherAccount', { account: arc.manifest.account }))
    const ok = await confirmDialog(t('data.import.cloud.title'), { points, okLabel: t('data.import.ok') })
    if (ok) await run(backend, async () => { await loadData() })
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">{offline ? <HardDrive size={20} /> : <Cloud size={20} />}</div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{offline ? t('data.mode.offline') : t('data.mode.online')}</div>
          <div className="text-[13px] text-muted">{offline ? t('data.mode.offlineHint') : t('data.mode.onlineHint', { email: user?.email ?? '' })}</div>
          {offline && storage && (
            <div className="mt-1 text-[12.5px] text-muted">
              {t('data.storage', { used: fmtBytes(storage.used) })} · {storage.persisted ? t('data.persisted') : t('data.notPersisted')}
            </div>
          )}
        </div>
      </div>

      {offline && (
        <div className="mt-4 rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center gap-3">
            <Smartphone size={18} className="shrink-0 text-accent-strong" />
            <div className="min-w-0 flex-1 text-[14px]">
              {install.installed ? <span className="inline-flex items-center gap-1.5"><Check size={15} /> {t('data.install.done')}</span> : t('data.install.why')}
            </div>
            {!install.installed && install.canPrompt && (
              <Button size="sm" variant="primary" onClick={async () => { if (await install.install()) toast(t('data.install.thanks')) }}>
                <Download size={15} /> {t('data.install.button')}
              </Button>
            )}
          </div>
          {!install.installed && !install.canPrompt && <p className="mt-2 text-[12.5px] text-muted">{t('data.install.manual')}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={doExport}><Download size={16} /> {t('data.export.button')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => file.current?.click()}><Upload size={16} /> {t('data.import.button')}</Button>
        <input
          ref={file}
          type="file"
          accept=".sandgallery,.zip,application/zip,application/octet-stream"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doImport(f) }}
        />
      </div>
      <p className="mt-2 text-[12.5px] text-muted">{offline ? t('data.exportHint.offline') : t('data.exportHint.online')}</p>
      {progress && <ProgressLine p={progress} />}

      <div className="mt-5 border-t border-line pt-4">
        {offline ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              const ok = await confirmDialog(t('data.switch.toOnline.title'), { points: [t('data.switch.toOnline.p1'), t('data.switch.toOnline.p2')], okLabel: t('data.switch.toOnline.ok') })
              if (ok) leaveOffline(true)
            }}
          >
            <Cloud size={16} /> {t('data.switch.toOnline.button')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              const ok = await confirmDialog(t('data.switch.toOffline.title'), { points: [t('data.switch.toOffline.p1'), t('data.switch.toOffline.p2')], okLabel: t('common.next') })
              if (ok && (await explainOffline())) enterOffline()
            }}
          >
            <HardDrive size={16} /> {t('data.switch.toOffline.button')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Owner only: who may sign in to the online version. */
export function AllowedPeople() {
  const me = useApp((s) => s.access?.email ?? s.user?.email ?? '')
  const [list, setList] = useState<AllowedEmail[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = () => backend.listAllowed().then(setList).catch(() => toast(t('allow.loadFailed'), 'error'))
  useEffect(() => { void reload() }, [])
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  return (
    <div>
      <ul className="flex flex-col gap-1">
        {list === null && <li className="text-sm text-muted">{t('common.loading')}</li>}
        {list?.map((a) => (
          <li key={a.email} className="flex items-center gap-3 rounded-2xl px-1 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[15px]">{a.email}</span>
            {a.is_admin ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent-strong">{a.email === me ? t('allow.you') : t('allow.owner')}</span>
            ) : (
              <IconButton
                label={t('allow.remove', { email: a.email })}
                onClick={async () => {
                  if (!(await confirmDialog(t('allow.removeTitle'), { body: t('allow.removeBody', { email: a.email }), okLabel: t('allow.removeOk'), danger: true }))) return
                  try { await backend.removeAllowed(a.email); await reload() } catch { toast(t('allow.failed'), 'error') }
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!valid) return
          setBusy(true)
          try { await backend.addAllowed(email); setEmail(''); await reload(); toast(t('allow.added')) } catch { toast(t('allow.failed'), 'error') } finally { setBusy(false) }
        }}
      >
        <Input type="email" inputMode="email" autoComplete="off" placeholder={t('allow.placeholder')} value={email} onChange={(e) => setEmail(e.target.value)} className={cx('min-w-0 flex-1')} aria-label={t('allow.placeholder')} />
        <Button type="submit" variant="primary" disabled={!valid || busy}><UserPlus size={16} /> {t('allow.add')}</Button>
      </form>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{t('allow.hint')}</p>
    </div>
  )
}
