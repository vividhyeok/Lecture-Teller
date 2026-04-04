import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { updateStudyState } from '../../api/library'
import { useStore } from '../../store/useStore'
import type { Clip, ScriptVersion, StudyBookmark, StudyChecks } from '../../types'
import { buildSynopsisFromTranscript, formatDate, parseMarkdownForView, sanitizeMarkdown } from '../../utils/markdown'

const SPEED_PRESETS = [0.85, 1, 1.2, 1.5, 1.8] as const

type StudyView = 'sync' | 'summary' | 'focus' | 'blind'
type QueueMode = 'off' | 'all' | 'hard' | 'memory'

interface ScriptUnit {
  text: string
  start: number
  end: number
}

interface LoopRange {
  start: number
  end: number
  label: string
}

const EMPTY_CHECKS: StudyChecks = { listen: false, review: false, memorize: false }

function splitReadableSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map(sentence => sentence.trim()).filter(Boolean)
}

function makeBookmarkId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function sortBookmarks(bookmarks: StudyBookmark[]): StudyBookmark[] {
  return [...bookmarks].sort((left, right) => left.start - right.start || (left.created_at || '').localeCompare(right.created_at || ''))
}

function bookmarkKindLabel(kind: StudyBookmark['kind']): string {
  return kind === 'hard' ? '헷갈림' : kind === 'memory' ? '암기' : '핵심'
}

function queueModeLabel(mode: QueueMode): string {
  return mode === 'hard' ? '헷갈림 큐' : mode === 'memory' ? '암기 큐' : mode === 'all' ? '전체 북마크 큐' : '큐 없음'
}

function secondsLabel(value: number): string {
  if (!Number.isFinite(value)) return '0:00'
  const totalSeconds = Math.max(0, Math.floor(value))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function clampIndex(index: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.max(index, 0), max - 1)
}

function buildBookmark(unit: ScriptUnit, kind: StudyBookmark['kind'], count: number): StudyBookmark {
  return {
    id: makeBookmarkId(),
    kind,
    label: `${bookmarkKindLabel(kind)} ${count}`,
    text: unit.text.replace(/\s+/g, ' ').trim(),
    start: unit.start,
    end: unit.end,
    created_at: new Date().toISOString(),
  }
}

export function StudyWorkbench({
  file,
  selectedVersion,
  selectedVersionId,
  onSelectVersion,
  voice,
  draftScriptText,
  transcriptRaw,
  toast,
}: {
  file: Clip
  selectedVersion: ScriptVersion | null
  selectedVersionId: string | null
  onSelectVersion: (version: ScriptVersion) => void
  voice: string
  draftScriptText: string
  transcriptRaw: string
  toast: (message: string, type?: 'info' | 'error') => void
}) {
  const { selectedSubject, selectedWeek, setLibrary } = useStore()
  const subject = selectedSubject()
  const week = selectedWeek()

  const audioRef = useRef<HTMLAudioElement>(null)
  const scriptRef = useRef<HTMLDivElement>(null)
  const activeSpanRef = useRef<HTMLButtonElement>(null)
  const loopJumpRef = useRef(0)
  const queueJumpRef = useRef(0)
  const studyReadyRef = useRef(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [studyView, setStudyView] = useState<StudyView>('sync')
  const [studyChecks, setStudyChecks] = useState<StudyChecks>(EMPTY_CHECKS)
  const [studyNote, setStudyNote] = useState('')
  const [recallNote, setRecallNote] = useState('')
  const [bookmarks, setBookmarks] = useState<StudyBookmark[]>([])
  const [queueMode, setQueueMode] = useState<QueueMode>('off')
  const [queueIndex, setQueueIndex] = useState(0)
  const [loopRange, setLoopRange] = useState<LoopRange | null>(null)
  const [blindReveal, setBlindReveal] = useState(false)
  const [savingStudy, setSavingStudy] = useState(false)

  const studyChecksValue = file.study?.checks || EMPTY_CHECKS
  const studyNoteValue = file.study?.note || ''
  const recallNoteValue = file.study?.recall_note || ''
  const studyBookmarksValue = useMemo(() => file.study?.bookmarks || [], [file.study?.bookmarks])
  const studyViewValue = file.study?.last_view || 'sync'

  useEffect(() => {
    setStudyChecks(studyChecksValue)
    setStudyNote(studyNoteValue)
    setRecallNote(recallNoteValue)
    setBookmarks(sortBookmarks(studyBookmarksValue))
    setStudyView(studyViewValue)
    setQueueMode('off')
    setQueueIndex(0)
    setLoopRange(null)
    setBlindReveal(false)
    setCurrentTime(0)
    setPlaybackRate(1)
    studyReadyRef.current = false
  }, [file.id, recallNoteValue, studyBookmarksValue, studyChecksValue, studyNoteValue, studyViewValue])

  useEffect(() => {
    if (!audioRef.current) return
    audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  const scriptUnits = useMemo<ScriptUnit[]>(() => {
    if (!file.sentences?.length) return []
    const units: ScriptUnit[] = []
    file.sentences.forEach(sentence => {
      const fine = splitReadableSentences(sentence.text || '')
      if (fine.length <= 1) {
        units.push({ text: sentence.text || '', start: Number(sentence.start || 0), end: Number(sentence.end || 0) })
        return
      }
      const start = Number(sentence.start || 0)
      const end = Number(sentence.end || start + 1)
      const step = Math.max(0.2, end - start) / fine.length
      fine.forEach((text, index) => units.push({ text, start: start + step * index, end: index === fine.length - 1 ? end : start + step * (index + 1) }))
    })
    return units
  }, [file.sentences])

  const activeSentenceIndex = useMemo(
    () => (scriptUnits.length ? scriptUnits.findIndex(unit => currentTime >= unit.start && currentTime < unit.end) : -1),
    [currentTime, scriptUnits],
  )

  const activeUnit = useMemo(() => {
    if (!scriptUnits.length) return null
    if (activeSentenceIndex >= 0) return scriptUnits[activeSentenceIndex]
    const nextIndex = scriptUnits.findIndex(unit => unit.start > currentTime)
    return nextIndex === -1 ? scriptUnits.at(-1) ?? null : scriptUnits[Math.max(0, nextIndex - 1)] ?? null
  }, [activeSentenceIndex, currentTime, scriptUnits])

  const synopsisSections = useMemo(
    () => buildSynopsisFromTranscript(draftScriptText || transcriptRaw || file.summary || '', file.sentences || []),
    [draftScriptText, file.sentences, file.summary, transcriptRaw],
  )

  const summaryHtml = useMemo(() => (file.summary ? parseMarkdownForView(sanitizeMarkdown(file.summary)) : ''), [file.summary])
  const scriptHtml = useMemo(() => parseMarkdownForView(sanitizeMarkdown(draftScriptText || file.text || '')), [draftScriptText, file.text])

  const bookmarkStats = useMemo(
    () => ({
      total: bookmarks.length,
      hard: bookmarks.filter(bookmark => bookmark.kind === 'hard').length,
      memory: bookmarks.filter(bookmark => bookmark.kind === 'memory').length,
    }),
    [bookmarks],
  )

  const queueItems = useMemo(() => (
    queueMode === 'hard' ? bookmarks.filter(bookmark => bookmark.kind === 'hard')
      : queueMode === 'memory' ? bookmarks.filter(bookmark => bookmark.kind === 'memory')
        : queueMode === 'all' ? bookmarks : []
  ), [bookmarks, queueMode])

  const currentQueueBookmark = useMemo(
    () => (queueMode === 'off' ? null : queueItems[clampIndex(queueIndex, queueItems.length)] ?? null),
    [queueIndex, queueItems, queueMode],
  )

  useEffect(() => {
    if (studyView !== 'sync' || !activeSpanRef.current || !scriptRef.current) return
    activeSpanRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeSentenceIndex, studyView])

  useEffect(() => {
    if (!subject || !week) return
    if (!studyReadyRef.current) {
      studyReadyRef.current = true
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        setSavingStudy(true)
        const response = await updateStudyState({
          subject: subject.name,
          week_id: week.id,
          clip_id: file.id,
          note: studyNote,
          recall_note: recallNote,
          checks: studyChecks,
          bookmarks,
          last_view: studyView,
        })
        setLibrary(response.library)
      } catch (error) {
        toast((error as Error).message, 'error')
      } finally {
        setSavingStudy(false)
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [bookmarks, file.id, recallNote, setLibrary, studyChecks, studyNote, studyView, subject, toast, week])

  const seekAndPlay = useCallback((startAt: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.max(0, startAt)
    audioRef.current.play().catch(() => {})
  }, [])

  const stopQueue = useCallback(() => {
    setQueueMode('off')
    setQueueIndex(0)
  }, [])

  const jumpToQueue = useCallback((index: number) => {
    const safeIndex = clampIndex(index, queueItems.length)
    const target = queueItems[safeIndex]
    if (!target) return
    setQueueIndex(safeIndex)
    seekAndPlay(target.start)
  }, [queueItems, seekAndPlay])

  const startQueue = useCallback((mode: Exclude<QueueMode, 'off'>) => {
    const items = mode === 'hard' ? bookmarks.filter(bookmark => bookmark.kind === 'hard') : mode === 'memory' ? bookmarks.filter(bookmark => bookmark.kind === 'memory') : bookmarks
    if (!items.length) {
      toast(`${queueModeLabel(mode)}에 넣을 북마크가 없습니다.`, 'error')
      return
    }
    setQueueMode(mode)
    setQueueIndex(0)
    setStudyView('focus')
    seekAndPlay(items[0].start)
  }, [bookmarks, seekAndPlay, toast])

  const toggleCurrentLoop = useCallback(() => {
    if (!activeUnit) {
      toast('반복할 현재 문장이 없습니다.', 'error')
      return
    }
    setLoopRange(current => current && Math.abs(current.start - activeUnit.start) < 0.05 ? null : { start: activeUnit.start, end: activeUnit.end, label: '현재 문장' })
  }, [activeUnit, toast])

  const setLoopFromBookmark = useCallback((bookmark: StudyBookmark) => {
    setLoopRange(current => current && Math.abs(current.start - bookmark.start) < 0.05 ? null : { start: bookmark.start, end: bookmark.end, label: bookmark.label })
  }, [])

  const addBookmark = useCallback((kind: StudyBookmark['kind']) => {
    if (!activeUnit) {
      toast('북마크할 문장이 없습니다.', 'error')
      return
    }
    if (bookmarks.some(bookmark => Math.abs(bookmark.start - activeUnit.start) < 0.05 && bookmark.kind === kind)) {
      toast('이미 같은 종류의 북마크가 있습니다.')
      return
    }
    const count = bookmarks.filter(bookmark => bookmark.kind === kind).length + 1
    setBookmarks(current => sortBookmarks([...current, buildBookmark(activeUnit, kind, count)]))
    setStudyView('focus')
    toast(`${bookmarkKindLabel(kind)} 북마크를 추가했습니다.`)
  }, [activeUnit, bookmarks, toast])

  const copyBookmarks = useCallback(async () => {
    if (!bookmarks.length) {
      toast('복사할 북마크가 없습니다.', 'error')
      return
    }
    const text = bookmarks.map(bookmark => `[${bookmarkKindLabel(bookmark.kind)}] ${bookmark.label} (${secondsLabel(bookmark.start)}-${secondsLabel(bookmark.end)})\n${bookmark.text}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('북마크 묶음을 복사했습니다.')
    } catch {
      toast('북마크 복사에 실패했습니다.', 'error')
    }
  }, [bookmarks, toast])

  useEffect(() => {
    const handlers: Array<[string, EventListener]> = [
      ['kbd:addBookmark', (() => addBookmark('focus')) as EventListener],
      ['kbd:addHardBookmark', (() => addBookmark('hard')) as EventListener],
      ['kbd:addMemoryBookmark', (() => addBookmark('memory')) as EventListener],
      ['kbd:toggleLoopCurrent', (toggleCurrentLoop as unknown as EventListener)],
      ['kbd:toggleHardQueue', (() => (queueMode === 'hard' ? stopQueue() : startQueue('hard'))) as EventListener],
      ['kbd:toggleAllQueue', (() => (queueMode === 'all' ? stopQueue() : startQueue('all'))) as EventListener],
      ['kbd:viewSync', (() => setStudyView('sync')) as EventListener],
      ['kbd:viewSummary', (() => setStudyView('summary')) as EventListener],
      ['kbd:viewFocus', (() => setStudyView('focus')) as EventListener],
      ['kbd:viewBlind', (() => setStudyView('blind')) as EventListener],
    ]
    handlers.forEach(([name, handler]) => window.addEventListener(name, handler))
    return () => handlers.forEach(([name, handler]) => window.removeEventListener(name, handler))
  }, [addBookmark, queueMode, startQueue, stopQueue, toggleCurrentLoop])

  const handleTimeUpdate = (event: SyntheticEvent<HTMLAudioElement>) => {
    const audio = event.currentTarget
    const nextTime = audio.currentTime
    setCurrentTime(nextTime)

    if (loopRange && nextTime >= loopRange.end - 0.02) {
      const now = Date.now()
      if (now - loopJumpRef.current > 250) {
        loopJumpRef.current = now
        audio.currentTime = loopRange.start
      }
      return
    }

    if (queueMode !== 'off' && currentQueueBookmark && nextTime >= currentQueueBookmark.end - 0.02) {
      const now = Date.now()
      if (now - queueJumpRef.current > 250) {
        queueJumpRef.current = now
        const nextIndex = queueIndex + 1
        if (nextIndex < queueItems.length) {
          jumpToQueue(nextIndex)
        } else {
          stopQueue()
          toast('복습 큐를 끝냈습니다.')
        }
      }
    }
  }

  const handleEnded = () => {
    if (queueMode !== 'off' && queueIndex + 1 < queueItems.length) {
      jumpToQueue(queueIndex + 1)
      return
    }
    if (queueMode !== 'off') {
      stopQueue()
      toast('복습 큐를 끝냈습니다.')
      return
    }
    useStore.getState().playNextClip()
  }

  const audioVersion = encodeURIComponent(file.created_at ?? 'latest')
  const audioSrc = file.audio_path ? `${file.audio_path}?v=${audioVersion}` : null
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1.15fr) minmax(340px, 0.85fr)' }}>
      <SectionCard title="학습 플레이어">
        {audioSrc ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {file.script_versions.map(version => <button key={version.id} className={`soft-btn ${selectedVersionId === version.id ? 'active' : ''}`} type="button" onClick={() => onSelectVersion(version)}>{version.label}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['sync', 'summary', 'focus', 'blind'] as const).map(view => <button key={view} className={`soft-btn ${studyView === view ? 'active' : ''}`} type="button" onClick={() => setStudyView(view)}>{view === 'sync' ? '싱크' : view === 'summary' ? '요약' : view === 'focus' ? '집중' : '블라인드'}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SPEED_PRESETS.map(rate => <button key={rate} className={`soft-btn ${Math.abs(playbackRate - rate) < 0.01 ? 'active' : ''}`} type="button" onClick={() => setPlaybackRate(rate)}>{rate}x</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="soft-btn" type="button" onClick={() => addBookmark('focus')}>핵심 북마크</button>
              <button className="soft-btn" type="button" onClick={() => addBookmark('hard')}>헷갈림</button>
              <button className="soft-btn" type="button" onClick={() => addBookmark('memory')}>암기 포인트</button>
              <button className={`soft-btn ${loopRange ? 'active' : ''}`} type="button" onClick={toggleCurrentLoop}>현재 문장 반복</button>
              {loopRange && <button className="soft-btn" type="button" onClick={() => setLoopRange(null)}>반복 해제</button>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className={`soft-btn ${queueMode === 'hard' ? 'active' : ''}`} type="button" onClick={() => (queueMode === 'hard' ? stopQueue() : startQueue('hard'))}>헷갈림 큐</button>
              <button className={`soft-btn ${queueMode === 'all' ? 'active' : ''}`} type="button" onClick={() => (queueMode === 'all' ? stopQueue() : startQueue('all'))}>전체 큐</button>
              <button className={`soft-btn ${queueMode === 'memory' ? 'active' : ''}`} type="button" onClick={() => (queueMode === 'memory' ? stopQueue() : startQueue('memory'))}>암기 큐</button>
            </div>
            <div style={{ color: 'var(--subtle)', fontSize: '0.9rem' }}>{selectedVersion?.label || file.title} / {voice} / {formatDate(file.created_at)} / {queueModeLabel(queueMode)} {queueMode !== 'off' ? `(${clampIndex(queueIndex, queueItems.length) + 1}/${Math.max(queueItems.length, 1)})` : ''}</div>
            <audio ref={audioRef} controls preload="metadata" src={audioSrc} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} onRateChange={event => setPlaybackRate(event.currentTarget.playbackRate)} style={{ width: '100%' }} />

            {studyView === 'sync' && (
              scriptUnits.length ? (
                <div ref={scriptRef} className="sentences-list">
                  {scriptUnits.map((unit, index) => {
                    const active = index === activeSentenceIndex
                    const unitMarks = bookmarks.filter(bookmark => Math.abs(bookmark.start - unit.start) < 0.05)
                    return (
                      <button key={`${unit.start}-${index}`} ref={active ? activeSpanRef : undefined} className={`sentence-item ${active ? 'active' : ''}`} type="button" onClick={() => seekAndPlay(unit.start)} style={unitMarks.length ? { borderColor: 'rgba(255,255,255,0.12)' } : undefined}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{unit.text}</span><span style={{ color: 'var(--subtle)', fontSize: '0.78rem' }}>{secondsLabel(unit.start)}</span></div>
                        {unitMarks.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{unitMarks.map(bookmark => <span key={bookmark.id} style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', fontSize: '0.75rem' }}>{bookmarkKindLabel(bookmark.kind)}</span>)}</div>}
                      </button>
                    )
                  })}
                </div>
              ) : <div className="summary-markdown-view" dangerouslySetInnerHTML={{ __html: scriptHtml }} />
            )}

            {studyView === 'summary' && (
              <div style={{ display: 'grid', gap: 14 }}>
                {summaryHtml && <div className="summary-markdown-view" dangerouslySetInnerHTML={{ __html: summaryHtml }} />}
                <div className="summary-view">
                  {synopsisSections.map(section => (
                    <div key={section.id} className="summary-section">
                      <button className="summary-heading" type="button" onClick={() => seekAndPlay(section.start)}>{section.title}</button>
                      <div className="summary-points">
                        {section.points.map((point, index) => <button key={`${section.id}-${index}`} className="summary-point" type="button" onClick={() => seekAndPlay(point.start)}>{point.text}</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {studyView === 'focus' && (
              <div style={{ display: 'grid', gap: 12 }}>
                {currentQueueBookmark ? (
                  <div className="summary-section active">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><strong>{currentQueueBookmark.label}</strong><span style={{ color: 'var(--subtle)', fontSize: '0.82rem' }}>{secondsLabel(currentQueueBookmark.start)} - {secondsLabel(currentQueueBookmark.end)}</span></div>
                    <div style={{ lineHeight: 1.75 }}>{currentQueueBookmark.text}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="soft-btn" type="button" onClick={() => seekAndPlay(currentQueueBookmark.start)}>다시 듣기</button><button className="soft-btn" type="button" onClick={() => setLoopFromBookmark(currentQueueBookmark)}>이 구간 반복</button></div>
                  </div>
                ) : <div className="quick-compose-notice">북마크를 만들면 헷갈린 구간과 암기 구간만 빠르게 돌릴 수 있습니다.</div>}
                {bookmarks.map(bookmark => (
                  <div key={bookmark.id} className="summary-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{bookmark.label}</strong><div style={{ color: 'var(--subtle)', fontSize: '0.82rem' }}>{bookmarkKindLabel(bookmark.kind)} / {secondsLabel(bookmark.start)} - {secondsLabel(bookmark.end)}</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="soft-btn" type="button" onClick={() => seekAndPlay(bookmark.start)}>점프</button><button className="soft-btn" type="button" onClick={() => setLoopFromBookmark(bookmark)}>반복</button><button className="soft-btn" type="button" onClick={() => setBookmarks(current => current.filter(item => item.id !== bookmark.id))}>삭제</button></div></div>
                    <div style={{ lineHeight: 1.7 }}>{bookmark.text}</div>
                  </div>
                ))}
              </div>
            )}

            {studyView === 'blind' && (
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="quick-compose-notice">먼저 듣고 머릿속으로 따라 말한 뒤 정답 보기를 누르세요.</div>
                <div className="summary-section active" style={{ minHeight: 220, justifyContent: 'center' }}>
                  <div style={{ color: 'var(--subtle)', fontSize: '0.82rem' }}>현재 문장 / {activeUnit ? `${secondsLabel(activeUnit.start)} - ${secondsLabel(activeUnit.end)}` : '대기 중'}</div>
                  <div style={{ fontSize: '1.2rem', lineHeight: 1.9, filter: blindReveal ? 'none' : 'blur(10px)', userSelect: blindReveal ? 'text' : 'none', transition: 'filter 160ms ease' }}>{activeUnit?.text || '재생을 시작하면 현재 문장이 표시됩니다.'}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="soft-btn" type="button" onClick={() => setBlindReveal(current => !current)}>{blindReveal ? '다시 가리기' : '정답 보기'}</button>{activeUnit && <button className="soft-btn" type="button" onClick={() => seekAndPlay(activeUnit.start)}>다시 듣기</button>}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: 'var(--subtle)' }}>아직 생성된 음성이 없습니다. 먼저 대본 탭에서 TTS를 생성하세요.</div>
            <button className="primary-btn" type="button" onClick={() => useStore.getState().setActiveTab('compose')}>대본 탭으로 이동</button>
          </div>
        )}
      </SectionCard>

      <div style={{ display: 'grid', gap: 16 }}>
        <SectionCard title="학습 대시보드">
          <div style={{ display: 'grid', gap: 12 }}>
            <InfoChip label="과목" value={subject?.name || '없음'} />
            <InfoChip label="주차" value={week?.name || '없음'} />
            <InfoChip label="파일" value={file.title} />
            <InfoChip label="헷갈림" value={String(bookmarkStats.hard)} />
            <InfoChip label="암기" value={String(bookmarkStats.memory)} />
            <InfoChip label="체크" value={`${Object.values(studyChecks).filter(Boolean).length}/3`} />
            <InfoChip label="자동 저장" value={savingStudy ? '저장 중' : '대기'} />
          </div>
        </SectionCard>

        <SectionCard title="오늘의 체크">
          <div style={{ display: 'grid', gap: 10 }}>
            <StudyCheckRow checked={studyChecks.listen} label="정주행으로 전체 맥락 듣기" onToggle={() => setStudyChecks(current => ({ ...current, listen: !current.listen }))} />
            <StudyCheckRow checked={studyChecks.review} label="헷갈린 구간 북마크 찍기" onToggle={() => setStudyChecks(current => ({ ...current, review: !current.review }))} />
            <StudyCheckRow checked={studyChecks.memorize} label="암기 구간 반복 큐 돌리기" onToggle={() => setStudyChecks(current => ({ ...current, memorize: !current.memorize }))} />
            <div className="quick-compose-notice">체크와 노트, 북마크는 파일별로 자동 저장됩니다.</div>
          </div>
        </SectionCard>

        <SectionCard title="북마크 / 복습 큐">
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="soft-btn" type="button" onClick={copyBookmarks}>북마크 복사</button><button className="soft-btn" type="button" onClick={() => startQueue('hard')}>헷갈림만 복습</button><button className="soft-btn" type="button" onClick={() => startQueue('memory')}>암기만 복습</button></div>
            {bookmarks.length ? (
              <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflow: 'auto', paddingRight: 4 }}>
                {bookmarks.map(bookmark => (
                  <div key={bookmark.id} style={{ padding: 12, borderRadius: 14, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><strong>{bookmark.label}</strong><span style={{ color: 'var(--subtle)', fontSize: '0.78rem' }}>{bookmarkKindLabel(bookmark.kind)}</span></div>
                    <div style={{ marginTop: 6, color: 'var(--subtle)', fontSize: '0.8rem' }}>{secondsLabel(bookmark.start)} - {secondsLabel(bookmark.end)}</div>
                    <div style={{ marginTop: 8, lineHeight: 1.6 }}>{bookmark.text}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><button className="soft-btn" type="button" onClick={() => seekAndPlay(bookmark.start)}>점프</button><button className={`soft-btn ${loopRange && Math.abs(loopRange.start - bookmark.start) < 0.05 ? 'active' : ''}`} type="button" onClick={() => setLoopFromBookmark(bookmark)}>반복</button><button className="soft-btn" type="button" onClick={() => setBookmarks(current => current.filter(item => item.id !== bookmark.id))}>삭제</button></div>
                  </div>
                ))}
              </div>
            ) : <div className="quick-compose-notice">B/H/F/L/R/1~4 계열 단축키와 버튼으로 북마크, 반복, 뷰 전환을 빠르게 돌릴 수 있습니다.</div>}
          </div>
        </SectionCard>

        <SectionCard title="학습 노트">
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="workflow-field"><span>내 요약 / 연결 메모</span><textarea value={studyNote} onChange={event => setStudyNote(event.target.value)} rows={6} className="quick-compose-text" /></label>
            <label className="workflow-field"><span>예상 질문 / 회상용 키워드</span><textarea value={recallNote} onChange={event => setRecallNote(event.target.value)} rows={5} className="quick-compose-text" /></label>
            <div className="quick-compose-notice">Shift+N / Shift+P로 다음 파일, 이전 파일로 이동할 수 있습니다.</div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ display: 'grid', gap: 12, padding: 18, borderRadius: 18, border: '1px solid var(--line)', background: 'rgba(12, 18, 33, 0.72)', boxShadow: 'var(--shadow-soft)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><strong>{title}</strong></div>{children}</section>
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.04)' }}><span style={{ color: 'var(--subtle)', fontSize: '0.8rem' }}>{label}</span><strong style={{ fontSize: '0.88rem' }}>{value}</strong></div>
}

function StudyCheckRow({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, padding: '0 12px', borderRadius: 14, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}><input type="checkbox" checked={checked} onChange={onToggle} /><span>{label}</span></label>
}
