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

export default function Dashboard({ user, setPage, csrs }) {
  const [inventory, setInventory] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('All')
  const [search,    setSearch]    = useState('')
  const [time,      setTime]      = useState(new Date())

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Load inventory
  useEffect(() => {
    if (!user?.id) return
    supabase.from('certificate_inventory').select('*').eq('user_id',user.id).order('cert_expiry',{ascending:true})
      .then(({ data }) => { if (data) setInventory(data); setLoading(false) })
  }, [user])

  // Derived data
  const reissue = inventory.filter(r => r.alert_type==='reissue')
  const renew   = inventory.filter(r => r.alert_type==='renew')
  const urgent  = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d<=30 })
  const warning = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d>30&&d<=90 })
  const healthy = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d>90&&d<=180 })
  const stable  = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d>180 })
  const mostUrgent = urgent[0]

  // Health score (0-100)
  const healthScore = Math.max(0, Math.min(100, 100 - urgent.length*15 - warning.length*4))
  const healthColor = healthScore>=80?'#10b981':healthScore>=50?'#f59e0b':'#dc2626'
  const healthBg = healthScore>=80?'#ecfdf5':healthScore>=50?'#fff7ed':'#fef2f2'

  const hour = new Date().getHours()
  const greeting = hour<12?'Good morning':hour<17?'Good afternoon':'Good evening'
  const name = user?.email?.split('@')[0] || 'there'
  const today = time.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  const timeStr = time.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})

  const filtered = inventory.filter(r => {
    const mF = filter==='All'?true:filter==='Reissue'?r.alert_type==='reissue':r.alert_type==='renew'
    const mS = !search||r.domain_name?.toLowerCase().includes(search.toLowerCase())||r.order_id?.includes(search)
    return mF && mS
  })

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, background:'linear-gradient(135deg,#ecfeff,#f0fdff)' }}>
      <div style={{ width:36, height:36, border:'3px solid #cffafe', borderTopColor:'#0891b2', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <div style={{ fontSize:13, color:'#67c5d4' }}>Loading dashboard…</div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'linear-gradient(135deg,#ecfeff 0%,#f0fdff 100%)' }}>

      {/* HERO SECTION */}
      <div style={{ padding:'24px 28px 20px', flexShrink:0, background:'linear-gradient(135deg,#ffffff 0%,#f0fdff 100%)', borderBottom:'2px solid #cffafe', boxShadow:'0 4px 16px rgba(8,145,178,.08)' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:20 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:28, fontWeight:800, color:'#083344', letterSpacing:'-0.04em', marginBottom:6 }}>
              {greeting}, <span style={{ background:'linear-gradient(135deg,#0891b2,#06b6d4)', backgroundClip:'text', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>{name}</span> 👋
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:12, fontSize:13, color:'#67c5d4', fontWeight:500 }}>
              <span>{today}</span>
              <span style={{ width:4, height:4, borderRadius:'50%', background:'#a5f3fc' }}/>
              <span style={{ fontFamily:'monospace', color:'#0891b2', fontWeight:600 }}>{timeStr}</span>
              <span style={{ width:4, height:4, borderRadius:'50%', background:'#a5f3fc' }}/>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'#10b981', animation:'pulse 2s infinite' }}/>
                System healthy · {urgent.length} alert{urgent.length!==1?'s':''}
              </span>
            </div>
            {mostUrgent && (
              <div style={{ marginTop:10, padding:'9px 12px', background:'#fef2f2', border:'1.5px solid #fecaca', borderRadius:8, fontSize:12, color:'#991b1b', fontWeight:600 }}>
                ⚠️ <b>{mostUrgent.domain_name}</b> expires in <b>{daysUntil(mostUrgent.cert_expiry)} days</b> — action required
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:10, flexShrink:0 }}>
            <button onClick={() => setPage('inventory')}
              style={{ padding:'10px 18px', borderRadius:9, border:'1.5px solid #a5f3fc', background:'#fff', fontSize:13, fontWeight:600, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', transition:'all .15s', boxShadow:'0 2px 8px rgba(8,145,178,.1)' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.boxShadow='0 4px 12px rgba(8,145,178,.2)' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#fff'; e.currentTarget.style.boxShadow='0 2px 8px rgba(8,145,178,.1)' }}>
              ↑ Upload CSV
            </button>
            <button onClick={() => setPage('generate')}
              style={{ padding:'10px 18px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#0891b2,#0e7490)', fontSize:13, fontWeight:700, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:7, fontFamily:'inherit', boxShadow:'0 4px 14px rgba(8,145,178,.35)', transition:'all .15s' }}
              onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 6px 20px rgba(8,145,178,.5)'; e.currentTarget.style.transform='translateY(-2px)' }}
              onMouseLeave={e=>{ e.currentTarget.style.boxShadow='0 4px 14px rgba(8,145,178,.35)'; e.currentTarget.style.transform='translateY(0)' }}>
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
              Generate CSR
            </button>
          </div>
        </div>

        {/* KPI GRID */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
          {/* Active Certs */}
          <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, padding:'16px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'all .2s' }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor='#67e8f9'; e.currentTarget.style.boxShadow='0 6px 20px rgba(8,145,178,.15)' }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor='#cffafe'; e.currentTarget.style.boxShadow='none' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg,#0891b2,#06b6d4)' }}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.05em' }}>Active Certs</span>
              <span style={{ fontSize:18 }}>🔒</span>
            </div>
            <div style={{ fontSize:36, fontWeight:900, color:'#0891b2', letterSpacing:'-0.04em', marginBottom:8 }}>{inventory.length}</div>
            <div style={{ fontSize:11, fontWeight:600, color:'#10b981', display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ display:'inline-block', width:5, height:5, borderRadius:'50%', background:'#10b981' }}/>
              {stable.length} stable
            </div>
          </div>

          {/* Expiring Soon */}
          <div style={{ background:'#fff5f5', border:'1.5px solid #fecaca', borderRadius:12, padding:'16px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'all .2s' }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor='#f87171'; e.currentTarget.style.boxShadow='0 6px 20px rgba(220,38,38,.15)' }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor='#fecaca'; e.currentTarget.style.boxShadow='none' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg,#dc2626,#ef4444)' }}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'#991b1b', textTransform:'uppercase', letterSpacing:'0.05em' }}>Expiring Soon</span>
              <span style={{ fontSize:18 }}>⚠️</span>
            </div>
            <div style={{ fontSize:36, fontWeight:900, color:'#dc2626', letterSpacing:'-0.04em', marginBottom:8, animation:'pulse-scale 1.5s infinite' }}>{urgent.length}</div>
            <div style={{ fontSize:11, fontWeight:600, color:'#b91c1c' }}>
              ≤ 30 days remaining
            </div>
          </div>

          {/* CSR Registry */}
          <div style={{ background:'#ecfdf5', border:'1.5px solid #d1fae5', borderRadius:12, padding:'16px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'all .2s' }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor='#6ee7b7'; e.currentTarget.style.boxShadow='0 6px 20px rgba(16,179,145,.15)' }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor='#d1fae5'; e.currentTarget.style.boxShadow='none' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg,#10b981,#34d399)' }}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'#047857', textTransform:'uppercase', letterSpacing:'0.05em' }}>CSRs</span>
              <span style={{ fontSize:18 }}>🔑</span>
            </div>
            <div style={{ fontSize:36, fontWeight:900, color:'#059669', letterSpacing:'-0.04em', marginBottom:8 }}>{csrs?.length||0}</div>
            <div style={{ fontSize:11, fontWeight:600, color:'#15803d' }}>
              in registry
            </div>
          </div>

          {/* Health Score */}
          <div style={{ background:healthBg, border:`1.5px solid ${healthScore>=80?'#d1fae5':healthScore>=50?'#fed7aa':'#fecaca'}`, borderRadius:12, padding:'16px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'all .2s' }}
            onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,.1)' }}
            onMouseLeave={e=>{ e.currentTarget.style.boxShadow='none' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${healthColor},${healthColor}80)` }}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:600, color:healthColor, textTransform:'uppercase', letterSpacing:'0.05em' }}>Health Score</span>
              <span style={{ fontSize:18 }}>📊</span>
            </div>
            <div style={{ fontSize:36, fontWeight:900, color:healthColor, letterSpacing:'-0.04em', marginBottom:8 }}>{healthScore}</div>
            <div style={{ fontSize:11, fontWeight:600, color:healthColor }}>
              {healthScore>=80?'Excellent':healthScore>=50?'Good':'Critical'}
            </div>
          </div>
        </div>
      </div>

      {/* ANALYTICS SECTION */}
      <div style={{ padding:'20px 28px', flexShrink:0, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
        {/* Expiry Timeline */}
        <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, padding:'16px', boxShadow:'0 2px 8px rgba(8,145,178,.06)' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:14 }}>Expiry Timeline</div>
          {[
            { label:'Critical', days:30, count:urgent.length, color:'#dc2626', bg:'#fef2f2' },
            { label:'Warning', days:60, count:warning.length, color:'#f59e0b', bg:'#fff7ed' },
            { label:'Healthy', days:90, count:healthy.length, color:'#10b981', bg:'#ecfdf5' },
            { label:'Stable', days:180, count:stable.length, color:'#0891b2', bg:'#f0fdff' },
          ].map(b => (
            <div key={b.label} style={{ marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5, fontSize:11.5, fontWeight:600 }}>
                <span style={{ color:'#083344' }}>{b.label}</span>
                <span style={{ color:b.color, fontWeight:700 }}>{b.count}</span>
              </div>
              <div style={{ height:7, background:'#e0f9ff', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${Math.min(100, (b.count/(inventory.length||1))*100)}%`, background:b.color, borderRadius:99, transition:'width 0.5s ease' }}/>
              </div>
            </div>
          ))}
        </div>

        {/* Certificate Mix */}
        <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, padding:'16px', boxShadow:'0 2px 8px rgba(8,145,178,.06)' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:14 }}>Certificate Mix</div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:20, marginBottom:16, height:100 }}>
            <svg width="100" height="100" viewBox="0 0 100 100" style={{ transform:'rotate(-90deg)' }}>
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e0f9ff" strokeWidth="16"/>
              {/* Urgent segment */}
              {urgent.length > 0 && (
                <circle cx="50" cy="50" r="40" fill="none" stroke="#dc2626" strokeWidth="16"
                  strokeDasharray={`${(urgent.length/inventory.length)*251.2} 251.2`}
                  style={{ transition:'stroke-dasharray 0.5s ease' }}/>
              )}
              {/* Warning segment */}
              {warning.length > 0 && (
                <circle cx="50" cy="50" r="40" fill="none" stroke="#f59e0b" strokeWidth="16"
                  strokeDasharray={`${(warning.length/inventory.length)*251.2} 251.2`}
                  strokeDashoffset={-((urgent.length/inventory.length)*251.2)}
                  style={{ transition:'stroke-dashoffset 0.5s ease' }}/>
              )}
              {/* Healthy segment */}
              {(healthy.length + stable.length) > 0 && (
                <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="16"
                  strokeDasharray={`${((healthy.length+stable.length)/inventory.length)*251.2} 251.2`}
                  strokeDashoffset={-(((urgent.length+warning.length)/inventory.length)*251.2)}
                  style={{ transition:'stroke-dashoffset 0.5s ease' }}/>
              )}
            </svg>
            <div>
              <div style={{ fontSize:20, fontWeight:900, color:'#083344', marginBottom:4 }}>{inventory.length}</div>
              <div style={{ fontSize:11, color:'#67c5d4', fontWeight:600, lineHeight:1.6 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:'#dc2626' }}/>
                  <span>{urgent.length} Critical</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:'#f59e0b' }}/>
                  <span>{warning.length} Warning</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:'#10b981' }}/>
                  <span>{healthy.length + stable.length} Healthy</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, padding:'16px', boxShadow:'0 2px 8px rgba(8,145,178,.06)' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:14 }}>Quick Actions</div>
          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            <button onClick={() => setPage('cert-labs:ssl-checker')}
              style={{ padding:'10px 12px', borderRadius:9, border:'1.5px solid #cffafe', background:'#f0fdff', fontSize:12.5, fontWeight:600, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', transition:'all .15s', textAlign:'left' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#cffafe'; e.currentTarget.style.borderColor='#67e8f9' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderColor='#cffafe' }}>
              🛡️ Verify SSL Certificate
            </button>
            <button onClick={() => setPage('cert-labs:csr-decoder')}
              style={{ padding:'10px 12px', borderRadius:9, border:'1.5px solid #cffafe', background:'#f0fdff', fontSize:12.5, fontWeight:600, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', transition:'all .15s', textAlign:'left' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#cffafe'; e.currentTarget.style.borderColor='#67e8f9' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderColor='#cffafe' }}>
              📄 Decode CSR File
            </button>
            <button onClick={() => setPage('cert-labs:cert-decoder')}
              style={{ padding:'10px 12px', borderRadius:9, border:'1.5px solid #cffafe', background:'#f0fdff', fontSize:12.5, fontWeight:600, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', transition:'all .15s', textAlign:'left' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#cffafe'; e.currentTarget.style.borderColor='#67e8f9' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderColor='#cffafe' }}>
              🔍 Decode Certificate
            </button>
            <button onClick={() => setPage('cert-labs:key-matcher')}
              style={{ padding:'10px 12px', borderRadius:9, border:'1.5px solid #cffafe', background:'#f0fdff', fontSize:12.5, fontWeight:600, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', transition:'all .15s', textAlign:'left' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#cffafe'; e.currentTarget.style.borderColor='#67e8f9' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderColor='#cffafe' }}>
              🔐 Match Key & Cert
            </button>
          </div>
        </div>
      </div>

      {/* INVENTORY TABLE */}
      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', padding:'0 28px 20px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:12, flexShrink:0 }}>
          <span style={{ fontSize:15, fontWeight:800, color:'#083344', letterSpacing:'-0.03em', flex:1 }}>Certificate Inventory</span>
          <div style={{ display:'flex', gap:2, background:'#a5f3fc', borderRadius:9, padding:3, flexShrink:0 }}>
            {['All','Reissue','Renew'].map(t => (
              <button key={t} onClick={() => setFilter(t)}
                style={{ padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:filter===t?700:600, color:filter===t?'#083344':'#0e7490', background:filter===t?'#fff':'transparent', border:'none', cursor:'pointer', boxShadow:filter===t?'0 1px 4px rgba(8,145,178,.15)':'none', fontFamily:'inherit', whiteSpace:'nowrap', transition:'all .15s' }}>
                {t} {t==='All'?inventory.length:t==='Reissue'?reissue.length:renew.length}
              </button>
            ))}
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search domain or order…"
            style={{ height:34, padding:'0 12px', border:'1.5px solid #a5f3fc', borderRadius:8, fontSize:12, background:'#fff', color:'#083344', outline:'none', width:180, flexShrink:0, fontFamily:'inherit', transition:'border-color .15s' }}
            onFocus={e=>e.target.style.borderColor='#0891b2'}
            onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
        </div>

        <div style={{ flex:1, background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column', minHeight:0, boxShadow:'0 4px 16px rgba(8,145,178,.1)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'200px 90px 120px 70px 100px', padding:'12px 18px', background:'linear-gradient(90deg,#f0fdff,#ecfeff)', borderBottom:'1.5px solid #cffafe', flexShrink:0 }}>
            {['Domain ↑','Alert','Cert Expiry','Days','Health'].map(h => (
              <span key={h} style={{ fontSize:10.5, fontWeight:700, color:'#0891b2', textTransform:'uppercase', letterSpacing:'0.08em', whiteSpace:'nowrap', cursor:'pointer' }}
                onMouseEnter={e=>e.currentTarget.style.color='#0e7490'}
                onMouseLeave={e=>e.currentTarget.style.color='#0891b2'}>{h}</span>
            ))}
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {filtered.length===0 && (
              <div style={{ padding:'60px 0', textAlign:'center', fontSize:13, color:'#67c5d4' }}>
                {inventory.length===0?'📦 Upload a CSV to see your certificates here':'🔍 No records match your search'}
              </div>
            )}
            {filtered.map((row,i) => {
              const days = daysUntil(row.cert_expiry)
              const isHot  = days!==null&&days<=30
              const isWarm = days!==null&&days>30&&days<=90
              const dc = isHot?'#dc2626':isWarm?'#b45309':'#059669'
              const isR = row.alert_type==='reissue'

              return (
                <div key={row.id||i}
                  style={{ display:'grid', gridTemplateColumns:'200px 90px 120px 70px 100px', padding:'12px 18px', borderBottom:'1px solid #f0fdff', alignItems:'center', cursor:'pointer', transition:'all .08s' }}
                  onMouseEnter={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderLeft='4px solid #0891b2' }}
                  onMouseLeave={e=>{ e.currentTarget.style.background='#fff'; e.currentTarget.style.borderLeft='4px solid transparent' }}>
                  <div style={{ paddingLeft:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-0.02em', paddingRight:10 }}>{row.domain_name}</div>
                    <div style={{ fontSize:10, color:'#67c5d4', marginTop:2, fontFamily:'monospace', fontWeight:500 }}>#{row.order_id}</div>
                  </div>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:99, background:isR?'#fef2f2':'#fff7ed', color:isR?'#b91c1c':'#92400e', whiteSpace:'nowrap' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:isR?'#dc2626':'#f59e0b', flexShrink:0 }}/>
                    {isR?'Reissue':'Renew'}
                  </span>
                  <span style={{ fontSize:12.5, fontWeight:600, color:dc, whiteSpace:'nowrap', paddingRight:6, letterSpacing:'-0.01em' }}>{fmtDate(row.cert_expiry)}</span>
                  <span style={{ fontSize:15, fontWeight:900, letterSpacing:'-0.04em', color:dc, whiteSpace:'nowrap', paddingRight:6 }}>{days!==null?`${days}d`:'—'}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ flex:1, height:6, background:'#e0f9ff', borderRadius:99, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${isHot?30:isWarm?60:85}%`, background:isHot?'#dc2626':isWarm?'#f59e0b':'#10b981', borderRadius:99 }}/>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:dc, whiteSpace:'nowrap' }}>{isHot?'Critical':isWarm?'Warn':'OK'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes pulse-scale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
