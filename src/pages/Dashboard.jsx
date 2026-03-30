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

const SPARKS = {
  red:   [7,10,8,14,10,16,22],
  amber: [9,12,14,16,14,18,22],
  teal:  [11,13,12,15,14,17,22],
  green: [8,10,13,12,15,17,22],
}

export default function Dashboard({ user, setPage, csrs }) {
  const [inventory, setInventory] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('All')
  const [search,    setSearch]    = useState('')

  const hour = new Date().getHours()
  const greeting = hour<12?'Good morning':hour<17?'Good afternoon':'Good evening'
  const name  = user?.email?.split('@')[0] || 'there'
  const today = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})

  useEffect(() => {
    if (!user?.id) return
    supabase.from('certificate_inventory').select('*').eq('user_id',user.id).order('cert_expiry',{ascending:true})
      .then(({ data }) => { if (data) setInventory(data); setLoading(false) })
  }, [user])

  const reissue = inventory.filter(r => r.alert_type==='reissue')
  const renew   = inventory.filter(r => r.alert_type==='renew')
  const urgent  = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d<=30 })
  const mostUrgent = urgent[0]

  const CARDS = [
    { label:'Reissue Alerts', value:reissue.length, color:'#dc2626', barColor:'linear-gradient(90deg,#dc2626,#ef4444)', bg:'#fef2f2', emoji:'⚠️', tag:`${urgent.length} critical`, tagBg:'#fef2f2', tagColor:'#dc2626', spark:'red',   highlight:false },
    { label:'Renew Alerts',   value:renew.length,   color:'#b45309', barColor:'linear-gradient(90deg,#f59e0b,#fbbf24)', bg:'#fff7ed', emoji:'🔄', tag:'same expiry',           tagBg:'#fff7ed', tagColor:'#c2410c', spark:'amber', highlight:false },
    { label:'Active Certs',   value:inventory.length,color:'#083344', barColor:'linear-gradient(90deg,#0891b2,#06b6d4)', bg:'#a5f3fc', emoji:'🔒', tag:'all active',             tagBg:'#cffafe', tagColor:'#0e7490', spark:'teal',  highlight:true  },
    { label:'CSRs',           value:csrs?.length||0, color:'#059669', barColor:'linear-gradient(90deg,#10b981,#34d399)', bg:'#ecfdf5', emoji:'🔑', tag:'in registry',            tagBg:'#f0fdf4', tagColor:'#15803d', spark:'green', highlight:false },
  ]

  const filtered = inventory.filter(r => {
    const mF = filter==='All'?true:filter==='Reissue'?r.alert_type==='reissue':r.alert_type==='renew'
    const mS = !search||r.domain_name?.toLowerCase().includes(search.toLowerCase())||r.order_id?.includes(search)
    return mF && mS
  })

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, background:'#ecfeff' }}>
      <div style={{ width:36, height:36, border:'3px solid #cffafe', borderTopColor:'#0891b2', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <div style={{ fontSize:13, color:'#67c5d4' }}>Loading dashboard…</div>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#ecfeff' }}>

      {/* Hero */}
      <div style={{ padding:'20px 22px 16px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, gap:16 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:800, color:'#083344', letterSpacing:'-0.04em' }}>{greeting}, {name} 👋</div>
            <div style={{ fontSize:12.5, color:'#67c5d4', marginTop:5, lineHeight:1.5 }}>
              {today}
              {mostUrgent && <span> &nbsp;·&nbsp; <b style={{ color:'#0e7490' }}>{mostUrgent.domain_name}</b> expires in <em style={{ color:'#dc2626', fontStyle:'normal', fontWeight:700 }}>{daysUntil(mostUrgent.cert_expiry)} days</em> — action needed</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            <button onClick={() => setPage('inventory')}
              style={{ padding:'8px 16px', borderRadius:9, border:'1.5px solid #a5f3fc', background:'#fff', fontSize:12.5, fontWeight:600, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderColor='#67e8f9' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#a5f3fc' }}>
              ↑ Upload CSV
            </button>
            <button onClick={() => setPage('generate')}
              style={{ padding:'8px 16px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#0891b2,#0e7490)', fontSize:12.5, fontWeight:700, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit', boxShadow:'0 4px 12px rgba(8,145,178,.35)' }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
              Generate CSR
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          {CARDS.map(c => (
            <div key={c.label}
              style={{ background:c.highlight?'linear-gradient(135deg,#cffafe,#e0f9ff)':'#fff', border:`1.5px solid ${c.highlight?'#67e8f9':'#cffafe'}`, borderRadius:12, padding:'15px 16px 13px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'all .15s' }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor='#67e8f9'; e.currentTarget.style.boxShadow='0 4px 16px rgba(8,145,178,.12)' }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor=c.highlight?'#67e8f9':'#cffafe'; e.currentTarget.style.boxShadow='none' }}>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:3.5, borderRadius:'12px 12px 0 0', background:c.barColor }}/>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:11 }}>
                <span style={{ fontSize:11, fontWeight:500, color:c.highlight?'#0e7490':'#9ca3af', letterSpacing:'-0.01em', lineHeight:1.3 }}>{c.label}</span>
                <div style={{ width:28, height:28, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, background:c.bg, flexShrink:0 }}>{c.emoji}</div>
              </div>
              <div style={{ fontSize:31, fontWeight:900, letterSpacing:'-0.06em', lineHeight:1, color:c.color, marginBottom:9 }}>{c.value}</div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:10.5, fontWeight:700, padding:'3px 8px', borderRadius:5, background:c.tagBg, color:c.tagColor }}>{c.tag}</span>
                <div style={{ display:'flex', alignItems:'flex-end', gap:2.5, height:22 }}>
                  {SPARKS[c.spark].map((h,i) => (
                    <div key={i} style={{ width:5, height:h, borderRadius:2, background: i===SPARKS[c.spark].length-1 ? (c.highlight?'#0891b2':c.color) : c.bg, opacity: i===SPARKS[c.spark].length-1?1:0.6+i*0.05 }}/>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', padding:'0 22px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:10, flexShrink:0 }}>
          <span style={{ fontSize:14.5, fontWeight:800, color:'#083344', letterSpacing:'-0.03em', flex:1 }}>Certificate Inventory</span>
          <div style={{ display:'flex', gap:2, background:'#a5f3fc', borderRadius:9, padding:3, flexShrink:0 }}>
            {['All','Reissue','Renew'].map(t => (
              <button key={t} onClick={() => setFilter(t)}
                style={{ padding:'4px 12px', borderRadius:7, fontSize:11.5, fontWeight:filter===t?700:600, color:filter===t?'#083344':'#0e7490', background:filter===t?'#fff':'transparent', border:'none', cursor:'pointer', boxShadow:filter===t?'0 1px 4px rgba(8,145,178,.15)':'none', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                {t} {t==='All'?inventory.length:t==='Reissue'?reissue.length:renew.length}
              </button>
            ))}
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search domain or order…"
            style={{ height:32, padding:'0 11px', border:'1.5px solid #a5f3fc', borderRadius:8, fontSize:12, background:'#fff', color:'#083344', outline:'none', width:175, flexShrink:0, fontFamily:'inherit', transition:'border-color .15s' }}
            onFocus={e=>e.target.style.borderColor='#0891b2'}
            onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
        </div>

        <div style={{ flex:1, background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column', minHeight:0, boxShadow:'0 2px 12px rgba(8,145,178,.06)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'190px 86px 116px 64px 80px', padding:'10px 18px', background:'linear-gradient(90deg,#f0fdff,#ecfeff)', borderBottom:'1.5px solid #cffafe', flexShrink:0 }}>
            {['Domain ↑','Alert','Cert Expiry','Days','Auth'].map(h => (
              <span key={h} style={{ fontSize:10, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.08em', whiteSpace:'nowrap', cursor:'pointer' }}
                onMouseEnter={e=>e.currentTarget.style.color='#0891b2'}
                onMouseLeave={e=>e.currentTarget.style.color='#67c5d4'}>{h}</span>
            ))}
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {filtered.length===0 && (
              <div style={{ padding:'40px 0', textAlign:'center', fontSize:13, color:'#67c5d4' }}>
                {inventory.length===0?'Upload a CSV to see your certificates here':'No records match your search'}
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
                  style={{ display:'grid', gridTemplateColumns:'190px 86px 116px 64px 80px', padding:'11px 18px', borderBottom:'1px solid #f0fdff', alignItems:'center', cursor:'pointer', transition:'background .08s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#f0fdff'}
                  onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-0.02em', paddingRight:10 }}>{row.domain_name}</div>
                    <div style={{ fontSize:10, color:'#67c5d4', marginTop:2, fontFamily:'monospace' }}>#{row.order_id}</div>
                  </div>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:99, background:isR?'#fef2f2':'#fff7ed', color:isR?'#b91c1c':'#92400e', whiteSpace:'nowrap' }}>
                    <span style={{ width:5, height:5, borderRadius:'50%', background:isR?'#dc2626':'#f59e0b', flexShrink:0 }}/>
                    {isR?'Reissue':'Renew'}
                  </span>
                  <span style={{ fontSize:12.5, fontWeight:600, color:dc, whiteSpace:'nowrap', paddingRight:6, letterSpacing:'-0.01em' }}>{fmtDate(row.cert_expiry)}</span>
                  <span style={{ fontSize:14, fontWeight:900, letterSpacing:'-0.04em', color:dc, whiteSpace:'nowrap', paddingRight:6 }}>{days!==null?`${days}d`:'—'}</span>
                  <div style={{ display:'flex', gap:3 }}>
                    {[0,1,2].map(j => <div key={j} style={{ width:9, height:9, borderRadius:2.5, background: isHot?'#dc2626': j===2&&isWarm?'#f59e0b':'#10b981' }}/>)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
