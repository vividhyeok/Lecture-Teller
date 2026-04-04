import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

export function useKeyboard() {
  const kbdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showKbdToast = (text: string) => {
    let bubble = document.getElementById('kbdToast')
    if (!bubble) {
      bubble = document.createElement('div')
      bubble.id = 'kbdToast'
      bubble.className = 'kbd-toast'
      document.body.appendChild(bubble)
    }
    bubble.textContent = text
    bubble.classList.add('show')
    if (kbdTimerRef.current) clearTimeout(kbdTimerRef.current)
    kbdTimerRef.current = setTimeout(() => bubble!.classList.remove('show'), 900)
  }

  const getAudio = (): HTMLAudioElement | null => {
    return document.querySelector('#panel-player audio') as HTMLAudioElement | null
  }

  const handleSentenceJump = useCallback((audio: HTMLAudioElement, direction: -1 | 1) => {
    const clip = useStore.getState().selectedClip()
    if (!clip || !clip.sentences || clip.sentences.length === 0) return

    const currentTime = audio.currentTime
    const sentences = clip.sentences

    if (direction === 1) {
      const nextSentence = sentences.find(s => s.start > currentTime + 0.5)
      if (nextSentence) {
        audio.currentTime = nextSentence.start
        showKbdToast('다음 문장')
      }
    } else {
      const currentIndex = sentences.findIndex(s => currentTime >= s.start && currentTime < s.end)
      if (currentIndex !== -1) {
        const currentSentence = sentences[currentIndex]
        if (currentTime - currentSentence.start > 2.0) {
          audio.currentTime = currentSentence.start
          showKbdToast('현재 문장 처음')
        } else if (currentIndex > 0) {
          audio.currentTime = sentences[currentIndex - 1].start
          showKbdToast('이전 문장')
        } else {
          audio.currentTime = 0
          showKbdToast('처음으로')
        }
      } else {
        audio.currentTime = Math.max(0, audio.currentTime - 5)
        showKbdToast('-5초')
      }
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (document.querySelector('.overlay.show')) return
      const audio = getAudio()

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          if (!audio) return
          e.preventDefault()
          if (audio.paused) { audio.play().catch(() => {}); showKbdToast('재생') }
          else { audio.pause(); showKbdToast('일시정지') }
          break
        case 'ArrowLeft':
          if (!audio) return
          e.preventDefault()
          if (e.shiftKey) {
            audio.currentTime = Math.max(0, audio.currentTime - 5)
            showKbdToast('-5초')
          } else {
            audio.currentTime = Math.max(0, audio.currentTime - 10)
            showKbdToast('-10초')
          }
          break
        case 'ArrowRight':
          if (!audio) return
          e.preventDefault()
          if (e.shiftKey) {
            audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5)
            showKbdToast('+5초')
          } else {
            audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10)
            showKbdToast('+10초')
          }
          break
        case 'ArrowUp':
          if (!audio) return
          e.preventDefault()
          if (e.shiftKey) {
            audio.playbackRate = Math.min(3.0, audio.playbackRate + 0.25)
            showKbdToast(`배속 ${audio.playbackRate}x`)
          } else {
            audio.volume = Math.min(1, +(audio.volume + 0.1).toFixed(1))
            showKbdToast(`볼륨 ${Math.round(audio.volume * 100)}%`)
          }
          break
        case 'ArrowDown':
          if (!audio) return
          e.preventDefault()
          if (e.shiftKey) {
            audio.playbackRate = Math.max(0.25, audio.playbackRate - 0.25)
            showKbdToast(`배속 ${audio.playbackRate}x`)
          } else {
            audio.volume = Math.max(0, +(audio.volume - 0.1).toFixed(1))
            showKbdToast(`볼륨 ${Math.round(audio.volume * 100)}%`)
          }
          break
        case '0':
          if (!audio) return
          e.preventDefault()
          audio.playbackRate = 1.0
          showKbdToast(`배속 1.0x`)
          break
        case 'm':
        case 'M':
          if (!audio) return
          audio.muted = !audio.muted
          showKbdToast(audio.muted ? '음소거' : '음소거 해제')
          break
        case '[':
          if (!audio) return
          e.preventDefault()
          handleSentenceJump(audio, -1)
          break
        case ']':
          if (!audio) return
          e.preventDefault()
          handleSentenceJump(audio, 1)
          break
        case 'n':
        case 'N':
          if (e.shiftKey) {
            e.preventDefault()
            const store = useStore.getState()
            store.playNextClip()
            showKbdToast('다음 파일')
          }
          break
        case 'p':
        case 'P':
          if (e.shiftKey) {
            e.preventDefault()
            const store = useStore.getState()
            store.playPrevClip()
            showKbdToast('이전 파일')
          }
          break

        case 'b':
        case 'B':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:addBookmark'))
          showKbdToast('핵심 북마크')
          break
        case 'h':
        case 'H':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:addHardBookmark'))
          showKbdToast('헷갈림 북마크')
          break
        case 'f':
        case 'F':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:addMemoryBookmark'))
          showKbdToast('암기 포인트')
          break
        case 'l':
        case 'L':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:toggleLoopCurrent'))
          showKbdToast('현재 문장 반복')
          break
        case 'r':
        case 'R':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:toggleHardQueue'))
          showKbdToast('헷갈림 큐')
          break
        case '1':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:viewSync'))
          showKbdToast('싱크 뷰')
          break
        case '2':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:viewSummary'))
          showKbdToast('요약 뷰')
          break
        case '3':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:viewFocus'))
          showKbdToast('집중 뷰')
          break
        case '4':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kbd:viewBlind'))
          showKbdToast('블라인드 뷰')
          break
        case '+':
        case '=': {
          e.preventDefault()
          const store = useStore.getState()
          const next = Math.min(200, store.fontScale + 10)
          store.setFontScale(next)
          showKbdToast(`글자 확대 ${next}%`)
          break
        }
        case '-':
        case '_': {
          e.preventDefault()
          const store = useStore.getState()
          const next = Math.max(60, store.fontScale - 10)
          store.setFontScale(next)
          showKbdToast(`글자 축소 ${next}%`)
          break
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleSentenceJump])
}
