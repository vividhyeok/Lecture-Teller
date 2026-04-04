import { useEffect, useState } from 'react'
import { generateTts } from '../../api/library'
import { useStore, VOICES } from '../../store/useStore'
import { StudyWorkbench } from './StudyWorkbench'

export function PlayerPanel({ toast }: { toast: (message: string, type?: 'info' | 'error') => void }) {
  const { selectedSubject, selectedWeek, selectedClip, setLibrary, settings } = useStore()
  const subject = selectedSubject()
  const week = selectedWeek()
  const file = selectedClip()

  const [draftScriptText, setDraftScriptText] = useState('')
  const [voice, setVoice] = useState(settings.default_voice || 'alloy')
  const [generatingTts, setGeneratingTts] = useState(false)
  const [forceEditMode, setForceEditMode] = useState(false)

  // Reset when file changes
  useEffect(() => {
    if (!file) return
    const fallbackText = file.script_versions.at(-1)?.text || file.text || ''
    setDraftScriptText(fallbackText)
    setVoice(file.voice || settings.default_voice || 'alloy')
    setForceEditMode(false)
  }, [file?.id, settings.default_voice]) // Rely on semantic file.id change

  const handleGenerateTts = async () => {
    if (!subject || !week || !file) return
    if (!draftScriptText.trim()) {
      toast('TTS로 만들 코어 대본을 붙여넣어 주세요.', 'error')
      return
    }
    setGeneratingTts(true)
    try {
      // Pass null for scriptVersionId so backend just creates a new script version and links it.
      const response = await generateTts(subject.name, week.id, file.id, draftScriptText, voice, null)
      setLibrary(response.library)
      setForceEditMode(false)
      toast('TTS 생성을 완료했습니다. 바로 학습하세요!')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setGeneratingTts(false)
    }
  }

  if (!subject || !week || !file) {
    return (
      <div className="panel active" style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 400 }}>
        <div className="empty-state">
          <div>
            <strong style={{ fontSize: '1.2rem' }}>파일을 선택해주세요.</strong>
          </div>
        </div>
      </div>
    )
  }

  const hasAudio = Boolean(file.audio_path)
  const isEditing = !hasAudio || forceEditMode

  return (
    <div className="panel active" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 64 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.5px', color: 'var(--text-100)' }}>{file.title}</h1>
          <div style={{ color: 'var(--subtle)', fontSize: '0.95rem' }}>
            {subject.name} / {week.name}
          </div>
        </div>
        
        {hasAudio && !isEditing && (
          <button className="soft-btn" type="button" onClick={() => setForceEditMode(true)}>
            대본 텍스트 다시 편집하기
          </button>
        )}
      </header>

      {isEditing ? (
        <section className="glassmorphism" style={{ display: 'grid', gap: 20, padding: 32, borderRadius: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h2 style={{ margin: '0 0 8px 0', fontSize: '1.3rem', fontWeight: 600, color: 'var(--text-100)' }}>대본 입력 및 TTS 변환</h2>
              <p style={{ margin: 0, color: 'var(--subtle)', fontSize: '0.9rem' }}>정리된 강의 스크립를 붙여넣고 TTS를 만들기만 하세요. 앱이 자동으로 문장 단위 네비게이션을 만들어 줍니다.</p>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.95rem' }}>
                <span style={{ color: 'var(--subtle)' }}>Voice:</span>
                <select className="voice-select" value={voice} onChange={e => setVoice(e.target.value)} style={{ padding: '8px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {VOICES.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <button className="primary-btn" type="button" onClick={handleGenerateTts} disabled={generatingTts} style={{ padding: '10px 24px', fontSize: '1rem', letterSpacing: '0.5px' }}>
                {generatingTts ? '합성 중...' : 'TTS 생성하기'}
              </button>
              {hasAudio && forceEditMode && (
                <button className="soft-btn" type="button" onClick={() => setForceEditMode(false)} style={{ padding: '10px 16px' }}>
                  취소
                </button>
              )}
            </div>
          </div>
          
          <textarea 
            value={draftScriptText} 
            onChange={e => setDraftScriptText(e.target.value)} 
            rows={24} 
            className="quick-compose-text" 
            placeholder="강의 대본, 요약 정리 등을 붙여넣으세요..."
            style={{ 
              fontSize: '1.05rem', 
              lineHeight: 1.8, 
              padding: 24, 
              borderRadius: 16,
              background: 'rgba(5, 8, 15, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.2)',
              color: 'var(--text-100)',
              resize: 'vertical'
            }}
          />
        </section>
      ) : (
        <StudyWorkbench
          file={file}
          selectedVersion={file.script_versions.at(-1) || null}
          selectedVersionId={file.active_script_id || file.script_versions.at(-1)?.id || null}
          onSelectVersion={() => {}} // Remove version-switching clutter for simplicity
          voice={voice}
          draftScriptText={draftScriptText}
          transcriptRaw={''}
          toast={toast}
        />
      )}
    </div>
  )
}
