import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ColorSliders, CustomizeFullscreen } from '../components/CustomizePanel'
import { Hourglass } from '../components/Hourglass'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Bell, Check, Copy, DatabaseBackup, LogOut, Maximize2, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { FEATURE_GROUPS, featureHow, featureTitle } from '../lib/features'
import { flashTo } from './FeaturesPage'
import { AllowedPeople, DataSection } from './DataSection'
import {
  useApp, addStatus, addTemplate, backend, deleteStatus, deleteTemplate, moveStatus, revokeShare, saveSettings, shareUrl,
  signOut, toast, updateStatus, updateTemplate,
} from '../store/app'
import type { Template, TemplateNode } from '../lib/types'
import { getTheme, setStyle, setTheme, useStyle, type StylePref, type ThemePref } from '../lib/theme'
import { TopBar } from '../components/Shell'
import { Button, Field, IconButton, Input, Sheet, Switch, confirmDialog, cx } from '../components/ui'
import { useMoney } from '../components/Tabs'
import { onColor } from '../components/StatusPill'
import { t, tn, locale } from '../i18n'
import { clearTimer, disablePush, ensurePush, permission, requestNotifications } from '../lib/notify'

const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']
const SWATCHES = ['#9b87c9', '#d9903d', '#8f9aa6', '#5f9e6e', '#c0564a', '#4f8fbf', '#c27ba0', '#b8a038', '#3f9c95', '#7a5634']

function Section({ title, hint, children, id }: { title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id ? `set-${id}` : undefined} className="rise scroll-mt-20 rounded-3xl border border-line bg-surface p-5">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const data = useApp((s) => s.data)
  const user = useApp((s) => s.user)
  const access = useApp((s) => s.access)
  const s = data.settings
  const [theme, setThemeState] = useState<ThemePref>(getTheme())
  const style = useStyle()
  const [editTpl, setEditTpl] = useState<Template | 'new' | null>(null)
  const money = useMoney()
  const statuses = [...data.statuses].sort((a, b) => a.sort_order - b.sort_order)
  const activeLinks = data.share_links.filter((l) => !l.revoked_at)
  const itemTitle = (id: string) => data.items.find((i) => i.id === id)?.title ?? '…'

  return (
    <div className="min-h-full pb-24">
      <TopBar back="/" title={t('settings.title')} />
      <SettingsSearch />
      <main className="mx-auto max-w-6xl columns-1 gap-4 px-4 pt-4 sm:px-6 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <Section id="statuses" title={t('settings.statuses')} hint={`${t('settings.statusesHint')} ${t('settings.finishedHint')}`}>
          <div className="flex flex-col gap-2">
            {statuses.map((st, i) => (
              <div key={st.id} className="flex items-center gap-2">
                <ColorPicker value={st.color} onChange={(c) => updateStatus(st.id, { color: c })} />
                <Input defaultValue={st.name} key={st.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== st.name) void updateStatus(st.id, { name: v }) }} className="h-10" aria-label={t('settings.statusName')} />
                <button
                  onClick={() => updateStatus(st.id, { is_finished: !st.is_finished })}
                  aria-pressed={!!st.is_finished}
                  title={t('settings.finishedHint')}
                  className={cx('inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition', st.is_finished ? 'border-transparent bg-primary text-on-primary' : 'border-line text-muted hover:bg-surface-2')}
                >
                  {st.is_finished && <Check size={13} />} {t('settings.finished')}
                </button>
                <IconButton label="Move up" disabled={i === 0} onClick={() => moveStatus(st.id, -1)} className="h-9 w-9 disabled:opacity-30"><ArrowUp size={16} /></IconButton>
                <IconButton label="Move down" disabled={i === statuses.length - 1} onClick={() => moveStatus(st.id, 1)} className="h-9 w-9 disabled:opacity-30"><ArrowDown size={16} /></IconButton>
                <IconButton
                  label={t('common.delete')}
                  className="h-9 w-9"
                  onClick={async () => { if (await confirmDialog(t('settings.deleteStatusConfirm', { name: st.name }), { danger: true, okLabel: t('common.delete') })) void deleteStatus(st.id) }}
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))}
          </div>
          <Button className="mt-3" size="sm" variant="soft" onClick={() => addStatus(t('settings.newStatus'), SWATCHES[statuses.length % SWATCHES.length])}><Plus size={15} /> {t('settings.addStatus')}</Button>
        </Section>

        <Section id="pricing" title={t('settings.pricing')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t('settings.rate')}>
              <Input type="number" inputMode="decimal" min={0} step="any" defaultValue={s.hourly_rate || ''} key={`r${s.hourly_rate}`} onBlur={(e) => saveSettings({ hourly_rate: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={t('settings.currency')}>
              <select value={s.currency} onChange={(e) => saveSettings({ currency: e.target.value })} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-accent">
                {[...new Set([s.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label={t('settings.markup')}>
              <Input type="number" inputMode="decimal" step="any" defaultValue={s.markup_pct || ''} key={`m${s.markup_pct}`} onBlur={(e) => saveSettings({ markup_pct: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          {s.hourly_rate > 0 && <p className="mt-3 text-[13px] text-muted">1h = {money(s.hourly_rate)}</p>}
        </Section>

        <Section id="planning" title={t('settings.planning')}>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">{t('settings.dueDates')}</span>
              <span className="block text-[13px] text-muted">{t('settings.dueDatesHint')}</span>
            </span>
            <Switch checked={s.due_dates_enabled} onChange={(v) => saveSettings({ due_dates_enabled: v })} label={t('settings.dueDates')} />
          </label>
          <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="font-medium">{t('settings.weekStarts')}</span>
            <WeekStartPicker value={s.week_starts_on} />
          </div>
        </Section>

        <Section id="appearance" title={t('settings.appearance')}>
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium">{t('settings.theme')}</span>
            <Segmented
              value={theme}
              options={(['system', 'light', 'dark'] as ThemePref[]).map((v) => ({ v, l: t(`settings.theme.${v}`) }))}
              onChange={(v) => { setTheme(v as ThemePref); setThemeState(v as ThemePref) }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">{t('settings.style')}</span>
              <span className="block text-[13px] text-muted">{t('settings.styleHint')}</span>
            </span>
            <Segmented
              value={style}
              options={(['flat', 'glossy', 'line'] as StylePref[]).map((v) => ({ v, l: t(`settings.style.${v}`) }))}
              onChange={(v) => setStyle(v as StylePref)}
            />
          </div>
          <ColorControls />
        </Section>

        <NotificationsSection />

        <Section id="templates" title={t('settings.templates')}>
          {!data.templates.length && <p className="mb-3 text-sm text-muted">{t('settings.noTemplates')}</p>}
          <div className="flex flex-col gap-1">
            {data.templates.map((tp) => (
              <div key={tp.id} className="flex items-center gap-2 rounded-2xl px-2 py-2 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{tp.name}</div>
                  <div className="truncate text-[13px] text-muted">{tp.tree.map((n) => n.title).join(' · ') || '—'}</div>
                </div>
                <IconButton label={t('common.edit')} className="h-9 w-9" onClick={() => setEditTpl(tp)}><Pencil size={15} /></IconButton>
                <IconButton label={t('common.delete')} className="h-9 w-9" onClick={async () => { if (await confirmDialog(t('settings.deleteTemplateConfirm', { name: tp.name }), { danger: true, okLabel: t('common.delete') })) void deleteTemplate(tp.id) }}><Trash2 size={15} /></IconButton>
              </div>
            ))}
          </div>
          <Button className="mt-3" size="sm" variant="soft" onClick={() => setEditTpl('new')}><Plus size={15} /> {t('settings.addTemplate')}</Button>
        </Section>

        <Section id="share" title={t('settings.shareLinks')}>
          {!activeLinks.length && <p className="text-sm text-muted">{t('settings.noShareLinks')}</p>}
          {activeLinks.map((l) => (
            <div key={l.id} className="flex items-center gap-2 py-1.5">
              <Link to={`/i/${l.item_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent-strong">{itemTitle(l.item_id)}</Link>
              <IconButton label={t('share.copy')} className="h-9 w-9" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl(l)) } catch { /* ignore */ } toast(t('share.copied')) }}><Copy size={15} /></IconButton>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => { void revokeShare(l.id); toast(t('share.revoked')) }}>{t('share.revoke')}</Button>
            </div>
          ))}
        </Section>

        <Section id="features" title={t('settings.features')} hint={t('settings.featuresHint')}>
          <Link to="/settings/features" className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-medium transition hover:bg-accent-soft">
            <Sparkles size={16} /> {t('settings.featuresOpen')}
          </Link>
        </Section>

        <Section id="data" title={t('data.section')} hint={backend.mode === 'local' ? t('data.sectionHint.offline') : t('data.sectionHint.online')}>
          <DataSection />
        </Section>

        {backend.mode === 'cloud' && access?.admin && (
          <Section id="allowed" title={t('allow.section')} hint={t('allow.sectionHint')}>
            <AllowedPeople />
          </Section>
        )}

        {backend.mode === 'cloud' && <Section id="account" title={t('settings.account')}>
          <div className="flex items-center gap-3">
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-11 w-11 rounded-full" referrerPolicy="no-referrer" /> : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary font-display text-lg font-semibold text-on-primary">{(user?.name ?? user?.email ?? '?')[0]?.toUpperCase()}</div>}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{user?.name ?? user?.email}</div>
              <div className="truncate text-[13px] text-muted">{user?.email}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => signOut()}><LogOut size={15} /> {t('settings.signOut')}</Button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted">{t('settings.backups')}</p>
            <BackupButton />
          </div>
        </Section>}
        <p className="py-4 text-center text-xs text-muted">{t('app.name')} · v{__APP_VERSION__}</p>
      </main>
      {editTpl && <TemplateSheet tpl={editTpl === 'new' ? null : editTpl} onClose={() => setEditTpl(null)} />}
    </div>
  )
}

function BackupButton() {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const r = await backend.backupNow()
          toast(r.ok ? t('settings.backupDone') : t('settings.backupFailed'), r.ok ? 'info' : 'error')
        } catch (e) {
          console.error(e)
          toast(String(e).includes('429') ? t('settings.backupRecent') : t('settings.backupFailed'), 'error')
        } finally {
          setBusy(false)
        }
      }}
    >
      <DatabaseBackup size={15} /> {busy ? t('common.loading') : t('settings.backupNow')}
    </Button>
  )
}

function NotificationsSection() {
  const s = useApp((st) => st.data.settings)
  const [perm, setPerm] = useState(permission())
  const [busy, setBusy] = useState(false)
  const stateKey = `notif.state.${perm}` as const
  return (
    <Section id="notifications" title={t('notif.section')}>
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block font-medium">{t('notif.timer')}</span>
          <span className="block text-[13px] text-muted">{t('notif.timerHint')}</span>
        </span>
        <Switch
          checked={s.notify_enabled}
          label={t('notif.timer')}
          onChange={async (v) => {
            void saveSettings({ notify_enabled: v })
            if (v) setPerm(await requestNotifications())
            else { await clearTimer(); await disablePush() }
          }}
        />
      </label>
      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="font-medium">{t('notif.reminder')}</span>
        <ReminderPicker value={s.reminder_minutes ?? s.reminder_hours * 60} />
      </div>
      <p className="mt-4 text-[13px] text-muted">{t(stateKey)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {perm === 'default' && s.notify_enabled && (
          <Button size="sm" variant="primary" onClick={async () => setPerm(await requestNotifications())}>{t('notif.allowHere')}</Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || perm !== 'granted'}
          onClick={async () => {
            setBusy(true)
            try {
              await ensurePush()
              const n = backend.mode === 'cloud' ? await backend.pushTest().catch(() => 0) : 0
              if (n > 0) toast(tn('notif.testSent', n))
              else {
                const reg = await navigator.serviceWorker.ready
                await reg.showNotification('The Sand Gallery', { body: 'Notifications work on this device.', tag: 'test', icon: '/icon-192.png', badge: '/badge-96.png' })
                toast(t('notif.testLocal'))
              }
            } finally { setBusy(false) }
          }}
        >
          <Bell size={15} /> {t('notif.test')}
        </Button>
      </div>
    </Section>
  )
}

/** Colours: a live preview hourglass (with a Full screen customiser) and the hue sliders. */
function ColorControls() {
  const [full, setFull] = useState(false)
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-center gap-4">
        <div className="relative flex h-24 w-20 shrink-0 items-center justify-center rounded-2xl bg-bg">
          <Hourglass running size={44} />
          <button onClick={() => setFull(true)} aria-label={t('colors.fullscreen')} title={t('colors.fullscreen')} className="absolute -bottom-2 -right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm transition hover:bg-surface-2">
            <Maximize2 size={14} />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t('colors.title')}</div>
          <div className="text-[13px] text-muted">{t('colors.hint')}</div>
          <button onClick={() => setFull(true)} className="mt-1 text-[13px] font-medium text-accent-strong underline-offset-2 hover:underline">{t('colors.fullscreen')}</button>
        </div>
      </div>
      <div className="mt-3"><ColorSliders /></div>
      {full && <CustomizeFullscreen onClose={() => setFull(false)} />}
    </div>
  )
}

const dayName = (d: number) => new Date(2024, 0, 7 + d).toLocaleDateString(locale, { weekday: 'long' }) // 2024-01-07 is a Sunday

/** Sunday / Monday / Other…: "Other" opens a picker with all 7 days and then shows the chosen day. */
function WeekStartPicker({ value }: { value: number }) {
  const [open, setOpen] = useState(false)
  const other = value !== 0 && value !== 1
  return (
    <>
      <Segmented
        value={other ? 'other' : String(value)}
        options={[{ v: '0', l: t('settings.sunday') }, { v: '1', l: t('settings.monday') }, { v: 'other', l: other ? dayName(value) : t('settings.other') }]}
        onChange={(v) => (v === 'other' ? setOpen(true) : saveSettings({ week_starts_on: Number(v) }))}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t('settings.weekStarts')}>
        <div className="flex flex-col gap-1">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <button
              key={d}
              onClick={() => { void saveSettings({ week_starts_on: d }); setOpen(false) }}
              className={cx('flex items-center justify-between rounded-xl px-3 py-3 text-left transition hover:bg-surface-2', value === d && 'bg-accent-soft font-medium')}
            >
              {dayName(d)}
              {value === d && <Check size={16} />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

const fmtMinutes = (m: number) => (m % 60 ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`) : `${m / 60}h`)

/** Off / 1h / 2h / 4h / Custom…: any interval from 15 minutes (the reminder check runs every 15 minutes). */
function ReminderPicker({ value }: { value: number }) {
  const presets = [0, 60, 120, 240]
  const custom = !presets.includes(value)
  const [open, setOpen] = useState(false)
  const [h, setH] = useState(String(Math.floor(value / 60)))
  const [m, setM] = useState(String(value % 60))
  const total = (Number(h) || 0) * 60 + (Number(m) || 0)
  const ok = total >= 15 && total <= 10080
  return (
    <>
      <Segmented
        value={custom ? 'custom' : String(value)}
        options={[...presets.map((p) => ({ v: String(p), l: p ? fmtMinutes(p) : t('notif.off') })), { v: 'custom', l: custom ? fmtMinutes(value) : t('notif.custom') }]}
        onChange={(v) => {
          if (v === 'custom') { setH(String(Math.floor((value || 90) / 60))); setM(String((value || 90) % 60)); setOpen(true) }
          else void saveSettings({ reminder_minutes: Number(v), ...(Number(v) % 60 === 0 && [0, 1, 2, 4].includes(Number(v) / 60) ? { reminder_hours: Number(v) / 60 } : {}) })
        }}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t('notif.customTitle')}>
        <form
          onSubmit={(e) => { e.preventDefault(); if (ok) { void saveSettings({ reminder_minutes: total }); setOpen(false) } }}
          className="flex flex-col gap-4"
        >
          <div className="flex items-end gap-3">
            <Field label={t('notif.hours')}><Input type="number" inputMode="numeric" min={0} max={168} value={h} onChange={(e) => setH(e.target.value)} className="w-24" /></Field>
            <Field label={t('notif.minutes')}><Input type="number" inputMode="numeric" min={0} max={59} step={5} value={m} onChange={(e) => setM(e.target.value)} className="w-24" /></Field>
            <span className="pb-2 text-sm text-muted">= {ok ? fmtMinutes(total) : '—'}</span>
          </div>
          <p className={cx('text-[13px]', ok ? 'text-muted' : 'text-danger')}>{t('notif.customHint')}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={!ok}>{t('common.save')}</Button>
          </div>
        </form>
      </Sheet>
    </>
  )
}

/** Settings search: finds settings (jumps to them with a short highlight) and features (opens the list). */
function SettingsSearch() {
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const needle = q.trim().toLowerCase()
  const settingsIndex: { id: string; label: string; kw: string }[] = [
    { id: 'statuses', label: t('settings.statuses'), kw: 'status colour color finished done sold order idea progress' },
    { id: 'pricing', label: `${t('settings.pricing')} · ${t('settings.rate')}`, kw: 'hourly rate currency markup price cost money' },
    { id: 'planning', label: t('settings.dueDates'), kw: 'due date deadline calendar' },
    { id: 'planning', label: t('settings.weekStarts'), kw: 'week start sunday monday other day' },
    { id: 'appearance', label: t('settings.theme'), kw: 'dark light mode theme system' },
    { id: 'appearance', label: t('settings.style'), kw: 'style flat glossy 2d hourglass look' },
    { id: 'appearance', label: t('colors.title'), kw: 'colour color hue slider background sand hourglass' },
    { id: 'notifications', label: t('notif.timer'), kw: 'notification push allow test phone' },
    { id: 'notifications', label: t('notif.reminder'), kw: 'reminder remind custom interval still working' },
    { id: 'templates', label: t('settings.templates'), kw: 'template subtasks' },
    { id: 'share', label: t('settings.shareLinks'), kw: 'share link revoke public' },
    { id: 'features', label: t('settings.features'), kw: 'features tips help how' },
    { id: 'data', label: t('data.export.button'), kw: 'export download file backup save computer zip sandgallery' },
    { id: 'data', label: t('data.import.button'), kw: 'import restore upload file open sandgallery' },
    { id: 'data', label: t('data.mode.offline'), kw: 'offline version no account device install download app local storage' },
    { id: 'allowed', label: t('allow.section'), kw: 'allowed people invite whitelist allow list access private email' },
    { id: 'account', label: t('settings.account'), kw: 'sign out account backup back up logout' },
  ]
  const settingHits = needle ? settingsIndex.filter((r) => `${r.label} ${r.kw}`.toLowerCase().includes(needle)) : []
  const featureHits = needle
    ? FEATURE_GROUPS.flatMap((g) => g.features).filter((f) => `${t(featureTitle(f.id))} ${t(featureHow(f.id))} ${f.keywords}`.toLowerCase().includes(needle)).slice(0, 8)
    : []
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('settings.search')}
          aria-label={t('settings.search')}
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-[16px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      {needle && (
        <div className="rise mt-2 rounded-2xl border border-line bg-surface p-2">
          {!settingHits.length && !featureHits.length && <p className="px-3 py-3 text-sm text-muted">{t('settings.searchNone')}</p>}
          {settingHits.length > 0 && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('settings.searchSettings')}</div>}
          {settingHits.map((r, i) => (
            <button key={i} onClick={() => { setQ(''); flashTo(`set-${r.id}`) }} className="block w-full rounded-xl px-3 py-2.5 text-left text-[15px] hover:bg-surface-2">{r.label}</button>
          ))}
          {featureHits.length > 0 && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('settings.searchFeatures')}</div>}
          {featureHits.map((f) => (
            <button key={f.id} onClick={() => nav(`/settings/features#${f.id}`)} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-surface-2">
              <span className="block text-[15px]">{t(featureTitle(f.id))}</span>
              <span className="block truncate text-[13px] text-muted">{t(featureHow(f.id))}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Segmented({ value, options, onChange }: { value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cx('h-8 rounded-full px-3 text-[13px] transition', value === o.v ? 'bg-surface font-medium shadow-sm' : 'text-muted')}>{o.l}</button>
      ))}
    </div>
  )
}

/** Swatch popover, rendered in a portal at a fixed position so no card can clip it. */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const open = !!pos
  const setOpen = (o: boolean) => {
    if (!o || !btn.current) return setPos(null)
    const r = btn.current.getBoundingClientRect()
    const w = 216, h = 150
    setPos({ x: Math.min(r.left, window.innerWidth - w - 8), y: r.bottom + h + 8 > window.innerHeight ? r.top - h - 6 : r.bottom + 6 })
  }
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="relative">
      <button ref={btn} aria-label={t('settings.color')} aria-expanded={open} onClick={() => setOpen(!open)} className="h-9 w-9 shrink-0 rounded-full ring-2 ring-surface" style={{ background: value }} />
      {pos && createPortal(
        <div ref={pop} style={{ left: pos.x, top: pos.y }} className="rise fixed z-[96] grid w-[216px] grid-cols-5 gap-2 rounded-2xl border border-line bg-surface p-3 shadow-lift">
          {SWATCHES.map((c) => (
            <button key={c} onClick={() => { onChange(c); setPos(null) }} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: c }} aria-label={c}>
              {c === value && <Check size={14} color={onColor(c)} />}
            </button>
          ))}
          <label className="col-span-5 mt-1 flex items-center gap-2 text-xs text-muted">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent" /> {t('settings.customColor')}
          </label>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ---------------------------------------------------------------- template editor
export function treeToText(nodes: TemplateNode[], depth = 0): string {
  return nodes.map((n) => '  '.repeat(depth) + n.title + (n.children?.length ? '\n' + treeToText(n.children, depth + 1) : '')).join('\n')
}
export function textToTree(text: string): TemplateNode[] {
  const root: TemplateNode[] = []
  const stack: { depth: number; children: TemplateNode[] }[] = [{ depth: -1, children: root }]
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    const lead = raw.match(/^[\t ]*/)![0].replace(/\t/g, '  ').length
    const depth = Math.floor(lead / 2)
    const node: TemplateNode = { title: raw.trim().replace(/^[-*•]\s*/, '') }
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1]
    parent.children.push(node)
    node.children = []
    stack.push({ depth, children: node.children })
  }
  const clean = (ns: TemplateNode[]): TemplateNode[] => ns.map((n) => (n.children?.length ? { ...n, children: clean(n.children) } : { title: n.title }))
  return clean(root)
}

function TemplateSheet({ tpl, onClose }: { tpl: Template | null; onClose: () => void }) {
  const [name, setName] = useState(tpl?.name ?? '')
  const [itemTitle, setItemTitle] = useState(tpl?.item_title ?? '')
  const [tags, setTags] = useState((tpl?.tags ?? []).join(', '))
  const [text, setText] = useState(tpl ? treeToText(tpl.tree) : '')
  const save = () => {
    const row = {
      name: name.trim(),
      item_title: itemTitle.trim() || name.trim(),
      tags: tags.split(',').map((x) => x.trim().replace(/^#/, '').toLowerCase()).filter(Boolean),
      tree: textToTree(text),
    }
    if (tpl) void updateTemplate(tpl.id, row)
    else void addTemplate(row)
    onClose()
  }
  return (
    <Sheet open onClose={onClose} title={tpl ? tpl.name : t('settings.addTemplate')} wide>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save() }} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.templateName')}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New cup" /></Field>
          <Field label={t('settings.templateItemTitle')}><Input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder={name || 'Cup'} /></Field>
        </div>
        <Field label={t('settings.templateTags')}><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cup, glass" /></Field>
        <Field label={t('settings.templateTree')} hint={t('settings.templatesHint')}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const s = el.selectionStart
                const lineStart = text.lastIndexOf('\n', s - 1) + 1
                const next = e.shiftKey
                  ? (text.slice(lineStart, lineStart + 2) === '  ' ? text.slice(0, lineStart) + text.slice(lineStart + 2) : text)
                  : text.slice(0, lineStart) + '  ' + text.slice(lineStart)
                setText(next)
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + (next.length - text.length) })
              }
            }}
            rows={8}
            placeholder={'Design\nBlow the glass\n  Gather\n  Shape\nCold work\nPhotos'}
            className="block w-full rounded-2xl border border-line bg-surface p-3 font-mono text-sm leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>{t('common.save')}</Button>
        </div>
      </form>
    </Sheet>
  )
}
