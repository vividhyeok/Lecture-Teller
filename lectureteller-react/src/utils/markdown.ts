import type { Sentence } from '../types'

// Sanitize TTS script — port of the vanilla JS sanitizeMarkdown
export function sanitizeMarkdown(text: string): string {
  let v = (text ?? '').replace(/\r\n/g, '\n')
  v = v.replace(/```[^\n]*\n?/g, '').replace(/```/g, '')
  v = v.replace(/`([^`]+)`/g, '$1')
  v = v.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  v = v.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  v = v.replace(/^\s{0,3}#{1,6}\s*/gm, '')
  v = v.replace(/^\s{0,3}>\s?/gm, '')
  v = v.replace(/^\s*[-*+]\s+/gm, '')
  v = v.replace(/^\s*\d+\.\s+/gm, '')
  v = v.replace(/^\s*([-*_]\s*){3,}$/gm, '')
  v = v.replace(/\*\*([^*]+)\*\*/g, '$1')
  v = v.replace(/__([^_]+)__/g, '$1')
  v = v.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
  v = v.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
  v = v.replace(/~~([^~]+)~~/g, '$1')
  v = v.replace(/\n{3,}/g, '\n\n')
  return v.trim()
}

// Light markdown → HTML for the floating player script view
export function parseMarkdownForView(text: string): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const splitBySentence = (line: string): string[] => {
    const trimmed = line.trim()
    if (!trimmed) return []
    const parts = trimmed.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(Boolean)
    if (parts.length > 1) return parts
    if (trimmed.length > 160) {
      return trimmed.split(/\s+/).reduce<string[]>((acc, word) => {
        if (!acc.length) return [word]
        const last = acc[acc.length - 1]
        if ((last + ' ' + word).length > 70) acc.push(word)
        else acc[acc.length - 1] = `${last} ${word}`
        return acc
      }, [])
    }
    return [trimmed]
  }

  const blocks = escaped
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)

  if (!blocks.length) return ''

  return blocks
    .map(block => {
      const lines = block
        .split('\n')
        .flatMap(splitBySentence)
      return `<div class="script-block">${lines.map(line => `<p class="script-line">${line}</p>`).join('')}</div>`
    })
    .join('')
}

export function estimateChunks(text: string, max = 900): number {
  if (text.length <= max) return 1
  return Math.ceil(text.length / max) + 1
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '없음'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

export interface SynopsisPoint {
  text: string
  start: number
  end: number
}

export interface SynopsisSection {
  id: string
  title: string
  start: number
  end: number
  points: SynopsisPoint[]
}

function compactText(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function titleFromText(input: string): string {
  const cleaned = compactText(input).replace(/^[-*•\d.\s]+/, '')
  if (!cleaned) return '핵심 내용'
  return cleaned.length > 30 ? `${cleaned.slice(0, 30)}...` : cleaned
}

function pseudoPointsFromRawText(rawText: string): SynopsisPoint[] {
  const chunks = rawText
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map(compactText)
    .filter(Boolean)
  if (!chunks.length) return []
  return chunks.map(text => ({ text, start: 0, end: 0 }))
}

export function buildSynopsisFromTranscript(rawText: string, sentences: Sentence[]): SynopsisSection[] {
  const points: SynopsisPoint[] = (sentences ?? [])
    .map(s => ({ text: compactText(s.text || ''), start: Number(s.start || 0), end: Number(s.end || 0) }))
    .filter(p => p.text.length > 0)

  const sourcePoints = points.length > 0 ? points : pseudoPointsFromRawText(rawText)
  if (!sourcePoints.length) return []

  const sectionCount = Math.max(2, Math.min(6, Math.round(Math.sqrt(sourcePoints.length))))
  const groupSize = Math.max(1, Math.ceil(sourcePoints.length / sectionCount))
  const sections: SynopsisSection[] = []

  for (let i = 0; i < sourcePoints.length; i += groupSize) {
    const group = sourcePoints.slice(i, i + groupSize)
    const first = group[0]
    const last = group[group.length - 1]
    sections.push({
      id: `sec-${sections.length + 1}`,
      title: `섹션 ${sections.length + 1}. ${titleFromText(first.text)}`,
      start: first.start,
      end: last.end,
      points: group,
    })
  }

  return sections
}
