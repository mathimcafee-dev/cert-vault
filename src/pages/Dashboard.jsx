import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function daysUntil(str) {
  const m = str?.match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return null
  const [,dd,mm,yyyy] = m
  const d = new Date(`${yyyy}-${mm}-${dd}`); const t = new Date(); t.setHours(0,0,0,0)
  return Math.ceil((d - t) / 86400000)
}
function fmtDate(str) {
  const m = str?.match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return str||'—'
  const [,dd,mm,yyyy] = m
  return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mm)-1]} ${yyyy}`
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function useCounter(target, duration = 900) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!target) { setVal(0); return }
    const start = Date.now()
    const tick = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / duration)
      setVal(Math.floor(easeOutCubic(p) * target))
      if (p >= 1) clearInterval(tick)
    }, 16)
    return () => clearInterval(tick)
  }, [target])
  return val
}

function DonutRing({ critical, warning, healthy, total }) {
  const r = 52, C = 2 * Math.PI * r
  const critPct  = total ? critical / total : 0
  const warnPct  = total ? warning  / total : 0
  const hlthPct  = total ? healthy  / total : 0
  const critLen  = critPct * C
  const warnLen  = warnPct * C
  const hlthLen  = hlthPct * C
  return (
    <svg width="130" height="130" viewBox="0 0 130 130">
      <circle cx="65" cy="65" r={r} fill="none" stroke="#1e293b" strokeWidth="18"/>
      {total === 0 && <circle cx="65" cy="65" r={r} fill="none" stroke="#334155" strokeWidth="18"/>}
      {total > 0 && <>
        <circle cx="65" cy="65" r={r} fill="none" stroke="#10b981" strokeWidth="18"
          strokeDasharray={`${hlthLen} ${C}`}
          strokeDashoffset={-(critLen + warnLen)}
          transform="rotate(-90 65 65)" style={{ transition: 'stroke-dasharray .6s ease' }}/>
        <circle cx="65" cy="65" r={r} fill="none" stroke="#f59e0b" strokeWidth="18"
          strokeDasharray={`${warnLen} ${C}`}
          strokeDashoffset={-critLen}
          transform="rotate(-90 65 65)" style={{ transition: 'stroke-dasharray .6s ease' }}/>
        <circle cx="65" cy="65" r={r} fill="none" stroke="#ef4444" strokeWidth="18"
          strokeDasharray={`${critLen} ${C}`}
          strokeDashoffset={0}
          transform="rotate(-90 65 65)" style={{ transition: 'stroke-dasharray .6s ease' }}/>
      </>}
      <text x="65" y="60" textAnchor="middle" fill="#f1f5f9" fontSize="22" fontWeight="800" fontFamily="inherit">{total}</text>
      <text x="65" y="76" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600" fontFamily="inherit" letterSpacing="1">TOTAL</text>
    </svg>
  )
}

export default function Dashboard({ user, setPage, csrs }) {
  const [inventory, setInventory] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('All')
  const [search,    setSearch]    = useState('')
  const [time,      setTime]      = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!user?.id) return
    supabase.from('certificate_inventory').select('*').eq('user_id', user.id).order('cert_expiry', { ascending: true })
      .then(({ data }) => { if (data) setInventory(data); setLoading(false) })
  }, [user])

  const reissue  = inventory.filter(r => r.alert_type === 'reissue')
  const renew    = inventory.filter(r => r.alert_type === 'renew')
  const critical = inventory.filter(r => { const d = daysUntil(r.cert_expiry); return d !== null && d <= 30 })
  const warning  = inventory.filter(r => { const d = daysUntil(r.cert_expiry); return d !== null && d > 30 && d <= 90 })
  const healthy  = inventory.filter(r => { const d = daysUntil(r.cert_expiry); return d !== null && d > 90 })
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - critical.length * 14 - warning.length * 3)))

  const cTotal  = useCounter(inventory.length)
  const cReiss  = useCounter(reissue.length)
  const cRenew  = useCounter(renew.length)
  const cCsrs   = useCounter(csrs?.length || 0)
  const cScore  = useCounter(healthScore)

  const hour = time.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const name = user?.email?.split('@')[0] || 'there'
  const scoreColor = healthScore >= 75 ? '#10b981' : healthScore >= 50 ? '#f59e0b' : '#ef4444'
  const today = time.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const clock = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const filtered = inventory.filter(r => {
    const mF = filter === 'All' ? true : filter === 'Reissue' ? r.alert_type === 'reissue' : r.alert_type === 'renew'
    const mS = !search || r.domain_name?.toLowerCase().includes(search.toLowerCase()) || r.order_id?.includes(search)
    return mF && mS
  })

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#0f172a' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #1e3a5f', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin .7s linear infinite' }}/>
      <span style={{ color: '#475569', fontSize: 13, fontWeight: 500 }}>Loading dashboard…</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const buckets = [
    { label: '0 – 30 d',  count: critical.length,              color: '#ef4444', track: '#7f1d1d' },
    { label: '31 – 90 d', count: warning.length,               color: '#f59e0b', track: '#78350f' },
    { label: '91 – 180 d',count: healthy.filter(r => daysUntil(r.cert_expiry) <= 180).length, color: '#34d399', track: '#064e3b' },
    { label: '180 d +',   count: healthy.filter(r => daysUntil(r.cert_expiry) > 180).length,  color: '#38bdf8', track: '#0c4a6e' },
  ]
  const maxBucket = Math.max(...buckets.map(b => b.count), 1)

  const topUrgent = [...inventory]
    .filter(r => daysUntil(r.cert_expiry) !== null)
    .sort((a, b) => daysUntil(a.cert_expiry) - daysUntil(b.cert_expiry))
    .slice(0, 5)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f1f5f9', fontFamily: 'inherit' }}>

      {/* ── DARK HERO ── */}
      <div style={{ background: 'linear-gradient(135deg,#0f172a 0%,#0c2d4a 60%,#0c3d56 100%)', flexShrink: 0, padding: '28px 32px 0', position: 'relative', overflow: 'hidden' }}>
        {/* subtle grid pattern */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(56,189,248,.07) 1px, transparent 0)', backgroundSize: '28px 28px', pointerEvents: 'none' }}/>

        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, position: 'relative' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.04em', marginBottom: 6 }}>
              {greeting}, <span style={{ color: '#38bdf8' }}>{name}</span> 👋
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>
              <span>{today}</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#334155' }}/>
              <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700, letterSpacing: '0.04em' }}>{clock}</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#334155' }}/>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: critical.length ? '#ef4444' : '#10b981', boxShadow: `0 0 6px ${critical.length ? '#ef4444' : '#10b981'}`, animation: 'glow 2s infinite' }}/>
                <span style={{ color: critical.length ? '#fca5a5' : '#86efac' }}>{critical.length ? `${critical.length} critical alert${critical.length > 1 ? 's' : ''}` : 'All systems healthy'}</span>
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setPage('inventory')}
              style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(255,255,255,.07)', fontSize: 12.5, fontWeight: 600, color: '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s', backdropFilter: 'blur(8px)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.14)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,.5)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.07)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,.25)' }}>
              ↑ Upload CSV
            </button>
            <button onClick={() => setPage('generate')}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#0891b2,#0369a1)', fontSize: 12.5, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(8,145,178,.45)', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 7 }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 24px rgba(8,145,178,.65)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(8,145,178,.45)'; e.currentTarget.style.transform = 'translateY(0)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>
              Generate CSR
            </button>
          </div>
        </div>

        {/* KPI CARDS – glassmorphism */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, position: 'relative' }}>
          {[
            { label: 'Total Certs',    val: cTotal,  raw: inventory.length, sub: 'in inventory',      accent: '#38bdf8', glow: 'rgba(56,189,248,.18)',  icon: '🔒' },
            { label: 'Reissue Alerts', val: cReiss,  raw: reissue.length,   sub: 'need reissue',      accent: '#f87171', glow: 'rgba(248,113,113,.18)', icon: '⚠️' },
            { label: 'Renew Alerts',   val: cRenew,  raw: renew.length,     sub: 'need renewal',      accent: '#fb923c', glow: 'rgba(251,146,60,.18)',  icon: '🔄' },
            { label: 'CSR Registry',   val: cCsrs,   raw: csrs?.length||0,  sub: 'signing requests',  accent: '#34d399', glow: 'rgba(52,211,153,.18)',  icon: '🔑' },
            { label: 'Health Score',   val: cScore,  raw: healthScore,      sub: healthScore >= 75 ? 'Excellent' : healthScore >= 50 ? 'Fair' : 'Critical', accent: scoreColor, glow: `rgba(0,0,0,.1)`, icon: '📊', suffix: '/100' },
          ].map(c => (
            <div key={c.label}
              style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', backdropFilter: 'blur(12px)', borderRadius: 14, padding: '20px 20px 18px', cursor: 'pointer', transition: 'all .2s', position: 'relative', overflow: 'hidden' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.1)'; e.currentTarget.style.boxShadow = `0 8px 32px ${c.glow}` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2.5, background: `linear-gradient(90deg,${c.accent},${c.accent}60)`, borderRadius: '14px 14px 0 0' }}/>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{c.label}</span>
                <span style={{ fontSize: 16 }}>{c.icon}</span>
              </div>
              <div style={{ fontSize: 40, fontWeight: 900, color: c.accent, letterSpacing: '-0.05em', lineHeight: 1, marginBottom: 8 }}>
                {c.val}{c.suffix||''}
              </div>
              <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* bottom fade */}
        <div style={{ height: 28, marginLeft: -32, marginRight: -32, marginTop: 20, background: 'linear-gradient(to bottom,transparent,#f1f5f9)' }}/>
      </div>

      {/* ── ANALYTICS ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr', gap: 14, padding: '0 28px 16px', flexShrink: 0 }}>

        {/* Expiry Buckets */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Expiry Timeline</span>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{inventory.length} certs</span>
          </div>
          {buckets.map(b => (
            <div key={b.label} style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{b.label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: b.color }}>{b.count}</span>
              </div>
              <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(b.count / maxBucket) * 100}%`, background: b.color, borderRadius: 99, transition: 'width .6s cubic-bezier(.34,1.56,.64,1)', boxShadow: `0 0 8px ${b.color}60` }}/>
              </div>
            </div>
          ))}
        </div>

        {/* Donut Chart */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,.15)', display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>Certificate Health</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flex: 1 }}>
            <DonutRing critical={critical.length} warning={warning.length} healthy={healthy.length} total={inventory.length}/>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Critical', count: critical.length, color: '#ef4444' },
                { label: 'Warning',  count: warning.length,  color: '#f59e0b' },
                { label: 'Healthy',  count: healthy.length,  color: '#10b981' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, boxShadow: `0 0 6px ${s.color}80`, flexShrink: 0 }}/>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500, minWidth: 52 }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9', marginLeft: 'auto' }}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Urgent */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,.06)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Action Required</span>
            <button onClick={() => setPage('inventory')} style={{ fontSize: 11, color: '#0891b2', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View all →</button>
          </div>
          {topUrgent.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>🎉 No urgent certificates</div>
          ) : topUrgent.map((r, i) => {
            const d = daysUntil(r.cert_expiry)
            const hot = d !== null && d <= 30
            const warm = d !== null && d > 30 && d <= 90
            const bg = hot ? '#fef2f2' : warm ? '#fff7ed' : '#f0fdf4'
            const border = hot ? '#fecaca' : warm ? '#fed7aa' : '#bbf7d0'
            const dc = hot ? '#dc2626' : warm ? '#b45309' : '#059669'
            return (
              <div key={r.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, background: bg, border: `1px solid ${border}`, marginBottom: 7, cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(.97)'}
                onMouseLeave={e => e.currentTarget.style.filter = 'none'}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.domain_name}</div>
                  <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 2, fontWeight: 500 }}>{fmtDate(r.cert_expiry)}</div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: dc, letterSpacing: '-0.04em', lineHeight: 1 }}>{d !== null ? `${d}d` : '—'}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: dc, textTransform: 'uppercase', marginTop: 2 }}>{hot ? 'Critical' : warm ? 'Warning' : 'OK'}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── INVENTORY TABLE ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0 28px 24px' }}>
        {/* toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em', flex: 1 }}>Certificate Inventory</span>
          <div style={{ display: 'flex', gap: 2, background: '#e2e8f0', borderRadius: 8, padding: 3 }}>
            {['All', 'Reissue', 'Renew'].map(t => (
              <button key={t} onClick={() => setFilter(t)}
                style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: filter === t ? 700 : 500, color: filter === t ? '#0f172a' : '#64748b', background: filter === t ? '#fff' : 'transparent', border: 'none', cursor: 'pointer', boxShadow: filter === t ? '0 1px 4px rgba(0,0,0,.1)' : 'none', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all .12s' }}>
                {t}&nbsp;<span style={{ opacity: .7 }}>{t === 'All' ? inventory.length : t === 'Reissue' ? reissue.length : renew.length}</span>
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search domain or order ID…"
            style={{ height: 34, padding: '0 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, background: '#fff', color: '#0f172a', outline: 'none', width: 200, fontFamily: 'inherit', transition: 'border-color .15s', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}
            onFocus={e => e.target.style.borderColor = '#0891b2'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}/>
        </div>

        <div style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
          {/* header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 130px 70px 110px 110px', padding: '11px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
            {['Domain', 'Alert', 'Expires', 'Days', 'Health', 'Status'].map(h => (
              <span key={h} style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
            ))}
          </div>
          {/* rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '60px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>{inventory.length === 0 ? '📦' : '🔍'}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>{inventory.length === 0 ? 'Upload a CSV to populate your inventory' : 'No records match your search'}</div>
              </div>
            )}
            {filtered.map((row, i) => {
              const days = daysUntil(row.cert_expiry)
              const hot  = days !== null && days <= 30
              const warm = days !== null && days > 30 && days <= 90
              const dc   = hot ? '#dc2626' : warm ? '#b45309' : '#059669'
              const isR  = row.alert_type === 'reissue'
              const healthPct = hot ? 15 : warm ? 45 : 85
              return (
                <div key={row.id || i}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 100px 130px 70px 110px 110px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', cursor: 'pointer', transition: 'background .1s', borderLeft: '3px solid transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderLeftColor = dc }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderLeftColor = 'transparent' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>{row.domain_name}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, fontFamily: 'monospace', fontWeight: 600 }}>#{row.order_id}</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: isR ? '#fef2f2' : '#fff7ed', color: isR ? '#b91c1c' : '#92400e', whiteSpace: 'nowrap', width: 'fit-content' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: isR ? '#ef4444' : '#f59e0b', flexShrink: 0 }}/>
                    {isR ? 'Reissue' : 'Renew'}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: dc, letterSpacing: '-0.01em' }}>{fmtDate(row.cert_expiry)}</span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: dc, letterSpacing: '-0.04em' }}>{days !== null ? `${days}d` : '—'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${healthPct}%`, background: dc, borderRadius: 99 }}/>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: dc, minWidth: 26, textAlign: 'right' }}>{healthPct}%</span>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: dc }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: dc, animation: hot ? 'glow 1.5s infinite' : 'none' }}/>
                    {hot ? 'Critical' : warm ? 'Warning' : 'Healthy'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg) } }
        @keyframes glow  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.85)} }
      `}</style>
    </div>
  )
}
