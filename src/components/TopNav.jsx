import { useState } from 'react'

export default function TopNav({ page, setPage, user, profile, inventoryAlerts, onLogout }) {
  const name = profile?.full_name || user?.email?.split('@')[0] || 'User'
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2)
  const [showUser, setShowUser] = useState(false)

  const TABS = [
    { id:'overview',  label:'Overview'     },
    { id:'inventory', label:'Certificates' },
    { id:'dmarc',     label:'DMARC'        },
    { id:'dns',       label:'DNS'          },
    { id:'registry',  label:'CSR'          },
  ]

  return (
    <div style={{ height:56, background:'linear-gradient(135deg,#0891b2 0%,#0e7490 100%)', display:'flex', alignItems:'center', padding:'0 20px', flexShrink:0, position:'relative', borderBottom:'1px solid rgba(255,255,255,.15)' }}>

      {/* Brand */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginRight:36, flexShrink:0 }}>
        <div style={{ width:32, height:32, background:'rgba(255,255,255,.2)', border:'1px solid rgba(255,255,255,.3)', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path d="M10 1.5L2.5 5.5v5c0 4.4 3.1 8.5 7 9.9 3.9-1.4 7-5.5 7-9.9v-5L10 1.5z" fill="#fff" opacity=".95"/>
            <path d="M7 10.5l2.5 2.5L14 8" stroke="#0891b2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ display:'flex', alignItems:'center' }}>
          <span style={{ fontSize:16, fontWeight:800, color:'#fff', letterSpacing:'-0.04em' }}>CertVault</span>
          <span style={{ fontSize:9.5, fontWeight:700, background:'rgba(255,255,255,.2)', color:'#fff', padding:'2px 6px', borderRadius:4, marginLeft:4, border:'1px solid rgba(255,255,255,.25)', letterSpacing:'0.04em' }}>PRO</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', flex:1 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setPage(t.id)}
            style={{ height:56, padding:'0 15px', display:'flex', alignItems:'center', fontSize:13, fontWeight:page===t.id?700:500, color:page===t.id?'#fff':'rgba(255,255,255,.65)', background:'none', border:'none', borderBottom:`2px solid ${page===t.id?'rgba(255,255,255,.9)':'transparent'}`, cursor:'pointer', transition:'all .15s', whiteSpace:'nowrap', fontFamily:'inherit' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Right */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, marginLeft:'auto' }}>
        {inventoryAlerts > 0 && (
          <div onClick={() => setPage('inventory')}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', background:'rgba(255,255,255,.15)', border:'1px solid rgba(255,255,255,.25)', borderRadius:99, cursor:'pointer' }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:'#fbbf24', animation:'pulse 2s infinite', flexShrink:0 }}/>
            <span style={{ fontSize:12, fontWeight:700, color:'#fff' }}>{inventoryAlerts} critical</span>
          </div>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:7, height:33, padding:'0 12px', background:'rgba(255,255,255,.12)', border:'1px solid rgba(255,255,255,.2)', borderRadius:8, cursor:'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="rgba(255,255,255,.6)" strokeWidth="1.3"/><path d="M9.5 9.5L12 12" stroke="rgba(255,255,255,.6)" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span style={{ fontSize:12, color:'rgba(255,255,255,.65)' }}>Search…</span>
          <span style={{ fontSize:10, background:'rgba(255,255,255,.15)', border:'1px solid rgba(255,255,255,.2)', borderRadius:4, padding:'1px 5px', color:'rgba(255,255,255,.65)' }}>⌘K</span>
        </div>
        <div style={{ position:'relative' }} onClick={() => setShowUser(s => !s)}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(255,255,255,.2)', border:'2px solid rgba(255,255,255,.4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'#fff', cursor:'pointer' }}>{initials}</div>
          {showUser && (
            <div style={{ position:'absolute', right:0, top:40, background:'#fff', border:'1.5px solid #cffafe', borderRadius:11, padding:'6px', minWidth:190, boxShadow:'0 8px 32px rgba(8,145,178,.2)', zIndex:100 }}>
              <div style={{ padding:'8px 10px', borderBottom:'1px solid #f0fdff', marginBottom:4 }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:'#083344' }}>{name}</div>
                <div style={{ fontSize:11, color:'#67c5d4', marginTop:2 }}>{user?.email}</div>
              </div>
              <button onClick={onLogout} style={{ width:'100%', padding:'7px 10px', background:'#fff5f5', border:'none', borderRadius:7, fontSize:12, color:'#dc2626', fontWeight:600, cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>Sign out</button>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
    </div>
  )
}
