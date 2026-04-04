import { useEffect, useRef, useState } from 'react'
import { useStore, VOICES } from '../../store/useStore'
import { getSettings, previewVoice, saveSettings } from '../../api/library'
import type { Settings } from '../../types'

export function SettingsModal({ toast }: { toast: (m: string, t?: 'info' | 'error') => void }) {
  const { settingsModalOpen, closeSettingsModal, setSettings } = useStore()
  const [form, setForm] = useState<Settings>({
    api_key: '',
    audio_dir: '',
    default_voice: '',
    default_text_model: '',
  })
  const [playing, setPlaying] = useState(false)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!settingsModalOpen) return
    getSettings().then(setForm).catch(() => {})
  }, [settingsModalOpen])

  const handlePreview = async () => {
    if (!form.default_voice) {
      toast('미리듣기할 음성을 먼저 선택하세요.', 'error')
      return
    }
    if (playing) {
      previewAudioRef.current?.pause()
      setPlaying(false)
      return
    }
    try {
      setPlaying(true)
      const url = await previewVoice(form.default_voice)
      const audio = new Audio(url)
      previewAudioRef.current = audio
      audio.onended = () => {
        setPlaying(false)
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        setPlaying(false)
        toast('미리듣기에 실패했습니다.', 'error')
      }
      await audio.play()
    } catch (error) {
      setPlaying(false)
      toast((error as Error).message, 'error')
    }
  }

  const handleSave = async () => {
    try {
      const saved = await saveSettings(form)
      setSettings(saved)
      closeSettingsModal()
      toast('설정을 저장했습니다.')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  if (!settingsModalOpen) return null

  return (
    <div className="overlay show" role="dialog" aria-modal="true" onClick={closeSettingsModal}>
      <div className="overlay-card" onClick={event => event.stopPropagation()}>
        <div className="overlay-header">
          <strong>설정</strong>
          <button className="mini-btn" type="button" onClick={closeSettingsModal}>
            닫기
          </button>
        </div>
        <div className="overlay-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>OpenAI API Key</span>
            <input
              type="password"
              className="surface-input"
              placeholder="sk-..."
              value={form.api_key}
              onChange={event => setForm(current => ({ ...current, api_key: event.target.value }))}
              style={{
                padding: 12,
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: 'rgba(0,0,0,0.3)',
                color: 'white',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>기본 텍스트 모델</span>
            <input
              type="text"
              className="surface-input"
              placeholder="gpt-4o"
              value={form.default_text_model}
              onChange={event => setForm(current => ({ ...current, default_text_model: event.target.value }))}
              style={{
                padding: 12,
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: 'rgba(0,0,0,0.3)',
                color: 'white',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>기본 음성</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={form.default_voice}
                onChange={event => setForm(current => ({ ...current, default_voice: event.target.value }))}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                  background: 'rgba(0,0,0,0.3)',
                  color: 'white',
                  font: 'inherit',
                }}
              >
                <option value="">선택 안 함</option>
                {VOICES.map(voice => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
              <button className="soft-btn" type="button" onClick={handlePreview} style={{ padding: '0 16px', minHeight: 44 }}>
                {playing ? '정지' : '미리듣기'}
              </button>
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>오디오 저장 경로</span>
            <input
              type="text"
              className="surface-input"
              placeholder="C:\\LectureTeller\\audio"
              value={form.audio_dir}
              onChange={event => setForm(current => ({ ...current, audio_dir: event.target.value }))}
              style={{
                padding: 12,
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: 'rgba(0,0,0,0.3)',
                color: 'white',
              }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="primary-btn" type="button" onClick={handleSave} style={{ padding: '0 24px' }}>
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
