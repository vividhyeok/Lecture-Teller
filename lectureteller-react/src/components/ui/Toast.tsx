import type { ToastItem } from '../../hooks/useToast'
import styles from './Toast.module.css'

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className={styles.container}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${t.type === 'error' ? styles.error : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
