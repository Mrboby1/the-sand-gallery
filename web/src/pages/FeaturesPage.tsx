import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import { TopBar } from '../components/Shell'
import { FEATURE_GROUPS, featureHow, featureTitle, groupTitle } from '../lib/features'
import { cx } from '../components/ui'
import { t } from '../i18n'

/** Scrolls to an element and flashes it briefly (used by search results). */
export function flashTo(elementId: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(elementId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('flash')
    void el.offsetWidth // restart the animation
    el.classList.add('flash')
  })
}

/** Settings > Features & tips: every feature with a one-line "how to". */
export function FeaturesPage() {
  const [q, setQ] = useState('')
  const loc = useLocation()
  useEffect(() => { if (loc.hash) flashTo(`feat-${loc.hash.slice(1)}`) }, [loc.hash])
  const needle = q.trim().toLowerCase()
  const groups = useMemo(() => FEATURE_GROUPS.map((g) => ({
    ...g,
    features: g.features.filter((f) => !needle || `${t(featureTitle(f.id))} ${t(featureHow(f.id))} ${f.keywords}`.toLowerCase().includes(needle)),
  })).filter((g) => g.features.length), [needle])

  return (
    <div className="min-h-full pb-24">
      <TopBar back="/settings" title={t('settings.features')} />
      <main className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <div className="relative mb-4">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('settings.search')}
            className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-[16px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        {!groups.length && <p className="py-10 text-center text-muted">{t('settings.searchNone')}</p>}
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.id} className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="mb-2 font-display text-xl font-semibold">{t(groupTitle(g.id))}</h2>
              <ul className="flex flex-col">
                {g.features.map((f, i) => (
                  <li key={f.id} id={`feat-${f.id}`} className={cx('rounded-xl px-2 py-2.5', i > 0 && 'border-t border-line/60')}>
                    <div className="font-medium">{t(featureTitle(f.id))}</div>
                    <div className="text-[14px] leading-snug text-muted">{t(featureHow(f.id))}</div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
