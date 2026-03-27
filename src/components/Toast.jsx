import { useState, useCallback } from 'react'

export function useToast() {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, type = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])
  return { toasts, push }
}

export default function ToastContainer({ toasts }) {
  const colors = {
    ok:    { bg: '#f0fdf4', border: '#86efac', text: '#166534', dot: '#22c55e' },
    error: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', dot: '#ef4444' },
    warn:  { bg: '#fffbeb', border: '#fde68a', text: '#92400e', dot: '#f59e0b' },
  }
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map(t => {
        const c = colors[t.type] || colors.ok
        return (
          <div key={t.id} style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', maxWidth: 340, display: 'flex', alignItems: 'center', gap: 9, animation: 'toastIn 0.25s ease both' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
            {t.msg}
          </div>
        )
      })}
    </div>
  )
}
