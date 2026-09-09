import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { apiFetch } from './api/client'
import './AppStable.css'

type Recipe = 'stt-fix' | 'lecture' | 'audit'
type Tab = 'source' | 'clean' | 'script'

type ScriptItem = {
  id: string; title: string; text: string; voice: string
  created_at: string | null; updated_at: string | null; audio_updated_at: string | null
  has_audio: boolean; audio_url: string | null
}
type LibraryRes = { items: ScriptItem[]; default_voice: string }
type ItemRes = LibraryRes & { item: ScriptItem }
type Settings = { api_key: string; audio_dir: string; default_voice: string; default_text_model: string }
type Meta = {
  collection?: string; subject?: string; source_text?: string; clean_text?: string
  context_note?: string; favorite?: boolean; last_position?: number; prompt_version?: string
}
type MetaRes = { items: Record<string, Meta>; prompt_version: string; text_model: string }
type PromptRes = { prompt: string; prompt_version: string; text_model: string }
type GenerateRes = PromptRes & { text: string }

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
const PREVIEW = '자, 그렇다면 여기서 한 가지 질문이 생깁니다. 여러 프로세스가 동시에 CPU를 사용하려고 하면 운영체제는 어떻게 해야 할까요?'
const fmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

const clean = (v?: string | null) => (v ?? '').trim()
const clock = (v: number) => {
  if (!Number.isFinite(v) || v < 0) return '0:00'
  const n = Math.floor(v), h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
const date = (v?: string | null) => {
  const n = Date.parse(v || '')
  return Number.isNaN(n) ? '-' : fmt.format(n)
}
const short = (v?: string) => {
  const s = (v || '').replace(/\s+/g, ' ').trim()
  return s.length > 72 ? `${s.slice(0, 72)}…` : s || '내용 없음'
}
const safeName = (v: string) => (v.trim() || 'lecture').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
const recipeName = (r: Recipe) => r === 'stt-fix' ? 'STT 보정' : r === 'audit' ? '누락 검수' : '강의 대본화'

async function playVoice(voice: string) {
  const res = await fetch('/api/settings/preview-voice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice, text: PREVIEW }),
  })
  if (!res.ok) {
    let msg = '음성 미리듣기에 실패했습니다.'
    try { msg = ((await res.json()) as { detail?: string }).detail || msg } catch { /* noop */ }
    throw new Error(msg)
  }
  const url = URL.createObjectURL(await res.blob())
  const audio = new Audio(url)
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
  await audio.play()
}

export default function AppStable() {
  const [items, setItems] = useState<ScriptItem[]>([])
  const [metas, setMetas] = useState<Record<string, Meta>>({})
  const [id, setId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [script, setScript] = useState('')
  const [source, setSource] = useState('')
  const [cleaned, setCleaned] = useState('')
  const [note, setNote] = useState('')
  const [collection, setCollection] = useState('')
  const [subject, setSubject] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [voice, setVoice] = useState('alloy')
  const [defaultVoice, setDefaultVoice] = useState('alloy')
  const [tab, setTab] = useState<Tab>('script')
  const [query, setQuery] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [promptVersion, setPromptVersion] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState<'save' | 'tts' | 'ai' | 'prompt' | ''>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>({ api_key: '', audio_dir: '', default_voice: 'alloy', default_text_model: '' })
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptRecipe, setPromptRecipe] = useState<Recipe>('lecture')
  const [promptText, setPromptText] = useState('')
  const [promptInfo, setPromptInfo] = useState('')

  const audio = useRef<HTMLAudioElement>(null)
  const lastPositionSave = useRef(0)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)

  const selected = useMemo(() => items.find(x => x.id === id) ?? null, [id, items])
  const selectedMeta = id ? metas[id] || {} : {}
  const activeAudio = selected?.has_audio && selected.text === script ? selected.audio_url : null

  const collections = useMemo(() => [...new Set(items.map(x => clean(metas[x.id]?.collection)).filter(Boolean))].sort(), [items, metas])
  const subjects = useMemo(() => [...new Set(items.map(x => clean(metas[x.id]?.subject)).filter(Boolean))].sort(), [items, metas])
  const visible = useMemo(() => items.filter(item => {
    const m = metas[item.id] || {}
    if (collectionFilter !== 'all' && clean(m.collection) !== collectionFilter) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [item.title, item.text, m.collection, m.subject, m.source_text, m.clean_text].join('\n').toLowerCase().includes(q)
  }).sort((a, b) => {
    const fav = Number(Boolean(metas[b.id]?.favorite)) - Number(Boolean(metas[a.id]?.favorite))
    return fav || ((Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0))
  }), [collectionFilter, items, metas, query])

  const groups = useMemo(() => {
    const out = new Map<string, Map<string, ScriptItem[]>>()
    for (const item of visible) {
      const m = metas[item.id] || {}
      const c = clean(m.collection) || '미분류', s = clean(m.subject) || '기타'
      if (!out.has(c)) out.set(c, new Map())
      const sm = out.get(c)!
      if (!sm.has(s)) sm.set(s, [])
      sm.get(s)!.push(item)
    }
    return [...out.entries()]
  }, [metas, visible])

  const load = useCallback(async () => {
    setError('')
    try {
      const [lib, meta] = await Promise.all([
        apiFetch<LibraryRes>('/api/simple/library'),
        apiFetch<MetaRes>('/api/stable/meta'),
      ])
      setItems(lib.items); setMetas(meta.items || {}); setDefaultVoice(lib.default_voice || 'alloy')
      setPromptVersion(meta.prompt_version || ''); setModel(meta.text_model || '')
      if (lib.items[0]) select(lib.items[0], meta.items || {}, lib.default_voice || 'alloy')
    } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate }, [rate, activeAudio])
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(t)
  }, [message])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (!activeAudio || el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName || '')) return
      if (e.key.toLowerCase() === 'd') { e.preventDefault(); audio.current?.paused ? void audio.current?.play() : audio.current?.pause() }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); seek(-10) }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); seek(10) }
      if (e.key.toLowerCase() === 'a') { e.preventDefault(); go(0) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [activeAudio, time])

  function select(item: ScriptItem, map = metas, fallbackVoice = defaultVoice) {
    const m = map[item.id] || {}
    setId(item.id); setTitle(item.title); setScript(item.text); setVoice(item.voice || fallbackVoice || 'alloy')
    setSource(m.source_text || ''); setCleaned(m.clean_text || ''); setNote(m.context_note || '')
    setCollection(m.collection || ''); setSubject(m.subject || ''); setFavorite(Boolean(m.favorite))
    setTab('script'); setTime(0); setDuration(0); setError(''); setMessage('')
  }

  function fresh() {
    setId(null); setTitle(''); setScript(''); setSource(''); setCleaned(''); setNote('')
    setCollection(''); setSubject(''); setFavorite(false); setVoice(defaultVoice || 'alloy')
    setTab('script'); setTime(0); setDuration(0); setError(''); setMessage('')
  }

  async function patchMeta(itemId: string, patch: Partial<Meta>, quiet = false) {
    const res = await apiFetch<{ meta: Meta }>(`/api/stable/meta/${encodeURIComponent(itemId)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    })
    setMetas(x => ({ ...x, [itemId]: res.meta }))
    if (!quiet) setMessage('분류/자료 정보 저장됨')
    return res.meta
  }

  const metaPayload = () => ({
    collection, subject, source_text: source, clean_text: cleaned, context_note: note,
    favorite, prompt_version: promptVersion,
  })

  async function save() {
    if (busy) return null
    setBusy('save'); setError('')
    try {
      const res = await apiFetch<ItemRes>('/api/simple/items', {
        method: 'POST', body: JSON.stringify({ item_id: id, title, text: script }),
      })
      setItems(res.items); setDefaultVoice(res.default_voice || defaultVoice)
      setId(res.item.id); setTitle(res.item.title); setScript(res.item.text)
      await patchMeta(res.item.id, metaPayload(), true)
      setMessage('저장됨')
      return res.item
    } catch (e) { setError((e as Error).message); return null }
    finally { setBusy('') }
  }

  async function saveMeta() {
    if (!id) return
    try { await patchMeta(id, { collection, subject, context_note: note }) }
    catch (e) { setError((e as Error).message) }
  }

  async function remove() {
    if (!selected || !window.confirm(`"${selected.title}"을(를) 삭제할까요?`)) return
    try {
      const lib = await apiFetch<LibraryRes>(`/api/simple/items/${encodeURIComponent(selected.id)}`, { method: 'DELETE' })
      await fetch(`/api/stable/meta/${encodeURIComponent(selected.id)}`, { method: 'DELETE' }).catch(() => undefined)
      setItems(lib.items)
      setMetas(x => { const n = { ...x }; delete n[selected.id]; return n })
      lib.items[0] ? select(lib.items[0]) : fresh()
      setMessage('삭제됨')
    } catch (e) { setError((e as Error).message) }
  }

  async function tts() {
    if (busy) return
    setBusy('tts'); setError('')
    try {
      const res = await apiFetch<ItemRes & { chunk_count: number }>('/api/simple/generate', {
        method: 'POST',
        body: JSON.stringify({ item_id: id, title, text: script, voice }),
      })
      setItems(res.items); setDefaultVoice(res.default_voice || defaultVoice)
      setId(res.item.id); setTitle(res.item.title); setScript(res.item.text); setVoice(res.item.voice || voice)
      await patchMeta(res.item.id, metaPayload(), true)
      setMessage(`음성 생성 완료 · ${res.item.voice || voice} · ${res.chunk_count}개 청크`)
      setTimeout(() => void audio.current?.play().catch(() => undefined), 120)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  const sourceFor = (r: Recipe) => r === 'stt-fix' ? (source || script) : r === 'audit' ? (cleaned || source) : (cleaned || source || script)

  async function compose(recipe: Recipe) {
    if (busy) return
    setBusy('prompt'); setError('')
    try {
      const res = await apiFetch<PromptRes>('/api/stable/compose', {
        method: 'POST',
        body: JSON.stringify({ recipe, title, source: sourceFor(recipe), script, context_note: note }),
      })
      setPromptRecipe(recipe); setPromptText(res.prompt); setPromptInfo(`${res.prompt_version} · ${res.text_model}`); setPromptOpen(true)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  async function generate() {
    if (busy) return
    setBusy('ai'); setError('')
    try {
      const res = await apiFetch<GenerateRes>('/api/stable/generate', {
        method: 'POST',
        body: JSON.stringify({ recipe: 'lecture', title, source: sourceFor('lecture'), script: '', context_note: note }),
      })
      setScript(res.text); setPromptVersion(res.prompt_version); setModel(res.text_model); setTab('script')
      setMessage(`대본 생성 완료 · ${res.prompt_version}`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(promptText); setMessage(`${recipeName(promptRecipe)} 프롬프트 복사됨`) }
    catch { setError('클립보드 복사에 실패했습니다.') }
  }

  async function openSettings() {
    try {
      const s = await apiFetch<Settings>('/api/settings')
      setSettings({ api_key: s.api_key ?? '', audio_dir: s.audio_dir ?? '', default_voice: s.default_voice || 'alloy', default_text_model: s.default_text_model ?? '' })
      setSettingsOpen(true)
    } catch (e) { setError((e as Error).message) }
  }

  async function saveSettings() {
    if (busy) return
    setBusy('save')
    try {
      const s = await apiFetch<Settings>('/api/settings', {
        method: 'POST', body: JSON.stringify({ ...settings, api_key: settings.api_key.trim(), default_voice: settings.default_voice || 'alloy' }),
      })
      setSettings(s); setDefaultVoice(s.default_voice || 'alloy'); setSettingsOpen(false); setMessage('설정 저장됨')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  async function fav() {
    const next = !favorite; setFavorite(next)
    if (!id) return
    try { await patchMeta(id, { favorite: next }, true) }
    catch (e) { setFavorite(!next); setError((e as Error).message) }
  }

  function go(v: number) {
    if (!audio.current) return
    const max = Number.isFinite(audio.current.duration) ? audio.current.duration : duration
    const x = Math.max(0, Math.min(v, max || 0))
    audio.current.currentTime = x; setTime(x)
  }
  function seek(delta: number) { go((audio.current?.currentTime || time) + delta) }

  async function savePosition(force = false) {
    if (!id || !audio.current) return
    const now = Date.now()
    if (!force && now - lastPositionSave.current < 5000) return
    lastPositionSave.current = now
    try { await patchMeta(id, { last_position: audio.current.currentTime }, true) } catch { /* never interrupt playback */ }
  }

  function loaded() {
    if (!audio.current) return
    setDuration(Number.isFinite(audio.current.duration) ? audio.current.duration : 0)
    const pos = Number(selectedMeta.last_position || 0)
    if (pos > 0 && pos < audio.current.duration - 1) { audio.current.currentTime = pos; setTime(pos) }
  }

  return <div className="stable-app">
    <aside className="stable-sidebar">
      <div className="stable-brand-row">
        <div><div className="stable-brand">LectureTeller</div><div className="stable-brand-sub">대본 → 자연스러운 음성 학습</div></div>
        <button className="icon-button" onClick={fresh}>＋</button>
      </div>
      <div className="stable-search"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="제목·과목·대본 검색" /></div>
      <div className="collection-filter">
        <button className={collectionFilter === 'all' ? 'active' : ''} onClick={() => setCollectionFilter('all')}>전체</button>
        {collections.map(x => <button key={x} className={collectionFilter === x ? 'active' : ''} onClick={() => setCollectionFilter(x)}>{x}</button>)}
      </div>
      <div className="stable-list">
        {groups.length === 0 && <div className="sidebar-empty">대본이 없습니다.</div>}
        {groups.map(([c, sm]) => <div className="group-block" key={c}>
          <div className="group-collection">{c}</div>
          {[...sm.entries()].map(([s, list]) => <div className="subject-block" key={`${c}-${s}`}>
            <div className="group-subject">{s}</div>
            {list.map(item => <button key={item.id} className={`lecture-card ${id === item.id ? 'selected' : ''}`} onClick={() => select(item)}>
              <div className="lecture-card-title"><span>{metas[item.id]?.favorite ? '★ ' : ''}{item.title}</span>{item.has_audio && <span className="audio-dot">●</span>}</div>
              <div className="lecture-card-excerpt">{short(item.text || metas[item.id]?.clean_text || metas[item.id]?.source_text)}</div>
              <div className="lecture-card-meta">{date(item.updated_at)}</div>
            </button>)}
          </div>)}
        </div>)}
      </div>
      <button className="new-lecture-button" onClick={fresh}>＋ 새 강의</button>
    </aside>

    <main className="stable-main">
      <header className="stable-topbar">
        <div className="title-area">
          <button className={`favorite-button ${favorite ? 'active' : ''}`} onClick={() => void fav()}>{favorite ? '★' : '☆'}</button>
          <div>
            <h1>{selected?.title || title || '새 강의'}</h1>
            <div className="status-line">{error ? <span className="error-text">{error}</span> : message ? <span className="ok-text">{message}</span> : <span>{busy ? `${busy} 작업 중…` : `${promptVersion || '고정 프롬프트'} · ${model || '모델 설정 확인'}`}</span>}</div>
          </div>
        </div>
        <div className="top-actions">
          <label className="voice-inline"><span>이번 음성</span><select value={voice} onChange={e => setVoice(e.target.value)}>{VOICES.map(x => <option key={x}>{x}</option>)}</select></label>
          <button className="button ghost" onClick={() => void playVoice(voice).catch(e => setError((e as Error).message))}>미리듣기</button>
          <button className="button ghost" onClick={() => void openSettings()}>설정</button>
          {selected && <button className="button danger" onClick={() => void remove()}>삭제</button>}
          <button className="button secondary" disabled={Boolean(busy)} onClick={() => void save()}>저장</button>
          <button className="button primary" disabled={Boolean(busy)} onClick={() => void tts()}>{busy === 'tts' ? '생성 중…' : `음성 만들기 · ${voice}`}</button>
        </div>
      </header>

      <section className="classification-bar">
        <label><span>시기 / 컬렉션</span><input list="collections" value={collection} onChange={e => setCollection(e.target.value)} onBlur={() => void saveMeta()} placeholder="2026-2, 임용, YouTube" /></label>
        <datalist id="collections">{collections.map(x => <option value={x} key={x} />)}</datalist>
        <label><span>과목 / 분야</span><input list="subjects" value={subject} onChange={e => setSubject(e.target.value)} onBlur={() => void saveMeta()} placeholder="운영체제, CS, 정보통신" /></label>
        <datalist id="subjects">{subjects.map(x => <option value={x} key={x} />)}</datalist>
        <label><span>AI에 덧붙일 말 · 선택</span><input value={note} onChange={e => setNote(e.target.value)} onBlur={() => void saveMeta()} placeholder="주절주절 한 문장으로 적어도 됩니다." /></label>
      </section>

      <section className="audio-workspace">
        <audio ref={audio} src={activeAudio || undefined} preload="metadata" onLoadedMetadata={loaded}
          onDurationChange={() => setDuration(Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0)}
          onTimeUpdate={() => { setTime(audio.current?.currentTime || 0); void savePosition() }}
          onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); void savePosition(true) }} onEnded={() => { setPlaying(false); void savePosition(true) }} />
        {activeAudio ? <div className="audio-card">
          <div className="audio-head"><div><strong>{selected?.title}</strong><span>{selected?.voice || voice} · 생성 {date(selected?.audio_updated_at)}</span></div><a className="button ghost" href={activeAudio} download={`${safeName(title)}.mp3`}>MP3</a></div>
          <div className="progress-row"><span>{clock(time)}</span><input type="range" min={0} max={Math.max(duration, .1)} step={.1} value={Math.min(time, Math.max(duration, .1))} onChange={(e: ChangeEvent<HTMLInputElement>) => go(Number(e.target.value))} /><span>{clock(duration)}</span></div>
          <div className="player-controls">
            <button onClick={() => go(0)}>처음</button><button onClick={() => seek(-10)}>−10초</button>
            <button className="play-main" onClick={() => audio.current?.paused ? void audio.current?.play() : audio.current?.pause()}>{playing ? '일시정지' : '재생'}</button>
            <button onClick={() => seek(10)}>+10초</button>
            <label className="speed-control"><span>배속</span><select value={rate} onChange={e => setRate(Number(e.target.value))}>{[.8, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2].map(x => <option key={x} value={x}>{x}x</option>)}</select></label>
          </div>
          <div className="shortcut-note">A 처음 · S −10초 · D 재생/정지 · F +10초 · 마지막 위치 자동 저장</div>
        </div> : <div className="audio-empty"><strong>최신 대본의 음성이 없습니다.</strong><span>실제 사용할 voice를 미리듣고 그대로 생성하세요.</span></div>}
      </section>

      <section className="editor-workspace">
        <div className="editor-toolbar">
          <div className="editor-tabs">
            <button className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>원본 STT / 자료</button>
            <button className={tab === 'clean' ? 'active' : ''} onClick={() => setTab('clean')}>보정본</button>
            <button className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')}>학습 대본</button>
          </div>
          <div className="prompt-actions">
            <button className="button subtle" disabled={Boolean(busy)} onClick={() => void compose('stt-fix')}>STT 보정 프롬프트</button>
            <button className="button subtle strong" disabled={Boolean(busy)} onClick={() => void compose('lecture')}>고정 강의 프롬프트</button>
            <button className="button subtle" disabled={Boolean(busy)} onClick={() => void compose('audit')}>누락 검수 프롬프트</button>
            <button className="button ai" disabled={Boolean(busy)} onClick={() => void generate()}>{busy === 'ai' ? '생성 중…' : 'API로 바로 대본 생성'}</button>
          </div>
        </div>
        <div className="editor-content">
          <input className="lecture-title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="강의 제목" />
          {tab === 'source' && <><div className="editor-hint">교수 강의 STT나 유튜브 전사본을 원본 그대로 보관합니다.</div><textarea value={source} onChange={e => setSource(e.target.value)} placeholder="원본 STT / 자료" /></>}
          {tab === 'clean' && <><div className="editor-hint">STT 오류만 보정한 결과를 보관합니다. 강의 대본 프롬프트는 이 칸을 우선 사용합니다.</div><textarea value={cleaned} onChange={e => setCleaned(e.target.value)} placeholder="보정된 전사본" /></>}
          {tab === 'script' && <><div className="editor-hint">실제로 TTS로 읽을 최종 대본입니다. 기존처럼 이 칸만 써도 됩니다.</div><textarea value={script} onChange={e => setScript(e.target.value)} placeholder="완성 대본" /></>}
        </div>
      </section>
    </main>

    {promptOpen && <div className="modal-backdrop" onClick={() => setPromptOpen(false)}><div className="prompt-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><div><strong>{recipeName(promptRecipe)} 프롬프트</strong><span>{promptInfo}</span></div><button className="icon-button" onClick={() => setPromptOpen(false)}>×</button></div>
      <textarea className="prompt-preview" value={promptText} readOnly />
      <div className="modal-footer"><span>외부 ChatGPT에 그대로 붙이면 API 직접 생성과 같은 고정 설명 원칙을 사용합니다.</span><button className="button primary" onClick={() => void copyPrompt()}>프롬프트 복사</button></div>
    </div></div>}

    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><div><strong>설정</strong><span>voice를 직접 확인하고, 직접 생성에 쓸 모델을 고정합니다.</span></div><button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div>
      <label className="settings-row"><span>OpenAI API Key</span><input type="password" value={settings.api_key} onChange={e => setSettings(x => ({ ...x, api_key: e.target.value }))} /></label>
      <label className="settings-row"><span>기본 voice</span><div className="voice-setting"><select value={settings.default_voice} onChange={e => setSettings(x => ({ ...x, default_voice: e.target.value }))}>{VOICES.map(x => <option key={x}>{x}</option>)}</select><button className="button ghost" onClick={() => void playVoice(settings.default_voice).catch(e => setError((e as Error).message))}>같은 문장으로 미리듣기</button></div></label>
      <label className="settings-row"><span>직접 대본 생성 model</span><input value={settings.default_text_model} onChange={e => setSettings(x => ({ ...x, default_text_model: e.target.value }))} placeholder="비워두면 백엔드 기본값" /></label>
      <label className="settings-row"><span>오디오 저장 경로</span><input value={settings.audio_dir} onChange={e => setSettings(x => ({ ...x, audio_dir: e.target.value }))} /></label>
      <div className="modal-footer"><span>대본 화면에서 선택한 voice는 TTS 요청에 명시적으로 전달됩니다.</span><button className="button secondary" onClick={() => setSettingsOpen(false)}>취소</button><button className="button primary" disabled={Boolean(busy)} onClick={() => void saveSettings()}>설정 저장</button></div>
    </div></div>}
  </div>
}
