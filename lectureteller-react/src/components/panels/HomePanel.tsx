import { useMemo, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import { formatDate } from '../../utils/markdown'

interface FileEntry {
  subjectName: string
  weekId: string
  weekName: string
  fileId: string
  fileTitle: string
  subjectStorage: string
  createdAt: string | null
  hasAudio: boolean
  hasScript: boolean
  hasSource: boolean
}

function sortByRecent(left: FileEntry, right: FileEntry): number {
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0
  return rightTime - leftTime
}

function statusText(file: FileEntry): string {
  if (!file.hasAudio) return 'TTS 대기 중'
  return '학습 중'
}

function HomeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="glassmorphism"
      style={{
        display: 'grid',
        gap: 14,
        padding: 24,
        borderRadius: 24,
      }}
    >
      <strong style={{ fontSize: '1.1rem', color: 'var(--text-100)', letterSpacing: '-0.3px' }}>{title}</strong>
      {children}
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        padding: '24px 20px',
        borderRadius: 20,
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      }}
    >
      <span style={{ color: 'var(--subtle)', fontSize: '0.85rem', fontWeight: 500 }}>{label}</span>
      <strong style={{ fontSize: '1.8rem', color: 'var(--text-100)', letterSpacing: '-0.5px' }}>{value}</strong>
    </div>
  )
}

export function HomePanel({
  openFile,
}: {
  openFile: (subjectName: string, weekId: string, fileId: string) => void
}) {
  const library = useStore(state => state.library)

  const files = useMemo<FileEntry[]>(
    () =>
      library.subjects.flatMap(subject =>
        subject.weeks.flatMap(week =>
          week.clips.map(file => ({
            subjectName: subject.name,
            weekId: week.id,
            weekName: week.name,
            fileId: file.id,
            fileTitle: file.title,
            subjectStorage: subject.storage_name,
            createdAt: file.created_at,
            hasAudio: Boolean(file.audio_path),
            hasScript: Boolean(file.script_versions.length || file.text?.trim()),
            hasSource: Boolean(file.transcript_raw?.trim() || file.pdf_text?.trim() || file.notes?.trim()),
          })),
        ),
      ),
    [library],
  )

  const recentFiles = useMemo(() => files.filter(file => file.createdAt).sort(sortByRecent).slice(0, 6), [files])
  const readyFiles = useMemo(() => files.filter(file => file.hasAudio).sort(sortByRecent).slice(0, 6), [files])

  const renderFileList = (items: FileEntry[], emptyText: string) => {
    if (!items.length) {
      return <div className="quick-compose-notice" style={{ background: 'transparent', border: '1px dashed var(--line)' }}>{emptyText}</div>
    }

    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map(file => (
          <div
            key={`${file.weekId}-${file.fileId}`}
            className="modern-card hoverable"
            style={{
              display: 'grid',
              gap: 10,
              padding: 16,
              borderRadius: 16,
              background: 'rgba(255, 255, 255, 0.015)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              cursor: 'pointer'
            }}
            onClick={() => openFile(file.subjectName, file.weekId, file.fileId)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong style={{ fontSize: '1rem', color: 'var(--text-100)' }}>{file.fileTitle}</strong>
                <div style={{ color: 'var(--subtle)', fontSize: '0.85rem' }}>
                  {file.subjectName} / {file.weekName}
                </div>
              </div>
              <div className="context-chip accent" style={{ height: 'fit-content', padding: '4px 10px', fontSize: '0.75rem' }}>{statusText(file)}</div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
              마지막 수정: {formatDate(file.createdAt)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 1080, margin: '0 auto', paddingBottom: 60 }}>
      <HomeSection title="학습 진행 상황">
        <div style={{ color: 'var(--subtle)', lineHeight: 1.6, fontSize: '0.9rem', marginBottom: 8 }}>
          왼쪽 사이드바에서 파일을 생성하거나 수정하여 대본을 붙여넣고 곧바로 TTS를 생성하세요. 
        </div>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <StatCard label="총 파일 수" value={String(files.length)} />
          <StatCard label="학습 중인 노트" value={String(files.filter(file => file.hasAudio).length)} />
          <StatCard label="과목" value={String(library.subjects.length)} />
        </div>
      </HomeSection>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <HomeSection title="학습 중인 파일">
          {renderFileList(readyFiles, 'TTS 생성이 완료된 파일이 없습니다. 대본을 추가하고 TTS를 만들어보세요.')}
        </HomeSection>

        <HomeSection title="최근 작업">
          {renderFileList(recentFiles, '최근에 열어본 파일이 없습니다.')}
        </HomeSection>
      </div>
    </div>
  )
}

