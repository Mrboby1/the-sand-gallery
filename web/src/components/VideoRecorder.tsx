import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SwitchCamera, Video, X } from 'lucide-react'
import { toast, uploadFiles } from '../store/app'
import { saveRecordedVideo } from '../lib/download'
import { confirmDialog } from './ui'
import { t } from '../i18n'

/*
 * "Record video" (phones). Two ways, both upload straight into the open project/folder:
 *  1. The in-app recorder (default): getUserMedia + MediaRecorder. The clip exists only in the app and the Sand
 *     Gallery, so the phone's camera roll (and its photo backup) never gets a copy. A copy is saved to the phone only
 *     when Settings > Photos > "Save recorded videos to phone" is on (default off).
 *  2. "Use the phone's camera app" (`<input accept="video/*" capture>`): better quality, but Chrome on Android
 *     starts the camera with ACTION_VIDEO_CAPTURE and NO output file (unlike photos), so the camera app always
 *     keeps the clip in DCIM/Camera. That copy keeps its own name, so the Sus Gallery can match it (hash or name+size).
 */

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) { try { if (MediaRecorder.isTypeSupported(m)) return m } catch { /* ignore */ } }
  return ''
}

const canRecordInApp = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && pickRecorderMime() !== null

function recordedName(ext: string) {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0')
  return `SandGallery_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`
}

/** "Record video" for a project/folder: `start()` opens the recorder; render `ui` once. */
export function useRecordVideo(itemId: string | null): { start: () => void; ui: ReactNode } {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const cameraApp = () => { setOpen(false); input.current?.click() }
  const start = () => { if (!itemId) return; if (canRecordInApp()) setOpen(true); else input.current?.click() }
  const ui = (
    <>
      {/* the phone's camera app; the file keeps the camera's own name (PXL_...mp4) */}
      <input
        ref={input}
        type="file"
        accept="video/*"
        capture="environment"
        hidden
        data-testid="video-capture-input"
        onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length && itemId) void uploadFiles(itemId, files) }}
      />
      {open && itemId && (
        <VideoRecorder
          onClose={() => setOpen(false)}
          onCameraApp={cameraApp}
          onDone={(file) => { setOpen(false); void uploadFiles(itemId, [file]); saveRecordedVideo(file); toast(t('recorder.added'), 'info') }}
        />
      )}
    </>
  )
  return { start, ui }
}

type Phase = 'starting' | 'ready' | 'recording' | 'error'

export function VideoRecorder({ onClose, onDone, onCameraApp }: { onClose: () => void; onDone: (f: File) => void; onCameraApp: () => void }) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [elapsed, setElapsed] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const keep = useRef(true)
  const startedAt = useRef(0)
  const lock = useRef<{ release: () => Promise<void> } | null>(null)

  const stopTracks = () => { stream.current?.getTracks().forEach((tr) => tr.stop()); stream.current = null }

  // camera on (and again when switching front/back)
  useEffect(() => {
    let cancelled = false
    setPhase('starting')
    const video0 = { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
    stopTracks() // phones often allow one camera at a time
    ;(async () => {
      let s: MediaStream
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: video0, audio: true })
      } catch (e) {
        // no microphone (or not allowed): record without sound rather than not at all
        try { s = await navigator.mediaDevices.getUserMedia({ video: video0, audio: false }) } catch {
          if (!cancelled) { setError((e as Error).name === 'NotAllowedError' ? t('recorder.denied') : t('recorder.noCamera')); setPhase('error') }
          return
        }
      }
      if (cancelled) { s.getTracks().forEach((tr) => tr.stop()); return }
      stream.current = s
      if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}) }
      setPhase('ready')
    })()
    return () => { cancelled = true }
  }, [facing])

  // camera off when the recorder closes
  useEffect(() => () => {
    keep.current = false
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
    stopTracks()
    void lock.current?.release().catch(() => {})
  }, [])

  // the clock while recording
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 250)
    return () => clearInterval(id)
  }, [phase])

  // the app going to the background stops the camera: finish the clip with what was recorded
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'hidden' && rec.current?.state === 'recording') rec.current.stop() }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [])

  const begin = () => {
    const s = stream.current
    if (!s) return
    const mime = pickRecorderMime() ?? ''
    let r: MediaRecorder
    try {
      r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 })
    } catch {
      try { r = new MediaRecorder(s) } catch { setError(t('recorder.unsupported')); setPhase('error'); return }
    }
    chunks.current = []
    keep.current = true
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
    r.onstop = () => {
      void lock.current?.release().catch(() => {})
      lock.current = null
      if (!keep.current || !chunks.current.length) return
      const type = (r.mimeType || mime || 'video/webm').split(';')[0]
      const ext = type === 'video/mp4' ? 'mp4' : 'webm'
      const file = new File(chunks.current, recordedName(ext), { type, lastModified: Date.now() })
      chunks.current = []
      stopTracks()
      onDone(file)
    }
    r.start(1000)
    rec.current = r
    startedAt.current = Date.now()
    setElapsed(0)
    setPhase('recording')
    // keep the screen on while recording
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    void wl?.request('screen').then((l) => { lock.current = l }).catch(() => {})
  }

  const finish = () => { if (rec.current?.state === 'recording') rec.current.stop() }

  const close = async () => {
    if (phase === 'recording') {
      if (!(await confirmDialog(t('recorder.discard'), { danger: true, okLabel: t('recorder.discardOk') }))) return
      keep.current = false
      rec.current?.stop()
    }
    onClose()
  }

  const mmss = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  return createPortal(
    <div className="fade fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-label={t('recorder.title')}>
      <div className="flex items-center justify-between px-3 py-2 safe-top">
        <button onClick={() => void close()} aria-label={t('common.close')} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><X size={22} /></button>
        {phase === 'recording'
          ? <span className="inline-flex items-center gap-2 rounded-full bg-[#b4483c] px-3 py-1 text-sm font-medium tabular" aria-live="polite"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />{mmss(elapsed)}</span>
          : <span className="text-sm text-white/70">{t('recorder.title')}</span>}
        <button
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          disabled={phase !== 'ready'}
          aria-label={t('recorder.flip')}
          title={t('recorder.flip')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30"
        >
          <SwitchCamera size={21} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video ref={video} muted playsInline autoPlay className={`max-h-full max-w-full ${facing === 'user' ? '-scale-x-100' : ''}`} />
        {phase === 'starting' && <span className="absolute text-sm text-white/70">{t('recorder.starting')}</span>}
        {phase === 'error' && (
          <div className="absolute inset-x-6 flex flex-col items-center gap-4 text-center">
            <p className="text-[15px] leading-relaxed text-white/90">{error}</p>
            <button onClick={onCameraApp} className="h-11 rounded-full bg-white px-5 text-sm font-medium text-[#2a2017]">{t('recorder.cameraApp')}</button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-3 px-4 pb-4 pt-3 safe-bottom">
        {phase !== 'error' && (
          <button
            onClick={phase === 'recording' ? finish : begin}
            disabled={phase === 'starting'}
            aria-label={phase === 'recording' ? t('recorder.stop') : t('recorder.start')}
            data-testid="record-button"
            className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-4 border-white/90 transition active:scale-95 disabled:opacity-40"
          >
            <span className={phase === 'recording' ? 'h-7 w-7 rounded-md bg-[#e0503f]' : 'h-14 w-14 rounded-full bg-[#e0503f]'} />
          </button>
        )}
        {phase !== 'recording' && phase !== 'error' && (
          <button onClick={onCameraApp} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
            <Video size={14} /> {t('recorder.cameraApp')}
          </button>
        )}
        {phase !== 'recording' && <p className="max-w-sm text-center text-[12px] leading-snug text-white/50">{t('recorder.note')}</p>}
      </div>
    </div>,
    document.body,
  )
}
