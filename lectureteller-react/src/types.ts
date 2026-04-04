// ── Types ─────────────────────────────────────────────────────────────────────
export interface Sentence {
  start: number
  end: number
  text: string
}

export interface ProfessorProfile {
  id: string
  name: string
  repetition_style: string
  ppt_reading_ratio: string
  concept_compression_style: string
  difficulty_level: string
  extra_rules: string
}

export interface ScriptVersion {
  id: string
  label: string
  output_type: string
  source: 'manual' | 'external-ai' | 'legacy'
  prompt_text: string
  text: string
  voice: string
  audio_path: string | null
  sentences: Sentence[]
  created_at: string | null
}

export interface StudyBookmark {
  id: string
  kind: 'focus' | 'hard' | 'memory'
  label: string
  text: string
  start: number
  end: number
  created_at: string | null
}

export interface StudyChecks {
  listen: boolean
  review: boolean
  memorize: boolean
}

export interface StudyState {
  note: string
  recall_note: string
  checks: StudyChecks
  bookmarks: StudyBookmark[]
  last_view: 'sync' | 'summary' | 'focus' | 'blind'
}

export interface Clip {
  id: string
  title: string
  storage_name: string
  type: 'lecture' | 'summary' | 'quiz' | 'chat-qa'
  voice: string
  audio_path: string | null
  text: string | null
  summary?: string | null
  sentences: Sentence[]
  derived_from: string | null
  created_at: string | null
  transcript_raw: string
  pdf_text: string
  notes: string
  prompt_profile_id: string | null
  output_type: string
  extra_instructions: string
  prompt_text: string
  script_versions: ScriptVersion[]
  active_script_id: string | null
  study: StudyState
}

export interface Week {
  id: string
  name: string
  description: string
  tags: string[]
  clips: Clip[]
}

export interface Subject {
  name: string
  storage_name: string
  weeks: Week[]
}

export interface Library {
  subjects: Subject[]
  profiles: ProfessorProfile[]
}

export interface Settings {
  api_key: string
  audio_dir: string
  default_voice: string
  default_text_model: string
}
