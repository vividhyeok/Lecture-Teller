import { useState, useCallback } from 'react'

export interface ToastItem {
  id: number
  message: string
  type: 'info' | 'error'
}

let _counter = 0

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    const id = ++_counter
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200)
  }, [])

  return { toasts, toast }
}
