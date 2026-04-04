import { useEffect, useState } from 'react'

export function useMobile(breakpoint = 860) {
  const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
  const [mobile, setMobile] = useState(mq.matches)
  useEffect(() => {
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mq])
  return mobile
}
