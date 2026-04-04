import { apiFetch } from './client'
import { useStore } from '../store/useStore'
import type { Clip, Library, ProfessorProfile, ScriptVersion, Settings, StudyBookmark, StudyChecks, Week } from '../types'

interface LibraryRes {
  library: Library
  voices?: string[]
}

interface ClipRes {
  library: Library
  clip: Clip
}

interface ProfileRes {
  library: Library
  profile: ProfessorProfile
}

interface ScriptVersionRes {
  library: Library
  clip: Clip
  script_version: ScriptVersion
  prompt_text?: string
  prompt_chunks?: string[]
  processing?: { source_chunks: number; merge_passes: number }
}

export const getLibrary = () => apiFetch<LibraryRes>('/api/v2/library')

export const createSubject = (name: string) =>
  apiFetch<LibraryRes>('/api/v2/subjects', { method: 'POST', body: JSON.stringify({ name }) })

export const deleteSubject = (name: string) =>
  apiFetch<LibraryRes>(`/api/v2/subjects?name=${encodeURIComponent(name)}`, { method: 'DELETE' })

export const createWeek = (subject: string, name: string, description = '') =>
  apiFetch<{ library: Library; week: Week }>('/api/weeks', {
    method: 'POST',
    body: JSON.stringify({ subject, name, description, tags: [] }),
  })

export const updateWeek = (subject: string, weekId: string, name?: string, description?: string) => {
  const params = new URLSearchParams({ subject, week_id: weekId })
  if (name !== undefined) params.set('name', name)
  if (description !== undefined) params.set('description', description)
  return apiFetch<{ library: Library; week: Week }>(`/api/weeks?${params.toString()}`, { method: 'PATCH' })
}

export const deleteWeek = (subject: string, weekId: string) =>
  apiFetch<LibraryRes>(`/api/weeks?subject=${encodeURIComponent(subject)}&week_id=${weekId}`, { method: 'DELETE' })

export const reorderClips = (subject: string, weekId: string, clipIds: string[]) =>
  apiFetch<LibraryRes>('/api/weeks/reorder_clips', {
    method: 'PATCH',
    body: JSON.stringify({ subject, week_id: weekId, clip_ids: clipIds }),
  })

export const createClip = (subject: string, weekId: string, title: string, clipType = 'lecture') =>
  apiFetch<ClipRes>('/api/clips', {
    method: 'POST',
    body: JSON.stringify({ subject, week_id: weekId, title, clip_type: clipType }),
  })

export const deleteClip = (subject: string, weekId: string, clipId: string) =>
  apiFetch<LibraryRes>(
    `/api/clips?subject=${encodeURIComponent(subject)}&week_id=${weekId}&clip_id=${clipId}`,
    { method: 'DELETE' },
  )

export interface ClipSourceInput {
  subject: string
  week_id: string
  clip_id: string
  transcript_raw: string
  pdf_text: string
  notes: string
  prompt_profile_id: string | null
  output_type: string
  extra_instructions: string
}

export const updateClipSource = (payload: ClipSourceInput) =>
  apiFetch<ClipRes>('/api/clips/source', { method: 'PATCH', body: JSON.stringify(payload) })

export const updateStudyState = (payload: {
  subject: string
  week_id: string
  clip_id: string
  note: string
  recall_note: string
  checks: StudyChecks
  bookmarks: StudyBookmark[]
  last_view: 'sync' | 'summary' | 'focus' | 'blind'
}) =>
  apiFetch<ClipRes>('/api/clips/study', { method: 'PATCH', body: JSON.stringify(payload) })

export const composePrompt = (payload: ClipSourceInput) =>
  apiFetch<{ library: Library; clip: Clip; prompt_text: string; prompt_chunks?: string[] }>('/api/v2/compose_prompt', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const generateScript = (payload: ClipSourceInput & { label: string }) =>
  apiFetch<ScriptVersionRes>('/api/v2/generate_script', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const saveScriptVersion = (payload: {
  subject: string
  week_id: string
  clip_id: string
  label: string
  output_type: string
  source: 'manual' | 'external-ai' | 'legacy'
  prompt_text: string
  text: string
}) =>
  apiFetch<ScriptVersionRes>('/api/clips/script_versions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const selectScriptVersion = (subject: string, weekId: string, clipId: string, scriptVersionId: string) =>
  apiFetch<ScriptVersionRes>('/api/clips/script_versions/select', {
    method: 'PATCH',
    body: JSON.stringify({
      subject,
      week_id: weekId,
      clip_id: clipId,
      script_version_id: scriptVersionId,
    }),
  })

export const generateTts = (
  subject: string,
  weekId: string,
  clipId: string,
  text: string,
  voice: string,
  scriptVersionId?: string | null,
) =>
  apiFetch<{ library: Library; cleaned_text: string; chunk_count: number; clip: Clip }>('/api/v2/generate', {
    method: 'POST',
    body: JSON.stringify({
      subject,
      week_id: weekId,
      clip_id: clipId,
      text,
      voice,
      script_version_id: scriptVersionId ?? null,
    }),
  })

export const createProfile = (payload: Omit<ProfessorProfile, 'id'>) =>
  apiFetch<ProfileRes>('/api/profiles', { method: 'POST', body: JSON.stringify(payload) })

export const updateProfile = (payload: ProfessorProfile) =>
  apiFetch<ProfileRes>('/api/profiles', { method: 'PATCH', body: JSON.stringify(payload) })

export const deleteProfile = (id: string) =>
  apiFetch<LibraryRes>(`/api/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

export const generateAiSummary = (subject: string, weekId: string, clipId: string, prompt: string) =>
  apiFetch<{ library: Library; clip: Clip }>('/api/v2/generate_summary', {
    method: 'POST',
    body: JSON.stringify({ subject, week_id: weekId, clip_id: clipId, prompt }),
  })

export const getSettings = () => apiFetch<Settings>('/api/settings')

export const saveSettings = (payload: Settings) =>
  apiFetch<Settings>('/api/settings', { method: 'POST', body: JSON.stringify(payload) })

export const previewVoice = async (voice: string) => {
  const token = useStore.getState().settings?.api_key || localStorage.getItem('api_key') || ''
  const res = await fetch('/api/settings/preview-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ voice }),
  })
  if (!res.ok) {
    let msg = 'Unknown Error'
    try {
      const data = (await res.json()) as { detail?: string }
      msg = data.detail || msg
    } catch {
      msg = msg || 'Unknown Error'
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
