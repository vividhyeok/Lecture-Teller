import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useStore } from '../../store/useStore'
import { Icons } from '../ui/Icons'
import { createSubject, createWeek, createClip, deleteSubject, deleteWeek, deleteClip, reorderClips } from '../../api/library'
import type { Week } from '../../types'
// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, minWidth: 156 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPos = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const menuWidth = menuRef.current?.offsetWidth || 180
    const menuHeight = menuRef.current?.offsetHeight || 140
    const margin = 8

    let left = r.right - menuWidth
    if (left < margin) left = margin
    if (left + menuWidth > window.innerWidth - margin) left = window.innerWidth - menuWidth - margin

    let top = r.bottom + 6
    if (top + menuHeight > window.innerHeight - margin) {
      top = Math.max(margin, r.top - menuHeight - 6)
    }

    setMenuPos({ top, left, minWidth: Math.max(148, r.width + 92) })
  }, [])

  useEffect(() => {
    if (!open) return

    updateMenuPos()

    const closeIfOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (btnRef.current?.contains(target)) return
      setOpen(false)
    }
    const onViewportChange = () => updateMenuPos()
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, updateMenuPos])

  useEffect(() => {
    if (open) updateMenuPos()
  }, [open, items.length, updateMenuPos])

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setOpen(prev => !prev)
  }

  const menuNode = open ? (
    <div
      ref={menuRef}
      className="dropdown-menu open"
      style={{ position: 'fixed', zIndex: 1400, top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
    >
      {items.map(item => (
        <button key={item.label} className={`dropdown-item${item.danger ? ' danger' : ''}`} type="button"
          onClick={() => { setOpen(false); item.onClick() }}>
          {item.danger ? Icons.trash : Icons.plus} {item.label}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      <button ref={btnRef} className="mini-btn" type="button" onMouseDown={e => e.stopPropagation()} onClick={toggle}>
        {Icons.more}
      </button>
      {menuNode ? createPortal(menuNode, document.body) : null}
    </div>
  )
}

// ── ClipRow ───────────────────────────────────────────────────────────────────
function ClipRow({ subjectName, week, clipIdx }: { subjectName: string; week: Week; clipIdx: number }) {
  const clip = week.clips[clipIdx]
  const { selectedClipId, selectClip, setLibrary } = useStore()
  const active = clip.id === selectedClipId
  const { toast } = useToastCtx()

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, display: 'flex', alignItems: 'center' }

  const onSelect = () => {
    selectClip(subjectName, week.id, clip.id)
  }

  const onDelete = async () => {
    if (!confirm(`"${clip.title}" 파일을 삭제하시겠습니까?`)) return
    try {
      const res = await deleteClip(subjectName, week.id, clip.id)
      setLibrary(res.library)
      toast('파일 삭제')
    } catch (e: unknown) { toast((e as Error).message, 'error') }
  }

  return (
    <div className={`unit-row ${isDragging ? 'dragging' : ''}`} ref={setNodeRef} style={style}>
      <button className="drag-handle" type="button" {...attributes} {...listeners} style={{ cursor: 'grab', padding: '0 4px', color: 'var(--subtle)' }}>
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/></svg>
      </button>
      <button className={`unit-main ${active ? 'active' : ''}`} type="button" onClick={onSelect} style={{ flex: 1 }}>
        <span className="unit-copy">
          <span className="unit-name">{clip.title}</span>
        </span>
        <span className={`unit-status ${clip.audio_path ? 'ready' : ''}`} />
      </button>
      <Dropdown items={[{ label: '파일 삭제', danger: true, onClick: onDelete }]} />
    </div>
  )
}

// ── WeekCard ──────────────────────────────────────────────────────────────────
function WeekCard({ subjectName, weekIdx }: { subjectName: string; weekIdx: number }) {
  const { library, setLibrary, selectedWeekId } = useStore()
  const subj = library.subjects.find(s => s.name === subjectName)!
  const week = subj.weeks[weekIdx]
  const [open, setOpen] = useState(week.id === selectedWeekId)
  const { toast } = useToastCtx()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = week.clips.findIndex(c => c.id === active.id)
      const newIndex = week.clips.findIndex(c => c.id === over.id)
      const newClips = arrayMove(week.clips, oldIndex, newIndex)
      
      // Optimistic update
      const newLib = JSON.parse(JSON.stringify(library)) as typeof library
      const targetSubj = newLib.subjects.find(s => s.name === subjectName)
      const targetWeek = targetSubj?.weeks.find(w => w.id === week.id)
      if (!targetSubj || !targetWeek) return
      targetWeek.clips = newClips
      setLibrary(newLib)

      try {
        const res = await reorderClips(subjectName, week.id, newClips.map(c => c.id))
        setLibrary(res.library)
      } catch (e: unknown) {
        toast((e as Error).message, 'error')
        setLibrary(library) // revert
      }
    }
  }

  const onAddClip = async () => {
    const title = prompt(`"${week.name}" 파일 이름`)
    if (!title?.trim()) return
    try {
      const res = await createClip(subjectName, week.id, title.trim())
      setLibrary(res.library)
      const newClip = res.clip
      useStore.getState().selectClip(subjectName, week.id, newClip.id)
      toast('파일 추가')
    } catch (e: unknown) { toast((e as Error).message, 'error') }
  }

  const onDeleteWeek = async () => {
    if (!confirm(`"${week.name}" 주차를 삭제하시겠습니까?`)) return
    try {
      const res = await deleteWeek(subjectName, week.id)
      setLibrary(res.library)
      toast('주차 삭제')
    } catch (e: unknown) { toast((e as Error).message, 'error') }
  }

  const onPlayAll = () => {
    const firstReady = week.clips.find(c => c.audio_path)
    if (firstReady) {
      useStore.getState().selectClip(subjectName, week.id, firstReady.id)
    } else {
      toast('재생 가능한 파일이 없습니다.', 'error')
    }
  }

  const activeWeek = week.id === selectedWeekId

  return (
    <div className={`subject-card ${open ? 'open' : ''} ${activeWeek ? 'active' : ''}`}
      style={{ marginLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
      <div className="subject-row">
        <button className="subject-main" type="button" onClick={() => setOpen(o => !o)}>
          <span className="chevron">{Icons.chevron}</span>
          <span className="subject-copy">
            <span className="subject-name" style={{ fontSize: '0.82rem' }}>{week.name}</span>
            <span className="subject-count">{week.clips.length}</span>
          </span>
        </button>
        <Dropdown items={[
          { label: '연속재생', onClick: onPlayAll },
          { label: '파일 추가', onClick: onAddClip },
          { label: '주차 삭제', danger: true, onClick: onDeleteWeek },
        ]} />
      </div>
      {open && (
        <div className="unit-list">
          {week.clips.length ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={week.clips.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {week.clips.map((_, i) => <ClipRow key={week.clips[i].id} subjectName={subjectName} week={week} clipIdx={i} />)}
              </SortableContext>
            </DndContext>
          ) : <div className="sidebar-empty" style={{ padding: 12 }}>파일 없음</div>}
        </div>
      )}
    </div>
  )
}

// ── Toast context (passed down to avoid prop drilling for now) ─────────────────
import { createContext, useContext, type ReactNode } from 'react'
const ToastCtx = createContext<{ toast: (m: string, t?: 'info' | 'error') => void }>({
  toast: () => {},
})
export const ToastProvider = ({ children, toast }: { children: ReactNode; toast: (m: string, t?: 'info' | 'error') => void }) =>
  <ToastCtx.Provider value={{ toast }}>{children}</ToastCtx.Provider>
const useToastCtx = () => useContext(ToastCtx)

// ── SubjectCard ───────────────────────────────────────────────────────────────
function SubjectCard({ idx }: { idx: number }) {
  const { library, selectedSubjectName, expandedSubjects, toggleExpanded, selectSubject, setLibrary, setActiveTab } = useStore()
  const subject = library.subjects[idx]
  const open = expandedSubjects.has(subject.name)
  const active = subject.name === selectedSubjectName
  const { toast } = useToastCtx()

  const onToggle = () => {
    toggleExpanded(subject.name)
    selectSubject(subject.name)
    setActiveTab('explore')
  }

  const onAddWeek = async () => {
    const name = prompt(`"${subject.name}" 주차 이름`)
    if (!name?.trim()) return
    try {
      const res = await createWeek(subject.name, name.trim())
      setLibrary(res.library)
      toast('주차 추가')
    } catch (e: unknown) { toast((e as Error).message, 'error') }
  }

  const onDeleteSubject = async () => {
    if (!confirm(`"${subject.name}" 과목을 삭제하시겠습니까? 관련 파일이 모두 삭제됩니다.`)) return
    try {
      const res = await deleteSubject(subject.name)
      setLibrary(res.library)
      toast('과목 삭제')
    } catch (e: unknown) { toast((e as Error).message, 'error') }
  }

  const totalClips = subject.weeks.reduce((n, w) => n + w.clips.length, 0)

  return (
    <section className={`subject-card ${open ? 'open' : ''} ${active ? 'active' : ''}`}>
      <div className="subject-row">
        <button className="subject-main" type="button" onClick={onToggle}>
          <span className="chevron">{Icons.chevron}</span>
          <span className="subject-dot" />
          <span className="subject-copy">
            <span className="subject-name">{subject.name}</span>
            <span className="subject-count">{totalClips}</span>
          </span>
        </button>
        <Dropdown items={[
          { label: '주차 추가', onClick: onAddWeek },
          { label: '과목 삭제', danger: true, onClick: onDeleteSubject },
        ]} />
      </div>
      {open && (
        <div className="unit-list">
          {subject.weeks.length
            ? subject.weeks.map((_, i) => <WeekCard key={subject.weeks[i].id} subjectName={subject.name} weekIdx={i} />)
            : <div className="sidebar-empty" style={{ padding: 12 }}>주차 없음</div>}
        </div>
      )}
    </section>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export function Sidebar({ toast }: { toast: (m: string, t?: 'info' | 'error') => void }) {
  const { library, setLibrary, setSidebarCollapsed } = useStore()

  const onAddSubject = async () => {
    const name = prompt('새 과목 이름')
    if (!name?.trim()) return
    try {
      const res = await createSubject(name.trim())
      setLibrary(res.library)
      useStore.getState().selectSubject(name.trim())
      toast('과목 추가')
    } catch (e: unknown) { toast((e as Error).message, 'error') }
  }

  return (
    <ToastProvider toast={toast}>
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">{Icons.library} LectureTeller</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="mini-btn" type="button" title="과목 추가" onClick={onAddSubject}>{Icons.plus}</button>
            <button className="mini-btn" type="button" title="사이드바 닫기"
              onClick={() => setSidebarCollapsed(true)}>{Icons.x}</button>
          </div>
        </div>
        <div className="subject-list" id="subjectList">
          {library.subjects.length
            ? library.subjects.map((_, i) => <SubjectCard key={library.subjects[i].name} idx={i} />)
            : <div className="sidebar-empty">과목 없음<br />+</div>}
        </div>
      </aside>
    </ToastProvider>
  )
}
