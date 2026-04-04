// Generic fetch wrapper — identical behaviour to existing vanilla JS api()
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) ?? {}) },
    ...options,
  })
  const ct = res.headers.get('content-type') ?? ''
  const data = ct.includes('application/json') ? await res.json() : null
  if (!res.ok) throw new Error((data?.detail as string | undefined) ?? '요청 처리에 실패했습니다.')
  return data as T
}
