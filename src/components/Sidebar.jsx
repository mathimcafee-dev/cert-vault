import { initials } from '../lib/utils.js'

const MAIN_NAV = [
  { id: 'registry',  label: 'CSR Registry',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 5.5h13M5.5 5.5v9" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id: 'generate',  label: 'Generate CSR',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg> },
  { id: 'inventory', label: 'Cert Inventory',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h8M2 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="13" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id: 'dmarc',     label: 'DMARC & Email',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v10H2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 6l6 4 6-4" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id: 'dns',       label: 'DNS Toolkit',
    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5C8 1.5 5 4 5 8s3 6.5 3 6.5M8 1.5C8 1.5 11 4 11 8s-3 6.5-3 6.5M1.5 8h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
]

const COMING_SOON = [
  { id: 'ssl-checker', label: 'SSL Checker',      icon: '🔍' },
  { id: 'cert-labs',   label: 'Certificate Labs', icon: '🧪' },
]

export default function Sidebar({ page, setPage, user, profile, csrCount, onLogout }) {
  const name = profile?.full_name || user?.email?.split('@')[0] || 'User'
  const av   = initials(name)

  return (
    <aside style={{ width:232, background:'#1a1d2e', display:'flex', flexDirection:'column', flexShrink:0 }}>
      <div style={{ padding:'20px 18px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, background:'#4f46e5', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L3 6v4c0 4.418 3.134 8.555 7 9.95C13.866 18.555 17 14.418 17 10V6L10 2z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M7 10l2.5 2.5L14 8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{ color:'#fff', fontSize:15, fontWeight:600, letterSpacing:'-0.02em' }}>CertVault</div>
            <div style={{ color:'#6b7280', fontSize:10 }}>SSL & DNS Management</div>
          </div>
        </div>
      </div>

      <nav style={{ flex:1, padding:'14px 10px', overflowY:'auto' }}>
        <div style={{ fontSize:10, color:'#4b5563', letterSpacing:'0.08em', textTransform:'uppercase', padding:'0 8px 8px', fontWeight:500 }}>Tools</div>
        {MAIN_NAV.map(n => {
          const active = page === n.id
          return (
            <button key={n.id} onClick={() => setPage(n.id)} style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'9px 10px', borderRadius:8, border:'none', background:active?'rgba(79,70,229,0.18)':'transparent', color:active?'#a5b4fc':'#9ca3af', fontSize:13, fontWeight:active?500:400, marginBottom:3, textAlign:'left', borderLeft:`2px solid ${active?'#4f46e5':'transparent'}`, transition:'all 0.15s', cursor:'pointer' }}>
              {n.icon}
              <span style={{ flex:1 }}>{n.label}</span>
              {n.id==='registry' && csrCount>0 && <span style={{ background:active?'#4f46e5':'#374151', color:active?'#fff':'#9ca3af', fontSize:10.5, padding:'2px 7px', borderRadius:99, fontWeight:600 }}>{csrCount}</span>}
            </button>
          )
        })}

        <div style={{ margin:'16px 0 8px', height:1, background:'rgba(255,255,255,0.06)' }} />
        <div style={{ fontSize:10, color:'#4b5563', letterSpacing:'0.08em', textTransform:'uppercase', padding:'0 8px 8px', fontWeight:500 }}>Coming Soon</div>
        {COMING_SOON.map(n => {
          const active = page === n.id
          return (
            <button key={n.id} onClick={() => setPage(n.id)} style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'8px 10px', borderRadius:8, border:'none', background:active?'rgba(79,70,229,0.12)':'transparent', color:active?'#818cf8':'#6b7280', fontSize:12.5, fontWeight:active?500:400, marginBottom:2, textAlign:'left', borderLeft:`2px solid ${active?'#6366f1':'transparent'}`, transition:'all 0.15s', cursor:'pointer' }}>
              <span style={{ fontSize:14, width:16, textAlign:'center' }}>{n.icon}</span>
              <span style={{ flex:1 }}>{n.label}</span>
              <span style={{ fontSize:9, padding:'2px 6px', borderRadius:99, background:'rgba(99,102,241,0.2)', color:'#818cf8', fontWeight:700, letterSpacing:'0.04em' }}>SOON</span>
            </button>
          )
        })}
      </nav>

      <div style={{ padding:'12px 14px 16px', borderTop:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:10 }}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:'#4f46e5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11.5, color:'#fff', fontWeight:600, flexShrink:0 }}>{av}</div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:12.5, color:'#e5e7eb', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
            <div style={{ fontSize:10.5, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.email}</div>
          </div>
        </div>
        <button onClick={onLogout} style={{ width:'100%', padding:'7px', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:7, fontSize:12, color:'#f87171', fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}>Sign Out</button>
      </div>
    </aside>
  )
}
