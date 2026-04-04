import type { ActiveTab } from '../store/useStore'
import type { Clip, Library, Subject, Week } from '../types'

export interface FileRouteTarget {
  subject: Subject
  week: Week
  clip: Clip
}

type ParsedRoute =
  | { kind: 'home' }
  | { kind: 'file'; subjectStorage: string; weekId: string; clipId: string; tab?: ActiveTab }

const VALID_TABS: ActiveTab[] = ['explore', 'compose', 'player']

function decodePart(part: string | undefined): string {
  if (!part) return ''
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

export function buildHomePath(): string {
  return '/'
}

export function buildFilePath(subject: Subject, week: Week, clip: Clip, tab: ActiveTab): string {
  return `/subject/${encodeURIComponent(subject.storage_name)}/week/${encodeURIComponent(week.id)}/file/${encodeURIComponent(clip.id)}/${tab}`
}

export function parseAppPath(pathname: string): ParsedRoute {
  const parts = pathname.split('/').filter(Boolean).map(decodePart)

  if (!parts.length || (parts.length === 1 && parts[0] === 'home')) {
    return { kind: 'home' }
  }

  if (parts.length >= 6 && parts[0] === 'subject' && parts[2] === 'week' && parts[4] === 'file') {
    const tab = VALID_TABS.includes(parts[6] as ActiveTab) ? (parts[6] as ActiveTab) : undefined
    return {
      kind: 'file',
      subjectStorage: parts[1],
      weekId: parts[3],
      clipId: parts[5],
      tab,
    }
  }

  return { kind: 'home' }
}

export function resolveFileRouteTarget(library: Library, pathname: string): FileRouteTarget | null {
  const parsed = parseAppPath(pathname)
  if (parsed.kind !== 'file') return null

  for (const subject of library.subjects) {
    if (subject.storage_name !== parsed.subjectStorage) continue
    const week = subject.weeks.find(item => item.id === parsed.weekId)
    if (!week) return null
    const clip = week.clips.find(item => item.id === parsed.clipId)
    if (!clip) return null
    return { subject, week, clip }
  }

  return null
}
