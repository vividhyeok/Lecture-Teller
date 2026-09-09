import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { apiFetch } from './api/client'
import './AppStable.css'

type Recipe = 'stt-fix' | 'lecture' | 'audit'
type EditorTab = 'source' | 'clean' | 'script'

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

interface LectureMeta {
  collection?: string
  subject?: string
  source_text?: string
  clean_text?: string
  context_note?: string
  favorite?: boolean
  last_position?: number
  prompt_version?: string
  updated_at?: string
}

interface MetaResponse {
  items: Record<string, LectureMeta>
  prompt_version: string
  text_model: string
}

interface ComposeResponse {
  prompt: string
  prompt_version: string
  text_model: string
}

interface GenerateResponse extends ComposeResponse {
  text: string
}

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const
const PREVIEW_TEXT = '자, 그렇다면 여기서 한 가지 질문이 생깁니다. 여러 프로세스가 동시에 CPU를 사용하려고 하면 운영체제는 어떻게 해야 할까요?'
const SEEK_STEP = 10
const dateFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

function normalize(value: string | null | undefined) {
  return (value ?? '').trim()
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const time = Date.parse(value)
  return Number.isNaN(time) ? '-' : dateFmt.format(time)
}

function formatClock(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const total = Math.floor(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function excerpt(value: string, max = 78) {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return '내용 없음'
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function downloadName(title: string) {
  return (title.trim() || 'lecture').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

async function previewVoice(voice: string) {
  const response = await fetch('/api/settings/preview-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice, text: PREVIEW_TEXT }),
  })
  if (!response.ok) {
    let message = '음성 미리듣기에 실패했습니다.'
    try {
      const data = await response.json() as { detail?: string }
      message = data.detail || message
    } catch {
      // keep fallback
    }
    throw new Error(message)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
  await audio.play()
}

function recipeLabel(recipe: Recipe) {
  if (recipe === 'stt-fix') return 'STT 보정'
  if (recipe === 'audit') return '누락 검수'
  return '강의 대본화'
}

export default function AppStable() {
  const [items, setItems] = useState<ScriptItem[]>([])
  const [metaMap, setMetaMap] = useState<Record<string, LectureMeta>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [defaultVoice, setDefaultVoice] = useState('alloy')
  const [selectedVoice, setSelectedVoice] = useState('alloy')
  const [promptVersion, setPromptVersion] = useState('')
  const [textModel, setTextModel] = useState('')

  const [title, setTitle] = useState('')
  const [scriptText, setScriptText] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [cleanText, setCleanText] = useState('')
  const [contextNote, setContextNote] = useState('')
  const [collection, setCollection] = useState('')
  const [subject, setSubject] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [editorTab, setEditorTab] = useState<EditorTab>('script')

  const [query, setQuery] = useState('')
  const [filterCollection, setFilterCollection] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingTts, setGeneratingTts] = useState(false)
  const [generatingScript, setGeneratingScript] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Settings>({
    api_key: '',
    audio_dir: '',
    default_voice: 'alloy',
    default_text_model: '',
  })

  const [promptOpen, setPromptOpen] = useState(false)
  const [promptRecipe, setPromptRecipe] = useState<Recipe>('lecture')
  const [promptText, setPromptText] = useState('')
  const [promptModel, setPromptModel] = useState('')
  const [promptRecipeVersion, setPromptRecipeVersion] = useState('')
  const [promptLoading, setPromptLoading] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const lastPositionWriteRef = useRef(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  const selectedMeta = selectedId ? metaMap[selectedId] ?? {} : {}

  const collections = useMemo(() => {
    const values = new Set<string>()
    items.forEach(item => {
      const value = normalize(metaMap[item.id]?.collection)
      if (value) values.add(value)
    })
    return [...values].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [items, metaMap])

  const subjects = useMemo(() => {
    const values = new Set<string>()
    items.forEach(item => {
      const value = normalize(metaMap[item.id]?.subject)
      if (value) values.add(value)
    })
    return [...values].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [items, metaMap])

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items
      .filter(item => {
        const meta = metaMap[item.id] ?? {}
        if (filterCollection !== 'all' && normalize(meta.collection) !== filterCollection) return false
        if (!needle) return true
        const haystack = [
          item.title,
          item.text,
          meta.collection,
          meta.subject,
          meta.source_text,
          meta.clean_text,
        ].join('\n').toLowerCase()
        return haystack.includes(needle)
      })
      .sort((a, b) => {
        const af = metaMap[a.id]?.favorite ? 1 : 0
        const bf = metaMap[b.id]?.favorite ? 1 : 0
        if (af !== bf) return bf - af
        const at = Date.parse(a.updated_at || a.created_at || '') || 0
        const bt = Date.parse(b.updated_at || b.created_at || '') || 0
        return bt - at
      })
  }, [filterCollection, items, metaMap, query])

  const groupedItems = useMemo(() => {
    const groups = new Map<string, Map<string, ScriptItem[]>>()
    filteredItems.forEach(item => {
      const meta = metaMap[item.id] ?? {}
      const c = normalize(meta.collection) || '미분류'
      const s = normalize(meta.subject) || '기타'
      if (!groups.has(c)) groups.set(c, new Map())
      const subjectMap = groups.get(c)!
      if (!subjectMap.has(s)) subjectMap.set(s, [])
      subjectMap.get(s)!.push(item)
    })
    return [...groups.entries()]
  }, [filteredItems, metaMap])

  const activeAudioUrl = selectedItem?.has_audio && selectedItem.text === scriptText
    ? selectedItem.audio_url
    : null

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [library, stable] = await Promise.all([
        apiFetch<LibraryResponse>('/api/simple/library'),
        apiFetch<MetaResponse>('/api/stable/meta'),
      ])
      setItems(library.items)
      setDefaultVoice(library.default_voice || 'alloy')
      setMetaMap(stable.items || {})
      setPromptVersion(stable.prompt_version || '')
      setTextModel(stable.text_model || '')

      const first = library.items[0]
      if (first) {
        const meta = stable.items?.[first.id] ?? {}
        setSelectedId(first.id)
        setTitle(first.title)
        setScriptText(first.text)
        setSelectedVoice(first.voice || library.default_voice || 'alloy')
        setSourceText(meta.source_text || '')
        setCleanText(meta.clean_text || '')
        setContextNote(meta.context_note || '')
        setCollection(meta.collection || '')
        setSubject(meta.subject || '')
        setFavorite(Boolean(meta.favorite))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!message) return
    const id = window.setTimeout(() => setMessage(''), 3200)
    return () => window.clearTimeout(id)
  }, [message])

  useEffect(() => {
    if (!audioRef.current) return
    audioRef.current.playbackRate = playbackRate
  }, [playbackRate, activeAudioUrl])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!activeAudioUrl || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'd') {
        event.preventDefault()
        if (audioRef.current?.paused) void audioRef.current.play()
        else audioRef.current?.pause()
      }
      if (key === 's') {
        event.preventDefault()
        seekBy(-SEEK_STEP)
      }
      if (key === 'f') {
        event.preventDefault()
        seekBy(SEEK_STEP)
      }
      if (key === 'a') {
        event.preventDefault()
        seekTo(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function resetNew() {
    setSelectedId(null)
    setTitle('')
    setScriptText('')
    setSourceText('')
    setCleanText('')
    setContextNote('')
    setCollection('')
    setSubject('')
    setFavorite(false)
    setSelectedVoice(defaultVoice || 'alloy')
    setEditorTab('script')
    setMessage('')
    setError('')
    setCurrentTime(0)
    setDuration(0)
  }

  function selectItem(item: ScriptItem) {
    const meta = metaMap[item.id] ?? {}
    setSelectedId(item.id)
    setTitle(item.title)
    setScriptText(item.text)
    setSelectedVoice(item.voice || defaultVoice || 'alloy')
    setSourceText(meta.source_text || '')
    setCleanText(meta.clean_text || '')
    setContextNote(meta.context_note || '')
    setCollection(meta.collection || '')
    setSubject(meta.subject || '')
    setFavorite(Boolean(meta.favorite))
    setEditorTab('script')
    setCurrentTime(0)
    setDuration(0)
    setMessage('')
    setError('')
  }

  async function patchMeta(itemId: string, patch: Partial<LectureMeta>, silent = false) {
    const response = await apiFetch<{ item_id: string; meta: LectureMeta }>(`/api/stable/meta/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    setMetaMap(current => ({ ...current, [itemId]: response.meta }))
    if (!silent) setMessage('학습 자료 정보 저장됨')
    return response.meta
  }

  async function saveScript(showMessage = true) {
    if (saving || generatingTts) return null
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch<ItemResponse>('/api/simple/items', {
        method: 'POST',
        body: JSON.stringify({ item_id: selectedId, title, text: scriptText }),
      })
      setItems(response.items)
      setDefaultVoice(response.default_voice || defaultVoice)
      setSelectedId(response.item.id)
      setTitle(response.item.title)
      setScriptText(response.item.text)
      await patchMeta(response.item.id, {
        collection,
        subject,
        source_text: sourceText,
        clean_text: cleanText,
        context_note: contextNote,
        favorite,
        prompt_version: promptVersion,
      }, true)
      if (showMessage) setMessage('저장됨')
      return response.item
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function deleteCurrent() {
    if (!selectedItem || !window.confirm(`"${selectedItem.title}"을(를) 삭제할까요?`)) return
    setError('')
    try {
      const library = await apiFetch<LibraryResponse>(`/api/simple/items/${encodeURIComponent(selectedItem.id)}`, { method: 'DELETE' })
      await fetch(`/api/stable/meta/${encodeURIComponent(selectedItem.id)}`, { method: 'DELETE' }).catch(() => undefined)
      setItems(library.items)
      setMetaMap(current => {
        const next = { ...current }
        delete next[selectedItem.id]
        return next
      })
      const next = library.items[0]
      if (next) selectItem(next)
      else resetNew()
      setMessage('삭제됨')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function generateTts() {
    if (generatingTts) return
    setGeneratingTts(true)
    setError('')
    setMessage('')
    try {
      const saved = await saveScript(false)
      const itemId = saved?.id || selectedId
      if (!itemId) throw new Error('대본을 먼저 저장할 수 없습니다.')
      const response = await apiFetch<ItemResponse & { chunk_count: number }>('/api/simple/generate', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          title,
          text: scriptText,
          voice: selectedVoice,
        }),
      })
      setItems(response.items)
      setDefaultVoice(response.default_voice || defaultVoice)
      setSelectedId(response.item.id)
      setTitle(response.item.title)
      setScriptText(response.item.text)
      setSelectedVoice(response.item.voice || selectedVoice)
      setMessage(`음성 생성 완료 · ${response.item.voice || selectedVoice} · ${response.chunk_count}개 청크`)
      window.setTimeout(() => {
        if (audioRef.current) void audioRef.current.play().catch(() => undefined)
      }, 120)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGeneratingTts(false)
    }
  }

  function sourceForRecipe(recipe: Recipe) {
    if (recipe === 'stt-fix') return sourceText || scriptText
    return cleanText || sourceText || scriptText
  }

  async function composePrompt(recipe: Recipe) {
    setPromptLoading(true)
    setError('')
    try {
      const response = await apiFetch<ComposeResponse>('/api/stable/compose', {
        method: 'POST',
        body: JSON.stringify({
          recipe,
          title,
          source: sourceForRecipe(recipe),
          script: scriptText,
          context_note: contextNote,
        }),
      })
      setPromptRecipe(recipe)
      setPromptText(response.prompt)
      setPromptModel(response.text_model)
      setPromptRecipeVersion(response.prompt_version)
      setPromptOpen(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPromptLoading(false)
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(promptText)
      setMessage(`${recipeLabel(promptRecipe)} 프롬프트 복사됨`)
    } catch {
      setError('클립보드 복사에 실패했습니다.')
    }
  }

  async function directGenerate() {
    if (generatingScript) return
    setGeneratingScript(true)
    setError('')
    try {
      const response = await apiFetch<GenerateResponse>('/api/stable/generate', {
        method: 'POST',
        body: JSON.stringify({
          recipe: 'lecture',
          title,
          source: sourceForRecipe('lecture'),
          script: '',
          context_note: contextNote,
        }),
      })
      setScriptText(response.text)
      setPromptVersion(response.prompt_version)
      setTextModel(response.text_model)
      setEditorTab('script')
      setPromptOpen(false)
      setMessage(`대본 생성 완료 · ${response.prompt_version}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGeneratingScript(false)
    }
  }

  async function loadSettings() {
    const settings = await apiFetch<Settings>('/api/settings')
    setSettingsForm({
      api_key: settings.api_key ?? '',
      audio_dir: settings.audio_dir ?? '',
      default_voice: settings.default_voice || 'alloy',
      default_text_model: settings.default_text_model ?? '',
    })
  }

  async function openSettings() {
    setError('')
    try {
      await loadSettings()
      setSettingsOpen(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function saveSettings() {
    if (settingsSaving) return
    setSettingsSaving(true)
    setError('')
    try {
      const saved = await apiFetch<Settings>('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          ...settingsForm,
          api_key: settingsForm.api_key.trim(),
          default_voice: settingsForm.default_voice || 'alloy',
        }),
      })
      setSettingsForm(saved)
      setDefaultVoice(saved.default_voice || 'alloy')
      if (!selectedItem?.voice) setSelectedVoice(saved.default_voice || 'alloy')
      setSettingsOpen(false)
      setMessage('설정 저장됨')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSettingsSaving(false)
    }
  }

  async function toggleFavorite() {
    const next = !favorite
    setFavorite(next)
    if (selectedId) {
      try {
        await patchMeta(selectedId, { favorite: next }, true)
      } catch (e) {
        setFavorite(!next)
        setError((e as Error).message)
      }
    }
  }

  async function saveClassification() {
    if (!selectedId) {
      await saveScript()
      return
    }
    try {
      await patchMeta(selectedId, { collection, subject, context_note: contextNote })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function seekTo(value: number) {
    if (!audioRef.current) return
    const max = Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration
    const safe = Math.max(0, Math.min(value, max || 0))
    audioRef.current.currentTime = safe
    setCurrentTime(safe)
  }

  function seekBy(delta: number) {
    seekTo((audioRef.current?.currentTime || currentTime) + delta)
  }

  async function persistPosition(force = false) {
    if (!selectedId || !audioRef.current) return
    const now = Date.now()
    if (!force && now - lastPositionWriteRef.current < 5000) return
    lastPositionWriteRef.current = now
    try {
      await patchMeta(selectedId, { last_position: audioRef.current.currentTime }, true)
    } catch {
      // playback should never be interrupted by metadata persistence
    }
  }

  function onLoadedMetadata() {
    if (!audioRef.current) return
    setDuration(Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : 0)
    const saved = Number(selectedMeta.last_position || 0)
    if (saved > 0 && saved < audioRef.current.duration - 1) {
      audioRef.current.currentTime = saved
      setCurrentTime(saved)
    }
  }

  const collectionSuggestions = collections
  const subjectSuggestions = subjects

  return (
    <div className="stable-app">
      <aside className="stable-sidebar">
        <div className="stable-brand-row">
          <div>
            <div className="stable-brand">LectureTeller</div>
            <div className="stable-brand-sub">대본 → 자연스러운 음성 학습</div>
          </div>
          <button className="icon-button" onClick={resetNew} title="새 강의">＋</button>
        </div>

        <div className="stable-search">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="제목·과목·대본 검색"
          />
        </div>

        <div className="collection-filter">
          <button
            className={filterCollection === 'all' ? 'active' : ''}
            onClick={() => setFilterCollection('all')}
          >
            전체
          </button>
          {collections.map(value => (
            <button
              key={value}
              className={filterCollection === value ? 'active' : ''}
              onClick={() => setFilterCollection(value)}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="stable-list">
          {loading ? (
            <div className="sidebar-empty">불러오는 중…</div>
          ) : groupedItems.length === 0 ? (
            <div className="sidebar-empty">대본이 없습니다.</div>
          ) : groupedItems.map(([collectionName, subjectMap]) => (
            <div className="group-block" key={collectionName}>
              <div className="group-collection">{collectionName}</div>
              {[...subjectMap.entries()].map(([subjectName, group]) => (
                <div key={`${collectionName}-${subjectName}`} className="subject-block">
                  <div className="group-subject">{subjectName}</div>
                  {group.map(item => {
                    const meta = metaMap[item.id] ?? {}
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`lecture-card ${selectedId === item.id ? 'selected' : ''}`}
                        onClick={() => selectItem(item)}
                      >
                        <div className="lecture-card-title">
                          <span>{meta.favorite ? '★ ' : ''}{item.title}</span>
                          {item.has_audio && <span className="audio-dot">●</span>}
                        </div>
                        <div className="lecture-card-excerpt">{excerpt(item.text || meta.clean_text || meta.source_text || '')}</div>
                        <div className="lecture-card-meta">{formatDate(item.updated_at)}</div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        <button className="new-lecture-button" onClick={resetNew}>＋ 새 강의</button>
      </aside>

      <main className="stable-main">
        <header className="stable-topbar">
          <div className="title-area">
            <button className={`favorite-button ${favorite ? 'active' : ''}`} onClick={() => void toggleFavorite()} title="즐겨찾기">
              {favorite ? '★' : '☆'}
            </button>
            <div>
              <h1>{selectedItem?.title || title || '새 강의'}</h1>
              <div className="status-line">
                {error ? <span className="error-text">{error}</span>
                  : generatingTts ? <span>음성 생성 중…</span>
                    : generatingScript ? <span>AI 대본 생성 중…</span>
                      : saving ? <span>저장 중…</span>
                        : message ? <span className="ok-text">{message}</span>
                          : <span>{promptVersion || '고정 프롬프트 준비됨'} · {textModel || '모델 설정 확인 필요'}</span>}
              </div>
            </div>
          </div>

          <div className="top-actions">
            <label className="voice-inline">
              <span>이번 음성</span>
              <select value={selectedVoice} onChange={event => setSelectedVoice(event.target.value)}>
                {VOICES.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button className="button ghost" onClick={() => void previewVoice(selectedVoice).catch(e => setError((e as Error).message))}>
              미리듣기
            </button>
            <button className="button ghost" onClick={() => void openSettings()}>설정</button>
            {selectedItem && <button className="button danger" onClick={() => void deleteCurrent()}>삭제</button>}
            <button className="button secondary" disabled={saving || generatingTts} onClick={() => void saveScript()}>저장</button>
            <button className="button primary" disabled={generatingTts || saving} onClick={() => void generateTts()}>
              {generatingTts ? '생성 중…' : `음성 만들기 · ${selectedVoice}`}
            </button>
          </div>
        </header>

        <section className="classification-bar">
          <label>
            <span>시기 / 컬렉션</span>
            <input
              list="collection-suggestions"
              value={collection}
              onChange={event => setCollection(event.target.value)}
              onBlur={() => void saveClassification()}
              placeholder="예: 2026-2, 임용, YouTube"
            />
          </label>
          <datalist id="collection-suggestions">
            {collectionSuggestions.map(value => <option value={value} key={value} />)}
          </datalist>

          <label>
            <span>과목 / 분야</span>
            <input
              list="subject-suggestions"
              value={subject}
              onChange={event => setSubject(event.target.value)}
              onBlur={() => void saveClassification()}
              placeholder="예: 운영체제, CS, 정보통신"
            />
          </label>
          <datalist id="subject-suggestions">
            {subjectSuggestions.map(value => <option value={value} key={value} />)}
          </datalist>

          <label className="context-field">
            <span>AI에 덧붙일 말 · 선택</span>
            <input
              value={contextNote}
              onChange={event => setContextNote(event.target.value)}
              onBlur={() => void saveClassification()}
              placeholder="예: 교수님 설명을 빼먹지 말고, 예시를 충분히"
            />
          </label>
        </section>

        <section className="audio-workspace">
          <audio
            ref={audioRef}
            src={activeAudioUrl || undefined}
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={() => {
              if (!audioRef.current) return
              setCurrentTime(audioRef.current.currentTime)
              void persistPosition(false)
            }}
            onDurationChange={() => {
              if (!audioRef.current) return
              setDuration(Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : 0)
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => {
              setIsPlaying(false)
              void persistPosition(true)
            }}
            onEnded={() => {
              setIsPlaying(false)
              void persistPosition(true)
            }}
          />

          {activeAudioUrl ? (
            <div className="audio-card">
              <div className="audio-head">
                <div>
                  <strong>{selectedItem?.title}</strong>
                  <span>{selectedItem?.voice || selectedVoice} · 생성 {formatDate(selectedItem?.audio_updated_at)}</span>
                </div>
                <a href={activeAudioUrl} download={`${downloadName(title)}.mp3`} className="button ghost">MP3</a>
              </div>

              <div className="progress-row">
                <span>{formatClock(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.1)}
                  step={0.1}
                  value={Math.min(currentTime, Math.max(duration, 0.1))}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => seekTo(Number(event.target.value))}
                />
                <span>{formatClock(duration)}</span>
              </div>

              <div className="player-controls">
                <button onClick={() => seekTo(0)}>처음</button>
                <button onClick={() => seekBy(-SEEK_STEP)}>−10초</button>
                <button className="play-main" onClick={() => {
                  if (!audioRef.current) return
                  if (audioRef.current.paused) void audioRef.current.play()
                  else audioRef.current.pause()
                }}>
                  {isPlaying ? '일시정지' : '재생'}
                </button>
                <button onClick={() => seekBy(SEEK_STEP)}>+10초</button>
                <label className="speed-control">
                  <span>배속</span>
                  <select value={playbackRate} onChange={event => setPlaybackRate(Number(event.target.value))}>
                    {[0.8, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2].map(value => (
                      <option key={value} value={value}>{value.toFixed(value === 1 ? 1 : 2).replace(/0$/, '')}x</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="shortcut-note">A 처음 · S −10초 · D 재생/정지 · F +10초 · 마지막 위치 자동 저장</div>
            </div>
          ) : (
            <div className="audio-empty">
              <strong>아직 이 대본의 최신 음성이 없습니다.</strong>
              <span>오른쪽 위에서 실제 사용할 voice를 확인한 뒤 음성을 생성하세요.</span>
            </div>
          )}
        </section>

        <section className="editor-workspace">
          <div className="editor-toolbar">
            <div className="editor-tabs">
              <button className={editorTab === 'source' ? 'active' : ''} onClick={() => setEditorTab('source')}>원본 STT / 자료</button>
              <button className={editorTab === 'clean' ? 'active' : ''} onClick={() => setEditorTab('clean')}>보정본</button>
              <button className={editorTab === 'script' ? 'active' : ''} onClick={() => setEditorTab('script')}>학습 대본</button>
            </div>

            <div className="prompt-actions">
              <button className="button subtle" disabled={promptLoading} onClick={() => void composePrompt('stt-fix')}>STT 보정 프롬프트</button>
              <button className="button subtle strong" disabled={promptLoading} onClick={() => void composePrompt('lecture')}>고정 강의 프롬프트</button>
              <button className="button subtle" disabled={promptLoading} onClick={() => void composePrompt('audit')}>누락 검수 프롬프트</button>
              <button className="button ai" disabled={generatingScript} onClick={() => void directGenerate()}>
                {generatingScript ? '생성 중…' : 'API로 바로 대본 생성'}
              </button>
            </div>
          </div>

          <div className="editor-content">
            <input
              className="lecture-title-input"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="강의 제목"
            />

            {editorTab === 'source' && (
              <>
                <div className="editor-hint">교수 강의 STT, 유튜브 전사본, 원문 자료를 그대로 보관합니다. 여기 내용은 대본으로 자동 덮어쓰지 않습니다.</div>
                <textarea
                  value={sourceText}
                  onChange={event => setSourceText(event.target.value)}
                  placeholder="원본 STT나 자료를 붙여넣으세요."
                />
              </>
            )}

            {editorTab === 'clean' && (
              <>
                <div className="editor-hint">STT 오류만 보정한 버전을 보관하는 칸입니다. 외부 ChatGPT에서 보정한 결과를 여기에 붙여넣으면 강의 프롬프트가 이 버전을 우선 사용합니다.</div>
                <textarea
                  value={cleanText}
                  onChange={event => setCleanText(event.target.value)}
                  placeholder="보정된 전사본을 붙여넣으세요."
                />
              </>
            )}

            {editorTab === 'script' && (
              <>
                <div className="editor-hint">실제로 TTS로 읽을 최종 대본입니다. 외부 ChatGPT 결과를 붙여넣거나, 같은 고정 프롬프트를 API로 직접 실행할 수 있습니다.</div>
                <textarea
                  value={scriptText}
                  onChange={event => setScriptText(event.target.value)}
                  placeholder="완성 대본을 붙여넣으세요. 기존처럼 이 칸만 사용해도 됩니다."
                />
              </>
            )}
          </div>
        </section>
      </main>

      {promptOpen && (
        <div className="modal-backdrop" onClick={() => setPromptOpen(false)}>
          <div className="prompt-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{recipeLabel(promptRecipe)} 프롬프트</strong>
                <span>{promptRecipeVersion} · {promptModel}</span>
              </div>
              <button className="icon-button" onClick={() => setPromptOpen(false)}>×</button>
            </div>
            <textarea className="prompt-preview" value={promptText} readOnly />
            <div className="modal-footer">
              <span>외부 ChatGPT에 그대로 붙여넣으면 매번 같은 설명 원칙을 사용합니다.</span>
              <button className="button primary" onClick={() => void copyPrompt()}>프롬프트 복사</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>설정</strong>
                <span>기본 voice와 직접 생성용 text model을 확인합니다.</span>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button>
            </div>

            <label className="settings-row">
              <span>OpenAI API Key</span>
              <input
                type="password"
                value={settingsForm.api_key}
                onChange={event => setSettingsForm(current => ({ ...current, api_key: event.target.value }))}
                placeholder="sk-..."
              />
            </label>

            <label className="settings-row">
              <span>기본 voice</span>
              <div className="voice-setting">
                <select
                  value={settingsForm.default_voice}
                  onChange={event => setSettingsForm(current => ({ ...current, default_voice: event.target.value }))}
                >
                  {VOICES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <button className="button ghost" type="button" onClick={() => void previewVoice(settingsForm.default_voice).catch(e => setError((e as Error).message))}>같은 문장으로 미리듣기</button>
              </div>
            </label>

            <label className="settings-row">
              <span>직접 대본 생성 model</span>
              <input
                value={settingsForm.default_text_model}
                onChange={event => setSettingsForm(current => ({ ...current, default_text_model: event.target.value }))}
                placeholder="비워두면 백엔드 기본값"
              />
            </label>

            <label className="settings-row">
              <span>오디오 저장 경로</span>
              <input
                value={settingsForm.audio_dir}
                onChange={event => setSettingsForm(current => ({ ...current, audio_dir: event.target.value }))}
                placeholder="기본 경로 사용"
              />
            </label>

            <div className="modal-footer">
              <span>대본별 생성 화면에서 선택한 voice가 TTS 요청에 명시적으로 전달됩니다.</span>
              <button className="button secondary" onClick={() => setSettingsOpen(false)}>취소</button>
              <button className="button primary" disabled={settingsSaving} onClick={() => void saveSettings()}>
                {settingsSaving ? '저장 중…' : '설정 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
