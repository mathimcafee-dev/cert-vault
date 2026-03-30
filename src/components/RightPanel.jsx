export default function RightPanel({ page, setPage, urgentCerts, dmarcHistory, recentActivity }) {
  const daysUntil = str => {
    const m = str?.match(/^(\d{2})-(\d{2})-(\d{4})/)
    if (!m) return null
    const [,dd,mm,yyyy] = m
    return Math.ceil((new Date(`${yyyy}-${mm}-${dd}`) - new Date().setHours(0,0,0,0)) / 86400000)
  }
  const scoreColor = s => s>=80?'#059669':s>=50?'#b45309':'#dc2626'
  const scoreBg    = s => s>=80?'#f0fdf4':s>=50?'#fff7ed':'#fef2f2'

  const TOOLS = [
    { emoji:'🔍', label:'DNS Lookup',  desc:'All record types', page:'dns'   },
    { emoji:'📧', label:'DMARC',       desc:'Check any domain', page:'dmarc' },
    { emoji:'🚫', label:'Blacklist',   desc:'25 DNS lists',     page:'dns'   },
    { emoji:'⚖',  label:'Compare',    desc:'Two domains',      page:'dns'   },
  ]

  const Lbl = ({ children }) => (
    <div style={{ fontSize:9.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:11 }}>{children}</div>
  )

  return (
    <div style={{ width:256, background:'#fff', borderLeft:'1.5px solid #cffafe', display:'flex', flexDirection:'column', overflowY:'auto', flexShrink:0 }}>
      {/* Top accent */}
      <div style={{ height:3, background:'linear-gradient(90deg,#67e8f9,#06b6d4,#0891b2)', flexShrink:0 }}/>

      {/* Urgent alerts */}
      <div style={{ padding:'15px', borderBottom:'1px solid #f0fdff' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:11 }}>
          <div style={{ fontSize:9.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.09em' }}>Urgent action needed</div>
          <div style={{ fontSize:9.5, color:'#a5f3fc' }}>From inventory</div>
        </div>
        {urgentCerts && urgentCerts.length > 0 ? urgentCerts.slice(0,4).map((cert,i) => {
          const days = daysUntil(cert.cert_expiry)
          const isNow = days !== null && days <= 30
          return (
            <div key={i} onClick={() => setPage('inventory')}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'10px 12px', borderRadius:10, marginBottom:7, border:`1px solid ${isNow?'#fecaca':'#fde68a'}`, background:isNow?'#fff5f5':'#fffbf0', cursor:'pointer', transition:'filter .1s' }}
              onMouseEnter={e=>e.currentTarget.style.filter='brightness(.97)'}
              onMouseLeave={e=>e.currentTarget.style.filter='none'}>
              <div style={{ width:24, height:24, borderRadius:7, background:isNow?'#fee2e2':'#ffedd5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, flexShrink:0 }}>{isNow?'⚠':'!'}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cert.domain_name}</div>
                <div style={{ fontSize:10.5, fontWeight:600, color:isNow?'#dc2626':'#b45309', marginTop:2 }}>{cert.alert_type==='reissue'?'Reissue':'Renew'} · {days}d left</div>
              </div>
              <span style={{ fontSize:10, fontWeight:800, padding:'2px 7px', borderRadius:4, background:isNow?'#fee2e2':'#ffedd5', color:isNow?'#dc2626':'#b45309', flexShrink:0 }}>{days<=7?'NOW':days+'d'}</span>
            </div>
          )
        }) : (
          <div style={{ fontSize:12, color:'#67c5d4', padding:'10px 0', textAlign:'center' }}>No urgent alerts 🎉</div>
        )}
      </div>

      {/* DMARC health */}
      <div style={{ padding:'15px', borderBottom:'1px solid #f0fdff' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:11 }}>
          <div style={{ fontSize:9.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.09em' }}>DMARC health</div>
          <div style={{ fontSize:9.5, color:'#a5f3fc' }}>Live · updates on check</div>
        </div>
        {dmarcHistory && dmarcHistory.length > 0 ? dmarcHistory.slice(0,3).map((h,i) => (
          <div key={i} onClick={() => setPage('dmarc')}
            style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 0', borderBottom:i<2?'1px solid #f0fdff':'none', cursor:'pointer' }}>
            <div style={{ width:38, height:38, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:900, flexShrink:0, background:scoreBg(h.score), color:scoreColor(h.score), letterSpacing:'-0.03em' }}>{h.score}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.domain}</div>
              <div style={{ fontSize:10.5, color:'#9ca3af', marginTop:2 }}>
                {h.dmarc_policy ? `p=${h.dmarc_policy}` : h.dmarc_status==='missing' ? 'No DMARC' : h.dmarc_status==='great'||h.dmarc_status==='good' ? 'p=reject/quarantine' : 'p=none'}
                {' · '}{h.score>=80?'Strong':h.score>=50?'Moderate':'Weak'}
              </div>
            </div>
            <div style={{ display:'flex', gap:3, flexShrink:0 }}>
              {[h.dmarc_status,h.spf_status,h.dkim_status].map((st,j) => (
                <div key={j} style={{ width:8, height:8, borderRadius:2.5, background:st==='great'||st==='good'?'#10b981':st==='warn'||st==='missing'?'#f59e0b':'#dc2626' }}/>
              ))}
            </div>
          </div>
        )) : (
          <div style={{ textAlign:'center', padding:'10px 0' }}>
            <div style={{ fontSize:12, color:'#67c5d4', marginBottom:8 }}>No domains checked yet</div>
            <button onClick={() => setPage('dmarc')} style={{ padding:'6px 14px', border:'1.5px solid #a5f3fc', borderRadius:8, background:'#f0fdff', fontSize:11.5, color:'#0e7490', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Check a domain →</button>
          </div>
        )}
      </div>

      {/* Quick tools */}
      <div style={{ padding:'15px', borderBottom:'1px solid #f0fdff' }}>
        <Lbl>Quick tools</Lbl>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
          {TOOLS.map(t => (
            <div key={t.label} onClick={() => setPage(t.page)}
              style={{ padding:'10px 12px', borderRadius:10, border:'1.5px solid #cffafe', background:'#f0fdff', cursor:'pointer', transition:'all .12s' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='#cffafe'; e.currentTarget.style.borderColor='#a5f3fc'; e.currentTarget.style.boxShadow='0 2px 8px rgba(8,145,178,.1)' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.borderColor='#cffafe'; e.currentTarget.style.boxShadow='none' }}>
              <div style={{ fontSize:17, marginBottom:5 }}>{t.emoji}</div>
              <div style={{ fontSize:12, fontWeight:700, color:'#0e7490' }}>{t.label}</div>
              <div style={{ fontSize:10, color:'#67c5d4', marginTop:2 }}>{t.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div style={{ padding:'15px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:11 }}>
          <div style={{ fontSize:9.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.09em' }}>Recent activity</div>
          <div style={{ fontSize:9.5, color:'#a5f3fc' }}>This session</div>
        </div>
        {recentActivity && recentActivity.length > 0 ? recentActivity.map((a,i) => (
          <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start', padding:'8px 0', borderBottom:i<recentActivity.length-1?'1px solid #f0fdff':'none' }}>
            <div style={{ width:26, height:26, borderRadius:8, background:'#f0fdff', border:'1px solid #cffafe', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, flexShrink:0 }}>{a.icon}</div>
            <div>
              <div style={{ fontSize:11.5, fontWeight:500, color:'#374151', lineHeight:1.4 }}>{a.text}</div>
              <div style={{ fontSize:10.5, color:'#67c5d4', marginTop:2 }}>{a.time}</div>
            </div>
          </div>
        )) : (
          <div style={{ fontSize:12, color:'#67c5d4', textAlign:'center', padding:'10px 0' }}>No recent activity</div>
        )}
      </div>
    </div>
  )
}
