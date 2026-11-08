import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { t } from '../i18n'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'soft' | 'ghost' | 'danger' | 'outline'
export function Button({ variant = 'soft', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variant === 'primary' && 'bg-accent text-white shadow-tile hover:bg-accent-strong dark:text-[#1d1813]',
        variant === 'soft' && 'bg-surface-2 text-ink hover:bg-accent-soft',
        variant === 'ghost' && 'text-ink hover:bg-surface-2',
        variant === 'outline' && 'border border-line text-ink hover:bg-surface-2',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95',
        active ? 'bg-accent-soft text-accent-strong' : 'text-ink/80 hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-10 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25',
        className,
      )}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

/** Modal that becomes a bottom sheet on phones. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fade absolute inset-0 bg-[#1a120a]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className={cx(
          'sheet relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lift sm:rounded-3xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="mx-auto -mt-2 mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        {title && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <IconButton label={t('common.close')} onClick={onClose}><X size={20} /></IconButton>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Small anchored popover menu. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cx('rise absolute z-40 mt-2 min-w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lift', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-surface-2', danger && 'text-danger')}>
      {icon && <span className="opacity-80">{icon}</span>}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- confirm / prompt dialogs
interface DialogReq { kind: 'confirm' | 'prompt'; title: string; body?: string; initial?: string; okLabel?: string; danger?: boolean; resolve: (v: string | boolean | null) => void }
const useDialog = create<{ req: DialogReq | null }>(() => ({ req: null }))

export function confirmDialog(title: string, opts: { body?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ req: { kind: 'confirm', title, ...opts, resolve: (v) => resolve(v === true) } }))
}
export function promptDialog(title: string, initial = '', okLabel?: string): Promise<string | null> {
  return new Promise((resolve) => useDialog.setState({ req: { kind: 'prompt', title, initial, okLabel, resolve: (v) => resolve(typeof v === 'string' ? v : null) } }))
}

export function DialogHost() {
  const req = useDialog((s) => s.req)
  const [val, setVal] = useState('')
  useEffect(() => { if (req) setVal(req.initial ?? '') }, [req])
  if (!req) return null
  const close = (v: string | boolean | null) => { useDialog.setState({ req: null }); req.resolve(v) }
  return (
    <Sheet open onClose={() => close(null)} title={req.title}>
      <form onSubmit={(e) => { e.preventDefault(); close(req.kind === 'prompt' ? val.trim() : true) }}>
        {req.body && <p className="mb-4 text-[15px] leading-relaxed text-muted">{req.body}</p>}
        {req.kind === 'prompt' && <Input autoFocus value={val} onChange={(e) => setVal(e.target.value)} className="mb-4" />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => close(null)}>{t('common.cancel')}</Button>
          <Button type="submit" variant={req.danger ? 'danger' : 'primary'} disabled={req.kind === 'prompt' && !val.trim()}>
            {req.okLabel ?? (req.kind === 'prompt' ? t('common.save') : t('common.done'))}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

export function Empty({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="rise flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4">{icon}</div>}
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {body && <p className="mt-2 max-w-sm text-[15px] text-muted">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}
