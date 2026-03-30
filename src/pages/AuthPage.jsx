import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function AuthPage({ onAuth, onBackToLanding }) {
  const [mode,    setMode]    = useState('login')
  const [form,    setForm]    = useState({ name:'', email:'', password:'', confirm:'' })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      if (mode === 'signup') {
        if (!form.name.trim())              { setError('Full name is required.'); return }
        if (form.password.length < 8)      { setError('Password must be at least 8 characters.'); return }
        if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
        const { data, error: err } = await supabase.auth.signUp({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          options: { data: { full_name: form.name.trim() } },
        })
        if (err) { setError(err.message); return }
        if (data?.user && !data?.session) { setSent(true); return }
        onAuth(data.user, data.session)
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        })
        if (err) { setError('Invalid email or password.'); return }
        onAuth(data.user, data.session)
      }
    } catch { setError('Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  if (sent) return (
    <div style={{ minHeight:'100vh', background:'#ecfeff', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'40px 36px', maxWidth:440, width:'100%', textAlign:'center', border:'1.5px solid #cffafe', boxShadow:'0 8px 32px rgba(8,145,178,.12)' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>📧</div>
        <h2 style={{ fontSize:20, fontWeight:800, color:'#083344', marginBottom:8, letterSpacing:'-.03em' }}>Check your email</h2>
        <p style={{ fontSize:13.5, color:'#67c5d4', lineHeight:1.6, marginBottom:24 }}>We sent a confirmation link to <b style={{ color:'#0891b2' }}>{form.email}</b>. Click the link to activate your account.</p>
        <button onClick={() => setSent(false)} style={{ padding:'10px 24px', background:'linear-gradient(135deg,#0891b2,#0e7490)', border:'none', borderRadius:9, fontSize:13, fontWeight:700, color:'#fff', cursor:'pointer', fontFamily:'inherit' }}>Back to sign in</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#f0fdff,#ecfeff)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:440 }}>

        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:10, marginBottom:8 }}>
            <div style={{ width:38, height:38, background:'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 12px rgba(8,145,178,.35)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 1.5L2.5 5.5v5c0 4.4 3.1 8.5 7 9.9 3.9-1.4 7-5.5 7-9.9v-5L10 1.5z" fill="#fff" opacity=".95"/><path d="M7 10.5l2.5 2.5L14 8" stroke="#0891b2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span style={{ fontSize:24, fontWeight:800, color:'#083344', letterSpacing:'-.04em' }}>EasySecurity</span>
          </div>
          <p style={{ fontSize:13, color:'#67c5d4' }}>{mode==='login'?'Welcome back — sign in to your dashboard':'Create your free account — no credit card required'}</p>
        </div>

        {/* Card */}
        <div style={{ background:'#fff', borderRadius:16, border:'1.5px solid #cffafe', padding:'32px', boxShadow:'0 8px 32px rgba(8,145,178,.12)' }}>

          {/* Tabs */}
          <div style={{ display:'flex', gap:3, background:'#f0fdff', borderRadius:10, padding:4, marginBottom:24, border:'1px solid #cffafe' }}>
            {[['login','Sign In'],['signup','Create Account']].map(([m,label]) => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                style={{ flex:1, padding:'8px 0', borderRadius:7, border:'none', fontSize:13, fontWeight:mode===m?700:500, cursor:'pointer', background:mode===m?'#0891b2':'transparent', color:mode===m?'#fff':'#67c5d4', fontFamily:'inherit', transition:'all .15s', boxShadow:mode===m?'0 2px 8px rgba(8,145,178,.3)':'none' }}>
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {mode==='signup' && <Field label="Full Name"    type="text"     value={form.name}     onChange={f('name')}     placeholder="Your full name"/>}
            <Field label="Email Address" type="email"    value={form.email}    onChange={f('email')}    placeholder="you@example.com"/>
            <Field label="Password"      type="password" value={form.password} onChange={f('password')} placeholder="••••••••"/>
            {mode==='signup' && <Field label="Confirm Password" type="password" value={form.confirm} onChange={f('confirm')} placeholder="••••••••"/>}

            {error && (
              <div style={{ fontSize:12.5, color:'#dc2626', background:'#fef2f2', padding:'9px 12px', borderRadius:8, border:'1px solid #fca5a5' }}>{error}</div>
            )}

            <button type="submit" disabled={loading}
              style={{ marginTop:4, padding:'12px', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:loading?'not-allowed':'pointer', opacity:loading?0.75:1, fontFamily:'inherit', boxShadow:'0 4px 12px rgba(8,145,178,.3)', letterSpacing:'-.01em' }}>
              {loading ? 'Please wait…' : mode==='login' ? 'Sign In →' : 'Create Account →'}
            </button>
          </form>

          {mode==='signup' && (
            <p style={{ fontSize:11.5, color:'#a5f3fc', textAlign:'center', marginTop:16, lineHeight:1.5 }}>
              By creating an account you agree to our Terms of Service and Privacy Policy.
            </p>
          )}
        </div>

        <div style={{ textAlign:'center', marginTop:18 }}>
          <button onClick={onBackToLanding} style={{ fontSize:12.5, color:'#67c5d4', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
            ← Back to easysecurity.in
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#0e7490', marginBottom:5, letterSpacing:'.01em' }}>{label}</label>
      <input {...props} required
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ width:'100%', padding:'10px 13px', border:`1.5px solid ${focused?'#0891b2':'#a5f3fc'}`, borderRadius:9, fontSize:13.5, color:'#083344', outline:'none', background:focused?'#f0fdff':'#fff', transition:'all .15s', fontFamily:'inherit', boxShadow:focused?'0 0 0 3px rgba(8,145,178,.1)':'none' }}/>
    </div>
  )
}
