import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from './api/client'
import './App.css'

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

const PLAYER_STEP_SECONDS = 5
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTimestamp(value: string | null): string {
  if (!value) return '-'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '-'
  return dateFormatter.format(parsed)
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'

  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function makeExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return '내용 없음'
  return compact.length > 88 ? `${compact.slice(0, 88)}...` : compact
}

function makeDownloadName(title: string): string {
  const sanitized = title.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  return sanitized || 'script-audio'
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tagName = element.tagName
  return element.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

export default function App() {
  const [items, setItems] = useState<ScriptItem[]>([])
  const [defaultVoice, setDefaultVoice] = useState('alloy')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [shouldAutoplay, setShouldAutoplay] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<HTMLDivElement | null>(null)

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items

    return items.filter(item => {
      const haystack = `${item.title}\n${item.text}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [items, query])

  const isDirty = useMemo(() => {
    if (!selectedItem) {
      return title.trim().length > 0 || text.trim().length > 0
    }
    return title !== selectedItem.title || text !== selectedItem.text
  }, [selectedItem, text, title])

  const activeAudioUrl = useMemo(() => {
    if (!selectedItem?.audio_url) return null
    if (selectedItem.text !== text) return null
    return selectedItem.audio_url
  }, [selectedItem, text])

  async function loadLibrary() {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<LibraryResponse>('/api/simple/library')
      setItems(response.items)
      setDefaultVoice(response.default_voice)

      if (response.items.length > 0) {
        const initial = response.items[0]
        setSelectedId(initial.id)
        setTitle(initial.title)
        setText(initial.text)
      } else {
        setSelectedId(null)
        setTitle('')
        setText('')
      }
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLibrary()
  }, [])

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 2600)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
  }, [activeAudioUrl])

  useEffect(() => {
    if (!shouldAutoplay || !activeAudioUrl || !audioRef.current) return
    audioRef.current.currentTime = 0
    void audioRef.current.play().then(() => {
      playerRef.current?.focus()
    }).catch(() => undefined)
    setShouldAutoplay(false)
  }, [activeAudioUrl, shouldAutoplay])

  function focusPlayer() {
    playerRef.current?.focus()
  }

  function syncAudioState() {
    const audio = audioRef.current
    if (!audio) {
      setCurrentTime(0)
      setDuration(0)
      setIsPlaying(false)
      return
    }

    setCurrentTime(audio.currentTime || 0)
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    setIsPlaying(!audio.paused && !audio.ended)
  }

  function playAudio() {
    const audio = audioRef.current
    if (!audio || !activeAudioUrl) return
    void audio.play().then(() => {
      focusPlayer()
    }).catch(() => undefined)
  }

  function pauseAudio() {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    syncAudioState()
  }

  function togglePlayback() {
    const audio = audioRef.current
    if (!audio || !activeAudioUrl) return

    if (audio.paused || audio.ended) {
      playAudio()
      return
    }

    pauseAudio()
  }

  function seekTo(nextTime: number) {
    const audio = audioRef.current
    if (!audio) return

    const safeDuration = Number.isFinite(audio.duration) ? audio.duration : duration
    const bounded = clamp(nextTime, 0, safeDuration || 0)
    audio.currentTime = bounded
    setCurrentTime(bounded)
    focusPlayer()
  }

  function seekBy(delta: number) {
    const audio = audioRef.current
    if (!audio) return
    seekTo(audio.currentTime + delta)
  }

  function restartAudio() {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setCurrentTime(0)
    playAudio()
  }

  function stopAudio() {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setCurrentTime(0)
    setIsPlaying(false)
    focusPlayer()
  }

  function handleTimelineChange(event: ChangeEvent<HTMLInputElement>) {
    seekTo(Number(event.target.value))
  }

  function selectItem(item: ScriptItem) {
    setSelectedId(item.id)
    setTitle(item.title)
    setText(item.text)
    setShouldAutoplay(false)
    setMessage('')
    setError('')
  }

  function resetEditor() {
    setSelectedId(null)
    setTitle('')
    setText('')
    setShouldAutoplay(false)
    setMessage('')
    setError('')
  }

  function syncFromResponse(response: ItemResponse) {
    setItems(response.items)
    setDefaultVoice(response.default_voice)
    setSelectedId(response.item.id)
    setTitle(response.item.title)
    setText(response.item.text)
  }

  async function saveScript() {
    if (saving || generating) return
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch<ItemResponse>('/api/simple/items', {
        method: 'POST',
        body: JSON.stringify({
          item_id: selectedId,
          title,
          text,
        }),
      })
      syncFromResponse(response)
      setMessage('저장됨')
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function generateTts() {
    if (saving || generating) return
    setGenerating(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch<ItemResponse & { chunk_count: number }>('/api/simple/generate', {
        method: 'POST',
        body: JSON.stringify({
          item_id: selectedId,
          title,
          text,
        }),
      })
      syncFromResponse(response)
      setMessage(`TTS 생성 완료 · ${response.chunk_count}개 청크`)
      setShouldAutoplay(true)
    } catch (generateError) {
      setError((generateError as Error).message)
      setShouldAutoplay(false)
    } finally {
      setGenerating(false)
    }
  }

  async function deleteScript() {
    if (!selectedItem || saving || generating) return
    if (!window.confirm(`"${selectedItem.title}" 대본을 삭제할까요?`)) return

    setError('')
    setMessage('')

    try {
      const response = await apiFetch<LibraryResponse>(`/api/simple/items/${selectedItem.id}`, {
        method: 'DELETE',
      })
      setItems(response.items)
      setDefaultVoice(response.default_voice)

      if (response.items.length > 0) {
        const nextItem = response.items[0]
        setSelectedId(nextItem.id)
        setTitle(nextItem.title)
        setText(nextItem.text)
      } else {
        resetEditor()
      }

      setMessage('삭제됨')
    } catch (deleteError) {
      setError((deleteError as Error).message)
    }
  }

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const lowerKey = event.key.toLowerCase()
      const isTyping = isTypingTarget(event.target)
      const playerHasFocus = playerRef.current === document.activeElement || Boolean(playerRef.current?.contains(document.activeElement))

      if ((event.metaKey || event.ctrlKey) && lowerKey === 's') {
        event.preventDefault()
        void saveScript()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void generateTts()
        return
      }

      if (!activeAudioUrl) return

      if (event.altKey && !event.metaKey && !event.ctrlKey) {
        switch (lowerKey) {
          case 'p':
            event.preventDefault()
            focusPlayer()
            return
          case 'j':
            event.preventDefault()
            seekBy(-PLAYER_STEP_SECONDS)
            return
          case 'k':
            event.preventDefault()
            togglePlayback()
            return
          case 'l':
            event.preventDefault()
            seekBy(PLAYER_STEP_SECONDS)
            return
          case 'r':
            event.preventDefault()
            restartAudio()
            return
          case 's':
            event.preventDefault()
            stopAudio()
            return
          default:
            return
        }
      }

      if (!playerHasFocus || isTyping || event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === ' ' || lowerKey === 'k') {
        event.preventDefault()
        togglePlayback()
        return
      }

      if (event.key === 'ArrowLeft' || lowerKey === 'j') {
        event.preventDefault()
        seekBy(-PLAYER_STEP_SECONDS)
        return
      }

      if (event.key === 'ArrowRight' || lowerKey === 'l') {
        event.preventDefault()
        seekBy(PLAYER_STEP_SECONDS)
        return
      }

      if (lowerKey === 'r' || event.key === 'Home' || event.key === '0') {
        event.preventDefault()
        restartAudio()
        return
      }

      if (lowerKey === 's') {
        event.preventDefault()
        stopAudio()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [activeAudioUrl, generating, saving, selectedId, text, title, duration])

  const statusText = error
    ? error
    : generating
      ? 'TTS 생성 중...'
      : saving
        ? '저장 중...'
        : message
          ? message
          : isDirty
            ? '저장 안 된 변경 있음'
            : selectedItem
              ? `마지막 저장 ${formatTimestamp(selectedItem.updated_at)}`
              : '새 대본'

  const playerStatusText = isPlaying ? '재생 중' : activeAudioUrl ? '대기 중' : '오디오 없음'

  return (
    <div className="app-frame">
      <aside className="library-pane">
        <div className="library-top">
          <div>
            <p className="eyebrow">LectureTeller</p>
            <h1>제목으로만 관리</h1>
          </div>
          <button className="secondary-button" type="button" onClick={resetEditor}>
            새 대본
          </button>
        </div>

        <label className="search-box" htmlFor="search">
          <span>검색</span>
          <input
            id="search"
            type="search"
            placeholder="제목 + 내용 검색"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>

        <div className="library-summary">
          <span>{filteredItems.length}개 표시</span>
          <span>기본 음성 {defaultVoice}</span>
        </div>

        <div className="script-list">
          {loading ? (
            <div className="empty-state">불러오는 중...</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">저장된 대본이 없습니다.</div>
          ) : (
            filteredItems.map(item => (
              <button
                key={item.id}
                className={`script-card ${item.id === selectedId ? 'active' : ''}`}
                type="button"
                onClick={() => selectItem(item)}
              >
                <div className="script-card-head">
                  <strong>{item.title}</strong>
                  {item.has_audio ? <span className="audio-badge">mp3</span> : null}
                </div>
                <p>{makeExcerpt(item.text)}</p>
                <span>{formatTimestamp(item.updated_at)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="editor-pane">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Minimal TTS Workflow</p>
            <h2>대본 넣고 바로 speaking 파일 생성</h2>
            <p className="hero-copy">
              주차, 과목, 부가 패널은 전부 뺐습니다. 제목은 비워도 되고, 내용 첫 줄로 자동 생성됩니다.
            </p>
          </div>
          <div className={`status-pill ${error ? 'error' : ''}`}>{statusText}</div>
        </section>

        <section className="editor-card">
          <label className="field" htmlFor="title">
            <span>제목</span>
            <input
              id="title"
              type="text"
              placeholder="비워두면 첫 줄로 자동 생성"
              value={title}
              onChange={event => setTitle(event.target.value)}
            />
          </label>

          <label className="field grow" htmlFor="script">
            <span>대본</span>
            <textarea
              id="script"
              placeholder="여기에 대본을 그대로 붙여넣으면 됩니다."
              value={text}
              onChange={event => setText(event.target.value)}
            />
          </label>

          <div className="editor-footer">
            <div className="shortcut-copy">Ctrl/Cmd+S 저장 · Ctrl/Cmd+Enter TTS 생성</div>
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={() => void saveScript()} disabled={saving || generating}>
                저장
              </button>
              <button className="primary-button" type="button" onClick={() => void generateTts()} disabled={saving || generating}>
                {generating ? '생성 중...' : 'TTS 생성'}
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void deleteScript()}
                disabled={!selectedItem || saving || generating}
              >
                삭제
              </button>
            </div>
          </div>
        </section>

        <section className="player-card">
          <div className="player-head">
            <div>
              <p className="eyebrow">Audio</p>
              <h3>{selectedItem?.title || title.trim() || '새 대본'}</h3>
            </div>
            <div className="player-actions">
              {activeAudioUrl ? (
                <button className="secondary-button" type="button" onClick={focusPlayer}>
                  플레이어 포커스
                </button>
              ) : null}
              {activeAudioUrl ? (
                <a className="download-link" href={activeAudioUrl} download={`${makeDownloadName(selectedItem?.title || title)}.mp3`}>
                  다운로드
                </a>
              ) : null}
            </div>
          </div>

          {activeAudioUrl ? (
            <div
              ref={playerRef}
              className="player-shell"
              tabIndex={0}
              aria-label="오디오 플레이어. Alt J, K, L, R, S와 플레이어 포커스 후 J, K, L, 방향키, Space 사용 가능."
            >
              <audio
                ref={audioRef}
                className="native-audio"
                src={activeAudioUrl}
                preload="metadata"
                onLoadedMetadata={syncAudioState}
                onDurationChange={syncAudioState}
                onTimeUpdate={syncAudioState}
                onPlay={syncAudioState}
                onPause={syncAudioState}
                onEnded={syncAudioState}
              />

              <div className="player-meter">
                <div className="player-meter-head">
                  <span>{playerStatusText}</span>
                  <span>{formatClock(currentTime)} / {formatClock(duration)}</span>
                </div>
                <input
                  className="timeline-slider"
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.1)}
                  step={0.1}
                  value={Math.min(currentTime, Math.max(duration, 0.1))}
                  onChange={handleTimelineChange}
                  aria-label="재생 위치"
                />
              </div>

              <div className="player-controls">
                <button className="player-control-button" type="button" onClick={restartAudio}>
                  처음부터
                </button>
                <button className="player-control-button" type="button" onClick={() => seekBy(-PLAYER_STEP_SECONDS)}>
                  -5초
                </button>
                <button className="player-main-button" type="button" onClick={togglePlayback}>
                  {isPlaying ? '일시정지' : '재생'}
                </button>
                <button className="player-control-button" type="button" onClick={() => seekBy(PLAYER_STEP_SECONDS)}>
                  +5초
                </button>
                <button className="player-control-button" type="button" onClick={stopAudio}>
                  정지
                </button>
              </div>

              <div className="shortcut-panel">
                <span className="shortcut-chip"><strong>전역</strong> Alt+J 뒤로 · Alt+K 재생/정지 · Alt+L 앞으로</span>
                <span className="shortcut-chip"><strong>전역</strong> Alt+R 처음부터 · Alt+S 정지 · Alt+P 플레이어 포커스</span>
                <span className="shortcut-chip"><strong>포커스 후</strong> Space / J / K / L / R / S / ← / →</span>
              </div>
            </div>
          ) : (
            <div className="empty-player">
              저장된 오디오가 없습니다. 대본을 넣고 <strong>TTS 생성</strong>만 누르면 됩니다.
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
