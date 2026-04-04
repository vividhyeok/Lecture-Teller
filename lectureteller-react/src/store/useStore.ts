import { create } from 'zustand'
import type { Library, Settings, Subject, Week, Clip } from '../types'

export const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const

export type ActiveTab = 'explore' | 'compose' | 'player'

function resolveWorkflowTab(clip: Clip | null | undefined): ActiveTab {
  if (!clip) return 'explore'

  const hasSource = Boolean(clip.transcript_raw?.trim() || clip.pdf_text?.trim() || clip.notes?.trim())
  const hasScript = Boolean(clip.script_versions?.length || clip.text?.trim())
  const hasAudio = Boolean(clip.audio_path)

  if (!hasSource) return 'explore'
  if (!hasScript) return 'compose'
  if (!hasAudio) return 'compose'
  return 'player'
}

interface AppState {
  // ── Data ───────────────────────────────────────────────────────────────────
  library: Library
  settings: Settings

  // ── Selection ──────────────────────────────────────────────────────────────
  selectedSubjectName: string | null
  selectedWeekId: string | null
  selectedClipId: string | null
  expandedSubjects: Set<string>

  // ── UI ─────────────────────────────────────────────────────────────────────
  activeTab: ActiveTab
  loading: boolean
  sidebarCollapsed: boolean
  settingsModalOpen: boolean
  promptModalOpen: boolean
  promptSeedText: string
  fontScale: number

  // ── Computed selectors (stable references) ─────────────────────────────────
  selectedSubject: () => Subject | null
  selectedWeek: () => Week | null
  selectedClip: () => Clip | null
  totalClips: () => number
  totalReadyClips: () => number

  // ── Mutations ──────────────────────────────────────────────────────────────
  setLibrary: (lib: Library) => void
  setSettings: (s: Settings) => void
  setLoading: (v: boolean) => void
  setActiveTab: (tab: ActiveTab) => void
  setSidebarCollapsed: (v: boolean) => void
  openSettingsModal: () => void
  closeSettingsModal: () => void

  selectClip: (subjectName: string, weekId: string, clipId: string) => void
  selectSubject: (subjectName: string) => void
  clearSelection: () => void
  toggleExpanded: (subjectName: string) => void

  openPromptModal: (seedText?: string) => void
  closePromptModal: () => void

  setFontScale: (scale: number) => void

  syncSelection: () => void

  playNextClip: () => void
  playPrevClip: () => void
}

export const useStore = create<AppState>((set, get) => ({
  // ── Initial data ────────────────────────────────────────────────────────────
  library: { subjects: [], profiles: [] },
  settings: { api_key: '', audio_dir: '', default_voice: '', default_text_model: '' },

  // ── Initial selection ───────────────────────────────────────────────────────
  selectedSubjectName: null,
  selectedWeekId: null,
  selectedClipId: null,
  expandedSubjects: new Set<string>(),

  // ── UI UI UI ───────────────────────────────────────────────────────────────
  activeTab: 'explore',
  loading: false,
  sidebarCollapsed: false,
  settingsModalOpen: false,
  promptModalOpen: false,
  promptSeedText: '',
  fontScale: 100,


  // ── Computed ────────────────────────────────────────────────────────────────
  selectedSubject: () => {
    const { library, selectedSubjectName } = get()
    return library.subjects.find(s => s.name === selectedSubjectName) ?? null
  },
  selectedWeek: () => {
    const subj = get().selectedSubject()
    const { selectedWeekId } = get()
    return subj?.weeks.find(w => w.id === selectedWeekId) ?? null
  },
  selectedClip: () => {
    const week = get().selectedWeek()
    const { selectedClipId } = get()
    return week?.clips.find(c => c.id === selectedClipId) ?? null
  },
  totalClips: () =>
    get().library.subjects.reduce((n, s) => n + s.weeks.reduce((m, w) => m + w.clips.length, 0), 0),
  totalReadyClips: () =>
    get().library.subjects.reduce(
      (n, s) => n + s.weeks.reduce((m, w) => m + w.clips.filter(c => c.audio_path).length, 0),
      0,
    ),

  // ── Mutations ───────────────────────────────────────────────────────────────
  setLibrary: lib => set({ library: lib }),
  setSettings: s => set({ settings: s }),
  setLoading: v => set({ loading: v }),
  setActiveTab: tab => set({ activeTab: tab }),
  setSidebarCollapsed: v => set({ sidebarCollapsed: v }),
  openSettingsModal: () => set({ settingsModalOpen: true }),
  closeSettingsModal: () => set({ settingsModalOpen: false }),

  selectClip: (subjectName, weekId, clipId) =>
    set(s => ({
      activeTab: resolveWorkflowTab(
        s.library.subjects
          .find(subject => subject.name === subjectName)
          ?.weeks.find(week => week.id === weekId)
          ?.clips.find(clip => clip.id === clipId) ?? null,
      ),
      selectedSubjectName: subjectName,
      selectedWeekId: weekId,
      selectedClipId: clipId,
      expandedSubjects: new Set([...s.expandedSubjects, subjectName]),
    })),

  selectSubject: subjectName =>
    set(s => ({
      selectedSubjectName: subjectName,
      expandedSubjects: new Set([...s.expandedSubjects, subjectName]),
    })),

  clearSelection: () =>
    set({
      selectedSubjectName: null,
      selectedWeekId: null,
      selectedClipId: null,
      activeTab: 'explore',
    }),

  toggleExpanded: subjectName =>
    set(s => {
      const next = new Set(s.expandedSubjects)
      if (next.has(subjectName)) next.delete(subjectName)
      else next.add(subjectName)
      return { expandedSubjects: next }
    }),

  openPromptModal: seedText => set({ promptModalOpen: true, promptSeedText: (seedText ?? '').trim() }),
  closePromptModal: () => set({ promptModalOpen: false, promptSeedText: '' }),

  setFontScale: (fontScale) => set({ fontScale }),

  syncSelection: () => {
    const { library, selectedSubjectName, selectedWeekId, selectedClipId } = get()
    const subjects = library.subjects
    if (!subjects.length) {
      set({ selectedSubjectName: null, selectedWeekId: null, selectedClipId: null, activeTab: 'explore' })
      return
    }
    if (!selectedSubjectName && !selectedWeekId && !selectedClipId) {
      set({ selectedSubjectName: null, selectedWeekId: null, selectedClipId: null, activeTab: 'explore' })
      return
    }
    const subj = subjects.find(s => s.name === selectedSubjectName) ?? subjects[0]
    const weeks = subj.weeks
    const week = weeks.find(w => w.id === selectedWeekId) ?? weeks[0] ?? null
    const clips = week?.clips ?? []
    const clip = clips.find(c => c.id === selectedClipId) ?? clips[0] ?? null
    set({
      activeTab: resolveWorkflowTab(clip),
      selectedSubjectName: subj.name,
      selectedWeekId: week?.id ?? null,
      selectedClipId: clip?.id ?? null,
      expandedSubjects: new Set([...get().expandedSubjects, subj.name]),
    })
  },

  playNextClip: () => {
    const { library, selectedSubjectName, selectedWeekId, selectedClipId, selectClip } = get()
    const subj = library.subjects.find(s => s.name === selectedSubjectName)
    if (!subj) return
    const weekIdx = subj.weeks.findIndex(w => w.id === selectedWeekId)
    if (weekIdx === -1) return
    const week = subj.weeks[weekIdx]
    const clipIdx = week.clips.findIndex(c => c.id === selectedClipId)
    
    // Check same week
    for (let c = clipIdx + 1; c < week.clips.length; c++) {
      if (week.clips[c].audio_path) {
        selectClip(subj.name, week.id, week.clips[c].id)
        return
      }
    }
    // Check next weeks in same subject
    for (let w = weekIdx + 1; w < subj.weeks.length; w++) {
      for (const clip of subj.weeks[w].clips) {
        if (clip.audio_path) {
          selectClip(subj.name, subj.weeks[w].id, clip.id)
          return
        }
      }
    }
  },

  playPrevClip: () => {
    const { library, selectedSubjectName, selectedWeekId, selectedClipId, selectClip } = get()
    const subj = library.subjects.find(s => s.name === selectedSubjectName)
    if (!subj) return
    const weekIdx = subj.weeks.findIndex(w => w.id === selectedWeekId)
    if (weekIdx === -1) return
    const week = subj.weeks[weekIdx]
    const clipIdx = week.clips.findIndex(c => c.id === selectedClipId)

    // Check same week
    for (let c = clipIdx - 1; c >= 0; c--) {
      if (week.clips[c].audio_path) {
        selectClip(subj.name, week.id, week.clips[c].id)
        return
      }
    }
    // Check prev weeks in same subject
    for (let w = weekIdx - 1; w >= 0; w--) {
      const prevWeek = subj.weeks[w];
      for (let c = prevWeek.clips.length - 1; c >= 0; c--) {
        const clip = prevWeek.clips[c]
        if (clip.audio_path) {
          selectClip(subj.name, prevWeek.id, clip.id)
          return
        }
      }
    }
  },
}))
