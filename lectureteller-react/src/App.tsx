import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from './api/client'
import './App.css'

// ─── Types ──────────────────────────────────────────────────────────────────
interface ScriptItem {
  id: string
  title: string
  text: string
  voice: string
  created_at: string | null
  updated_at: string | null
  audio_updated_at: string | null
  has_audio: boolean
  audio_url: string | null
}

interface LibraryResponse {
  items: ScriptItem[]
  default_voice: string
}

interface ItemResponse extends LibraryResponse {
  item: ScriptItem
}

interface Settings {
  api_key: string
  audio_dir: string
  default_voice: string
  default_text_model: string
}

// ─── Constants ───────────────────────────────────────────────────────────────
const STEP = 10
const SPEED_STEP = 0.1
const MIN_PLAYBACK_RATE = 0.1
const MAX_PLAYBACK_RATE = 4.0
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const
const dateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function clampPlaybackRate(v: number) {
  return Math.round(clamp(v, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE) * 10) / 10
}

function formatPlaybackRate(v: number) {
  return `${clampPlaybackRate(v).toFixed(1)}x`
}

function formatTimestamp(v: string | null) {
  if (!v) return '-'
  const p = Date.parse(v)
  return Number.isNaN(p) ? '-' : dateFormatter.format(p)
}

function formatClock(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const tot = Math.floor(s)
  const h = Math.floor(tot / 3600)
  const m = Math.floor((tot % 3600) / 60)
  const sc = tot % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`
    : `${m}:${String(sc).padStart(2, '0')}`
}

function makeExcerpt(text: string, n = 72) {
  const c = text.replace(/\s+/g, ' ').trim()
  return c ? (c.length > n ? `${c.slice(0, n)}…` : c) : '내용 없음'
}

function makeDownloadName(title: string) {
  return title.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'script-audio'
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

// ─── Inline SVG Icons ────────────────────────────────────────────────────────
const IC = {
  Plus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Save: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  Mic: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  Trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
  Download: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Play: () => <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Pause: () => <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Restart: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>,
  Stop: () => <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  Music: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Warn: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Settings: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.25"/><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.95 1.95 0 1 1-2.76 2.76l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.92V20a2 2 0 1 1-4 0v-.14a1 1 0 0 0-.67-.95 1 1 0 0 0-1.1.2l-.1.1a1.95 1.95 0 1 1-2.76-2.76l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.92-.6H4a2 2 0 1 1 0-4h.14a1 1 0 0 0 .95-.67 1 1 0 0 0-.2-1.1l-.1-.1a1.95 1.95 0 1 1 2.76-2.76l.1.1a1 1 0 0 0 1.1.2h.05a1 1 0 0 0 .55-.9V4a2 2 0 1 1 4 0v.14a1 1 0 0 0 .67.95 1 1 0 0 0 1.1-.2l.1-.1a1.95 1.95 0 1 1 2.76 2.76l-.1.1a1 1 0 0 0-.2 1.1v.05a1 1 0 0 0 .9.55H20a2 2 0 1 1 0 4h-.14a1 1 0 0 0-.95.67z"/></svg>,
  Edit: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  ChevronUp: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>,
  ChevronDown: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  // State
  const [items, setItems]             = useState<ScriptItem[]>([])
  const [defaultVoice, setDefaultVoice] = useState('alloy')
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [title, setTitle]             = useState('')
  const [text, setText]               = useState('')
  const [query, setQuery]             = useState('')
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [message, setMessage]         = useState('')
  const [error, setError]             = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [shouldAutoplay, setShouldAutoplay] = useState(false)
  const [isPlaying, setIsPlaying]     = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [editorOpen, setEditorOpen]   = useState(true)
  const [settingsForm, setSettingsForm] = useState<Settings>({
    api_key: '',
    audio_dir: '',
    default_voice: 'alloy',
    default_text_model: '',
  })

  // Flash state for key-hit animations
  const [flashKey, setFlashKey]       = useState<string | null>(null)
  const [seekFlash, setSeekFlash]     = useState<'left' | 'right' | null>(null)

  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const playerRef   = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const saveLockRef = useRef(false)
  const generateLockRef = useRef(false)

  // Derived
  const selectedItem = useMemo(
    () => items.find(i => i.id === selectedId) ?? null,
    [items, selectedId],
  )

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter(i => `${i.title}\n${i.text}`.toLowerCase().includes(needle)) : items
  }, [items, query])

  const isDirty = useMemo(() => {
    return selectedItem
      ? title !== selectedItem.title || text !== selectedItem.text
      : title.trim().length > 0 || text.trim().length > 0
  }, [selectedItem, text, title])

  const activeAudioUrl = useMemo(() => {
    if (!selectedItem?.audio_url) return null
    if (selectedItem.text !== text) return null
    return selectedItem.audio_url
  }, [selectedItem, text])

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  // ── Flash helper ─────────────────────────────────────────────────────────
  function flash(key: string) {
    setFlashKey(key)
    setTimeout(() => setFlashKey(null), 300)
  }
  function flashSeek(dir: 'left' | 'right') {
    setSeekFlash(dir)
    setTimeout(() => setSeekFlash(null), 400)
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────
  const syncAudio = useCallback(() => {
    const a = audioRef.current
    if (!a) { setCurrentTime(0); setDuration(0); setIsPlaying(false); return }
    setCurrentTime(a.currentTime || 0)
    setDuration(Number.isFinite(a.duration) ? a.duration : 0)
    setIsPlaying(!a.paused && !a.ended)
  }, [])

  const focusPlayer = useCallback(() => playerRef.current?.focus(), [])

  function seekTo(t: number) {
    const a = audioRef.current
    if (!a) return
    const safe = clamp(t, 0, Number.isFinite(a.duration) ? a.duration : duration)
    a.currentTime = safe
    setCurrentTime(safe)
    focusPlayer()
  }

  function seekBy(delta: number) {
    const a = audioRef.current
    if (!a) return
    seekTo(a.currentTime + delta)
    flashSeek(delta < 0 ? 'left' : 'right')
    flash(delta < 0 ? 's' : 'f')
  }

  function play() {
    const a = audioRef.current
    if (!a || !activeAudioUrl) return
    void a.play().then(() => focusPlayer()).catch(() => undefined)
  }
  function pause() {
    audioRef.current?.pause()
    syncAudio()
  }
  function togglePlayback() {
    const a = audioRef.current
    if (!a || !activeAudioUrl) return
    if (a.paused || a.ended) { play(); flash('d') }
    else { pause(); flash('d') }
  }
  function restart() {
    const a = audioRef.current
    if (!a) return
    a.currentTime = 0
    setCurrentTime(0)
    play()
    flash('a')
  }
  function stop() {
    const a = audioRef.current
    if (!a) return
    a.pause()
    a.currentTime = 0
    setCurrentTime(0)
    setIsPlaying(false)
    flash('g')
    focusPlayer()
  }

  function applyPlaybackRate(nextRate: number) {
    const next = clampPlaybackRate(nextRate)
    if (audioRef.current) audioRef.current.playbackRate = next
    setPlaybackRate(next)
    return next
  }

  function changePlaybackRate(delta: number) {
    const next = clampPlaybackRate(playbackRate + delta)
    if (next === playbackRate) return
    applyPlaybackRate(next)
    flash(delta < 0 ? 'h' : 'j')
    focusPlayer()
  }

  // ── Server calls ──────────────────────────────────────────────────────────
  async function loadLibrary() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch<LibraryResponse>('/api/simple/library')
      setItems(res.items)
      setDefaultVoice(res.default_voice)
      if (res.items.length > 0) {
        const first = res.items[0]
        setSelectedId(first.id); setTitle(first.title); setText(first.text)
        // If first item already has audio, show player instead of editor
        setEditorOpen(!first.has_audio)
      }
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  async function loadSettings() {
    try {
      const res = await apiFetch<Settings>('/api/settings')
      setSettingsForm({
        api_key: res.api_key ?? '',
        audio_dir: res.audio_dir ?? '',
        default_voice: res.default_voice || 'alloy',
        default_text_model: res.default_text_model ?? '',
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function syncFromResponse(res: ItemResponse) {
    setItems(res.items)
    setDefaultVoice(res.default_voice)
    setSelectedId(res.item.id)
    setTitle(res.item.title)
    setText(res.item.text)
  }

  async function saveScript() {
    if (saveLockRef.current || generateLockRef.current) return
    saveLockRef.current = true
    setSaving(true); setError(''); setMessage('')
    try {
      const res = await apiFetch<ItemResponse>('/api/simple/items', {
        method: 'POST',
        body: JSON.stringify({ item_id: selectedId, title, text }),
      })
      syncFromResponse(res)
      setMessage('저장됨')
    } catch (e) { setError((e as Error).message) }
    finally {
      saveLockRef.current = false
      setSaving(false)
    }
  }

  async function generateTts() {
    if (saveLockRef.current || generateLockRef.current) return
    generateLockRef.current = true
    setGenerating(true); setError(''); setMessage('')
    try {
      const res = await apiFetch<ItemResponse & { chunk_count: number }>('/api/simple/generate', {
        method: 'POST',
        body: JSON.stringify({ item_id: selectedId, title, text }),
      })
      syncFromResponse(res)
      setMessage(`음성 생성 완료 · ${res.chunk_count}개 청크`)
      setShouldAutoplay(true)
      setEditorOpen(false) // switch focus to player after generation
    } catch (e) {
      setError((e as Error).message)
      setShouldAutoplay(false)
    } finally {
      generateLockRef.current = false
      setGenerating(false)
    }
  }

  async function openSettings() {
    setError('')
    await loadSettings()
    setSettingsOpen(true)
  }

  async function saveAppSettings() {
    if (settingsSaving) return
    setSettingsSaving(true)
    setError('')
    setMessage('')
    try {
      const payload: Settings = {
        ...settingsForm,
        api_key: settingsForm.api_key.trim(),
        default_voice: settingsForm.default_voice || 'alloy',
      }
      const saved = await apiFetch<Settings>('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSettingsForm({
        api_key: saved.api_key ?? '',
        audio_dir: saved.audio_dir ?? '',
        default_voice: saved.default_voice || 'alloy',
        default_text_model: saved.default_text_model ?? '',
      })
      setDefaultVoice(saved.default_voice || 'alloy')
      setSettingsOpen(false)
      setMessage('설정을 저장했습니다.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSettingsSaving(false)
    }
  }

  async function deleteScript() {
    if (!selectedItem || saving || generating) return
    if (!window.confirm(`"${selectedItem.title}" 을(를) 삭제할까요?`)) return
    setError(''); setMessage('')
    try {
      const res = await apiFetch<LibraryResponse>(`/api/simple/items/${selectedItem.id}`, { method: 'DELETE' })
      setItems(res.items)
      setDefaultVoice(res.default_voice)
      if (res.items.length > 0) {
        const n = res.items[0]; setSelectedId(n.id); setTitle(n.title); setText(n.text)
      } else { resetEditor() }
      setMessage('삭제됨')
    } catch (e) { setError((e as Error).message) }
  }

  function selectItem(item: ScriptItem) {
    setSelectedId(item.id); setTitle(item.title); setText(item.text)
    setShouldAutoplay(false); setMessage(''); setError('')
    // Open editor if no audio, else show player
    setEditorOpen(!item.has_audio)
  }

  function resetEditor() {
    setSelectedId(null); setTitle(''); setText('')
    setShouldAutoplay(false); setMessage(''); setError('')
    setEditorOpen(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => { void loadLibrary() }, [])

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(t)
  }, [message])

  useEffect(() => {
    setCurrentTime(0); setDuration(0); setIsPlaying(false)
  }, [activeAudioUrl])

  useEffect(() => {
    if (!shouldAutoplay || !activeAudioUrl || !audioRef.current) return
    audioRef.current.currentTime = 0
    void audioRef.current.play().then(() => focusPlayer()).catch(() => undefined)
    setShouldAutoplay(false)
  }, [activeAudioUrl, shouldAutoplay, focusPlayer])

  useEffect(() => {
    if (!audioRef.current) return
    audioRef.current.playbackRate = playbackRate
  }, [activeAudioUrl, playbackRate])

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  // Home-row layout: A=restart  S=-10s  D=play/pause  F=+10s  G=stop  H=-0.1x  J=+0.1x
  // These fire globally when audio is active and user is NOT typing.
  // Ctrl+S / Ctrl+Enter always work regardless.
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const key = e.key.toLowerCase()
      const typing = isTyping(e.target)

      // Always-on editor shortcuts
      if ((e.metaKey || e.ctrlKey) && key === 's') { e.preventDefault(); void saveScript(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void generateTts(); return }

      // Home-row player shortcuts — no modifier, global during playback
      if (!activeAudioUrl) return
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      switch (key) {
        case 'a': e.preventDefault(); restart(); return
        case 's': e.preventDefault(); seekBy(-STEP); return
        case 'd': e.preventDefault(); togglePlayback(); return
        case 'f': e.preventDefault(); seekBy(STEP); return
        case 'g': e.preventDefault(); stop(); return
        case 'h': e.preventDefault(); changePlaybackRate(-SPEED_STEP); return
        case 'j': e.preventDefault(); changePlaybackRate(SPEED_STEP); return
        // Arrow keys as bonus
        case 'arrowleft':  e.preventDefault(); seekBy(-STEP); return
        case 'arrowright': e.preventDefault(); seekBy(STEP); return
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [activeAudioUrl, generating, playbackRate, saving, selectedId, text, title, duration])

  const isBusy = saving || generating

  return (
    <div className="app-frame">
      {/* ═══════ SIDEBAR ═══════ */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-icon">🎙</span>
            <div>
              <div className="brand-name">LectureTeller</div>
              <div className="brand-sub">TTS 대본 관리</div>
            </div>
          </div>
          <button className="icon-btn" type="button" onClick={resetEditor} title="새 대본">
            <IC.Plus />
          </button>
        </div>

        <div className="search-wrap">
          <span className="search-icon"><IC.Search /></span>
          <input
            id="search"
            type="search"
            className="search-input"
            placeholder="대본 검색..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="list-meta">
          <span>{filteredItems.length}개 대본</span>
          <span className="voice-badge">{defaultVoice}</span>
        </div>

        <div className="script-list">
          {loading ? (
            <div className="empty-state"><div className="loading-dot" /><span>불러오는 중...</span></div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state"><span>대본 없음</span><small>+ 버튼으로 새로 만드세요</small></div>
          ) : filteredItems.map(item => (
            <button
              key={item.id}
              className={`script-card ${item.id === selectedId ? 'active' : ''}`}
              type="button"
              onClick={() => selectItem(item)}
            >
              <div className="card-top">
                <span className="card-title">{item.title}</span>
                {item.has_audio && <span className="has-audio-dot" title="음성 있음"><IC.Music /></span>}
              </div>
              <p className="card-excerpt">{makeExcerpt(item.text)}</p>
              <span className="card-date">{formatTimestamp(item.updated_at)}</span>
            </button>
          ))}
        </div>

        <button className="new-script-fab" type="button" onClick={resetEditor}>
          <IC.Plus /> 새 대본
        </button>
      </aside>

      {/* ═══════ MAIN ═══════ */}
      <main className="main-content">
        {/* ── Top bar ── */}
        <div className="topbar">
          <div className="topbar-left">
            <span className="doc-title">{selectedItem?.title || (title.trim() || '새 대본')}</span>
            <StatusBadge error={error} saving={saving} generating={generating} message={message} isDirty={isDirty} selectedItem={selectedItem} />
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" type="button" onClick={() => void openSettings()} title="설정" disabled={settingsSaving}>
              <IC.Settings />
            </button>
            {selectedItem && (
              <button className="icon-btn danger" type="button" onClick={() => void deleteScript()} disabled={isBusy} title="삭제">
                <IC.Trash />
              </button>
            )}
            <button className="action-btn secondary" type="button" onClick={() => void saveScript()} disabled={isBusy}>
              <IC.Save /> 저장 <kbd>Ctrl+S</kbd>
            </button>
            <button className="action-btn primary" type="button" onClick={() => void generateTts()} disabled={isBusy}>
              {generating ? <><span className="spin-icon">⟳</span> 생성 중...</> : <><IC.Mic /> 음성 만들기</>}
              {!generating && <kbd>Ctrl+↵</kbd>}
            </button>
          </div>
        </div>

        {/* ── Player (MAIN SECTION) ── */}
        <div className="player-section">
          <audio
            ref={audioRef}
            src={activeAudioUrl || undefined}
            preload="metadata"
            onLoadedMetadata={syncAudio}
            onDurationChange={syncAudio}
            onTimeUpdate={syncAudio}
            onPlay={syncAudio}
            onPause={syncAudio}
            onEnded={syncAudio}
          />

          {activeAudioUrl ? (
            <div
              ref={playerRef}
              className={`player ${isPlaying ? 'playing' : ''}`}
              tabIndex={0}
              aria-label="오디오 플레이어. A S D F G H J 단축키 사용"
              onClick={e => { if (e.target === e.currentTarget) focusPlayer() }}
            >
              {/* Ambient glow behind player when playing */}
              <div className={`player-glow ${isPlaying ? 'active' : ''}`} />

              {/* Track info */}
              <div className="player-track">
                <div className="track-title">{selectedItem?.title || '재생 중'}</div>
                <div className="track-sub">
                  {selectedItem?.voice && <span className="track-voice">{selectedItem.voice}</span>}
                  <span className="track-date">{formatTimestamp(selectedItem?.audio_updated_at ?? null)}</span>
                </div>
              </div>

              {/* Progress */}
              <div className="progress-area">
                <div className={`seek-flash left ${seekFlash === 'left' ? 'show' : ''}`}>◀◀ {STEP}s</div>
                <div className={`seek-flash right ${seekFlash === 'right' ? 'show' : ''}`}>{STEP}s ▶▶</div>

                <div className="progress-wrap">
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${isPlaying ? 'animated' : ''}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <input
                    className="progress-input"
                    type="range"
                    min={0}
                    max={Math.max(duration, 0.1)}
                    step={0.1}
                    value={Math.min(currentTime, Math.max(duration, 0.1))}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => seekTo(Number(e.target.value))}
                    aria-label="재생 위치"
                  />
                </div>

                <div className="time-row">
                  <span className="time-cur">{formatClock(currentTime)}</span>
                  <span className="time-rem">-{formatClock(Math.max(0, duration - currentTime))}</span>
                </div>
              </div>

              <div className="speed-row">
                <span className="speed-label">배속</span>
                <button
                  className={`speed-step-btn ${flashKey === 'h' ? 'key-flash' : ''}`}
                  type="button"
                  onClick={() => changePlaybackRate(-SPEED_STEP)}
                  title={`배속 -${SPEED_STEP.toFixed(1)}x (H)`}
                >
                  -{SPEED_STEP.toFixed(1)}x
                </button>
                <input
                  className="speed-slider"
                  type="range"
                  min={MIN_PLAYBACK_RATE}
                  max={MAX_PLAYBACK_RATE}
                  step={SPEED_STEP}
                  value={playbackRate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => applyPlaybackRate(Number(e.target.value))}
                  aria-label="재생 배속"
                />
                <button
                  className={`speed-step-btn ${flashKey === 'j' ? 'key-flash' : ''}`}
                  type="button"
                  onClick={() => changePlaybackRate(SPEED_STEP)}
                  title={`배속 +${SPEED_STEP.toFixed(1)}x (J)`}
                >
                  +{SPEED_STEP.toFixed(1)}x
                </button>
                <span className="speed-display">{formatPlaybackRate(playbackRate)}</span>
              </div>

              {/* Controls — matching A S D F G home row */}
              <div className="controls-row">
                <button
                  className={`ctrl-btn ${flashKey === 'a' ? 'key-flash' : ''}`}
                  type="button" onClick={restart} title="처음부터 (A)"
                >
                  <IC.Restart />
                </button>
                <button
                  className={`ctrl-btn ${flashKey === 's' ? 'key-flash' : ''}`}
                  type="button" onClick={() => seekBy(-STEP)} title={`-${STEP}초 (S)`}
                >
                  <span className="ctrl-label">-{STEP}s</span>
                </button>

                <button
                  className={`play-btn ${isPlaying ? 'pausing' : ''} ${flashKey === 'd' ? 'key-flash' : ''}`}
                  type="button" onClick={togglePlayback} title="재생/정지 (D)"
                >
                  {isPlaying ? <IC.Pause /> : <IC.Play />}
                  {isPlaying && <span className="play-pulse" />}
                </button>

                <button
                  className={`ctrl-btn ${flashKey === 'f' ? 'key-flash' : ''}`}
                  type="button" onClick={() => seekBy(STEP)} title={`+${STEP}초 (F)`}
                >
                  <span className="ctrl-label">+{STEP}s</span>
                </button>
                <button
                  className={`ctrl-btn ${flashKey === 'g' ? 'key-flash' : ''}`}
                  type="button" onClick={stop} title="정지 (G)"
                >
                  <IC.Stop />
                </button>

                <a
                  className="ctrl-btn download-btn"
                  href={activeAudioUrl}
                  download={`${makeDownloadName(selectedItem?.title || title)}.mp3`}
                  title="MP3 다운로드"
                >
                  <IC.Download />
                </a>
              </div>

              {/* Shortcut hints — home-row A S D F G H J */}
              <div className="shortcut-row">
                {[
                  { k: 'A', desc: '처음' },
                  { k: 'S', desc: `-${STEP}s` },
                  { k: 'D', desc: '재생/정지' },
                  { k: 'F', desc: `+${STEP}s` },
                  { k: 'G', desc: '정지' },
                  { k: 'H', desc: `-${SPEED_STEP.toFixed(1)}x` },
                  { k: 'J', desc: `+${SPEED_STEP.toFixed(1)}x` },
                ].map(({ k, desc }) => (
                  <div key={k} className={`shortcut-chip ${flashKey === k.toLowerCase() ? 'chip-active' : ''}`}>
                    <kbd>{k}</kbd>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="player player-empty">
              <div className="empty-player-icon"><IC.Mic /></div>
              <p>음성 파일이 없습니다</p>
              <small>대본을 저장한 뒤 <strong>음성 만들기</strong>를 누르세요</small>
            </div>
          )}
        </div>

        {/* ── Editor (secondary, collapsible) ── */}
        <div className={`editor-panel ${editorOpen ? 'open' : 'closed'}`}>
          <button
            className="editor-toggle"
            type="button"
            onClick={() => setEditorOpen(o => !o)}
            title={editorOpen ? '편집기 접기' : '편집기 열기'}
          >
            <IC.Edit />
            <span>대본 편집</span>
            {isDirty && <span className="dirty-dot" title="저장 안 됨" />}
            <span className="toggle-arrow">{editorOpen ? <IC.ChevronDown /> : <IC.ChevronUp />}</span>
          </button>

          {editorOpen && (
            <div className="editor-body">
              <input
                id="title"
                type="text"
                className="title-input"
                placeholder="제목 (비워두면 첫 줄로 자동 생성)"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
              <textarea
                id="script"
                ref={textareaRef}
                className="script-textarea"
                placeholder="대본을 여기에 붙여넣으세요..."
                value={text}
                onChange={e => setText(e.target.value)}
              />
            </div>
          )}
        </div>
      </main>

      {settingsOpen && (
        <div className="settings-overlay" role="dialog" aria-modal="true" onClick={() => setSettingsOpen(false)}>
          <div className="settings-card" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <div>
                <strong>설정</strong>
                <p>OpenAI API Key와 기본 목소리를 저장합니다.</p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setSettingsOpen(false)} title="닫기">
                <IC.ChevronDown />
              </button>
            </div>

            <div className="settings-form">
              <label className="settings-field">
                <span>OpenAI API Key</span>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="sk-..."
                  value={settingsForm.api_key}
                  onChange={e => setSettingsForm(current => ({ ...current, api_key: e.target.value }))}
                />
              </label>

              <label className="settings-field">
                <span>기본 목소리</span>
                <select
                  className="settings-input"
                  value={settingsForm.default_voice}
                  onChange={e => setSettingsForm(current => ({ ...current, default_voice: e.target.value }))}
                >
                  {VOICES.map(voice => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-footer">
              <button className="action-btn secondary" type="button" onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>
                취소
              </button>
              <button className="action-btn primary" type="button" onClick={() => void saveAppSettings()} disabled={settingsSaving}>
                <IC.Save /> {settingsSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({
  error, saving, generating, message, isDirty, selectedItem,
}: {
  error: string; saving: boolean; generating: boolean
  message: string; isDirty: boolean; selectedItem: ScriptItem | null
}) {
  if (error)      return <span className="status-badge status-error"><IC.Warn /> {error}</span>
  if (generating) return <span className="status-badge status-busy">🔄 생성 중...</span>
  if (saving)     return <span className="status-badge status-busy">저장 중...</span>
  if (message)    return <span className="status-badge status-ok"><IC.Check /> {message}</span>
  if (isDirty)    return <span className="status-badge status-dirty">● 저장 안 됨</span>
  if (selectedItem) {
    const ts = selectedItem.updated_at || selectedItem.created_at
    return <span className="status-badge status-saved">저장됨 · {ts ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(Date.parse(ts)) : ''}</span>
  }
  return <span className="status-badge status-new">새 대본</span>
}
