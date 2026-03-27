import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function AuthPage({ onAuth }) {
  const [mode, setMode]       = useState('login')
  const [form, setForm]       = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      if (mode === 'signup') {
        if (!form.name.trim())              return setError('Full name is required.')
        if (form.password.length < 8)      return setError('Password must be at least 8 characters.')
        if (form.password !== form.confirm) return setError('Passwords do not match.')
        const { data, error: err } = await supabase.auth.signUp({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          options: { data: { full_name: form.name.trim() } },
        })
        if (err) return setError(err.message)
        if (data.user) {
          await supabase.from('profiles').upsert({ id: data.user.id, full_name: form.name.trim() })
        }
        onAuth(data.user, data.session)
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({
          email: form.email.trim().toLowerCase(), password: form.password,
        })
        if (err) return setError('Invalid email or password.')
        onAuth(data.user, data.session)
      }
    } catch { setError('Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 38, height: 38, background: '#4f46e5', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L3 6v4c0 4.418 3.134 8.555 7 9.95C13.866 18.555 17 14.418 17 10V6L10 2z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M7 10l2.5 2.5L14 8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ fontSize: 24, fontWeight: 600, color: '#1e1b4b', letterSpacing: '-0.03em' }}>CertVault</span>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280' }}>CSR &amp; Private Key Management</p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: '32px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {['login','signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError('') }} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: mode === m ? '#fff' : 'transparent', color: mode === m ? '#1e1b4b' : '#6b7280', boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'signup' && <Field label="Full Name" type="text" value={form.name} onChange={f('name')} placeholder="John Doe" />}
            <Field label="Email Address" type="email" value={form.email} onChange={f('email')} placeholder="you@example.com" />
            <Field label="Password" type="password" value={form.password} onChange={f('password')} placeholder="••••••••" />
            {mode === 'signup' && <Field label="Confirm Password" type="password" value={form.confirm} onChange={f('confirm')} placeholder="••••••••" />}
            {error && <div style={{ fontSize: 12.5, color: '#dc2626', background: '#fef2f2', padding: '9px 12px', borderRadius: 8, border: '1px solid #fca5a5' }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ marginTop: 4, padding: '11px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.75 : 1 }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 5 }}>{label}</label>
      <input {...props} required onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ width: '100%', padding: '9px 12px', border: `1px solid ${focused ? '#4f46e5' : '#d1d5db'}`, borderRadius: 8, fontSize: 13.5, color: '#111827', outline: 'none', boxShadow: focused ? '0 0 0 3px rgba(79,70,229,0.12)' : 'none', transition: 'all 0.15s', background: '#fff' }} />
    </div>
  )
}
