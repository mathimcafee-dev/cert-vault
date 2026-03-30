export default function LeftNav({ page, setPage, csrCount, inventoryAlerts }) {
  const nav = (id) => {
    setPage(id)
  }

  const SI = ({ id, emoji, label, count, countRed, bg, active }) => {
    const on = active !== undefined ? active : (id.includes(':') ? (page === id.split(':')[0]) : page === id)
    return (
      <div onClick={() => nav(id)}
        style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderRadius:9, cursor:'pointer', fontSize:12.5, fontWeight:on?700:500, color:on?'#0e7490':'#52525b', background:on?'linear-gradient(135deg,#cffafe,#e0f9ff)':'transparent', border:on?'1px solid #a5f3fc':'1px solid transparent', transition:'all .12s', marginBottom:2 }}
        onMouseEnter={e => { if(!on){ e.currentTarget.style.background='#f0fdff'; e.currentTarget.style.color='#0e7490' }}}
        onMouseLeave={e => { if(!on){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#52525b' }}}>
        <div style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0, background:bg }}>{emoji}</div>
        <span style={{ flex:1, lineHeight:1.1 }}>{label}</span>
        {count > 0 && <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 7px', borderRadius:99, background:countRed?'#fef2f2':'#f0fdff', color:countRed?'#dc2626':'#0891b2', flexShrink:0 }}>{count}</span>}
      </div>
    )
  }

  const Lbl = ({ children }) => (
    <div style={{ fontSize:9.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.09em', padding:'0 6px', marginBottom:6, marginTop:2 }}>{children}</div>
  )
  const Div = () => <div style={{ height:1, background:'linear-gradient(90deg,transparent,#cffafe,transparent)', margin:'8px 12px' }}/>

  return (
    <div style={{ width:224, background:'#fff', borderRight:'1.5px solid #cffafe', display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>
      {/* Top accent */}
      <div style={{ height:3, background:'linear-gradient(90deg,#0891b2,#06b6d4,#67e8f9)', flexShrink:0 }}/>

      <div style={{ padding:'14px 12px 4px' }}>
        <Lbl>Workspace</Lbl>
        <SI id="scanner" emoji="🔎" label="Security Scanner" bg="linear-gradient(135deg,#cffafe,#a5f3fc)" active={page==='scanner'}/>
        <SI id="overview"  emoji={<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.2" fill="#0891b2" opacity=".9"/><rect x="9" y="1" width="6" height="6" rx="1.2" fill="#0891b2" opacity=".3"/><rect x="1" y="9" width="6" height="6" rx="1.2" fill="#0891b2" opacity=".3"/><rect x="9" y="9" width="6" height="6" rx="1.2" fill="#0891b2" opacity=".3"/></svg>} label="Overview"       bg="#a5f3fc"/>
        <SI id="inventory" emoji="🔒" label="Cert Inventory" bg="#fff5f4" count={inventoryAlerts} countRed/>
        <SI id="registry"  emoji="🔑" label="CSR Registry"   bg="#f0fdff" count={csrCount}/>
      </div>
      <Div/>
      <div style={{ padding:'0 12px 4px' }}>
        <Lbl>Email Security</Lbl>
        <SI id="dmarc:single"   emoji="📧" label="DMARC Check"    bg="#eff8ff" active={page==='dmarc'}/>
        <SI id="dmarc:bulk"     emoji="📨" label="Bulk DMARC"     bg="#f0fdf4"/>
        <SI id="dmarc:spf-gen"  emoji="📮" label="SPF Generator"  bg="#fefce8"/>
        <SI id="dmarc:dkim-gen" emoji="🛡" label="DKIM Generator" bg="#fdf4ff"/>
        <SI id="dmarc:bimi-gen" emoji="🏷" label="BIMI Generator" bg="#fafafe"/>
        <SI id="dmarc:phishing" emoji="🎣" label="Phishing Check" bg="#fff5f4"/>
      </div>
      <Div/>
      <div style={{ padding:'0 12px 4px' }}>
        <Lbl>DNS Toolkit</Lbl>
        <SI id="dns:lookup"     emoji="🔍" label="DNS Lookup"     bg="#f0f9ff" active={page==='dns'}/>
        <SI id="dns:health"     emoji="🏥" label="Domain Health"  bg="#f0fdf4"/>
        <SI id="dns:propagation"emoji="🌍" label="Propagation"    bg="#fefce8"/>
        <SI id="dns:blacklist"  emoji="🚫" label="Blacklist Check"bg="#fff5f4"/>
        <SI id="dns:compare"    emoji="⚖"  label="DNS Compare"    bg="#f5f3ff"/>
        <SI id="dns:ttl"        emoji="⏱" label="TTL Analyser"   bg="#fafafe"/>
        <SI id="dns:reverse"    emoji="↩"  label="Reverse DNS"    bg="#f0fdf4"/>
      </div>
      <Div/>
      <div style={{ padding:'0 12px 4px' }}>
        <Lbl>Certificate Labs</Lbl>
        <SI id="cert-labs:ssl-checker"   emoji="🛡" label="SSL Checker"      bg="#f0fdff"/>
        <SI id="cert-labs:csr-decoder"   emoji="📄" label="CSR Decoder"      bg="#fefce8"/>
        <SI id="cert-labs:cert-decoder"  emoji="🔍" label="Cert Decoder"     bg="#eff8ff"/>
        <SI id="cert-labs:key-matcher"   emoji="🔐" label="Key Matcher"      bg="#fdf4ff"/>
        <SI id="cert-labs:ssl-converter" emoji="🔄" label="SSL Converter"    bg="#f0fdf4"/>
      <Lbl>Coming Soon</Lbl>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderRadius:9, fontSize:12.5, fontWeight:500, color:'#9ca3af', opacity:.6, marginBottom:2 }}>
          <div style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0, background:'#f5f3f0' }}>🔒</div>
          <span style={{ flex:1 }}>SSL Checker Pro</span>
          <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:'#e0f9ff', color:'#0891b2', letterSpacing:'0.04em' }}>SOON</span>
        </div>
      </div>

      <div style={S.div}/>
      <div style={{ padding:'0 12px 4px' }}>
        <div onClick={() => nav('settings')}
          style={S.item(page==='settings')}
          onMouseEnter={e => { if(page!=='settings'){ e.currentTarget.style.background='#f5f3f0'; e.currentTarget.style.color='#111' }}}
          onMouseLeave={e => { if(page!=='settings'){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#6b7280' }}}>
          <div style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0, background:'#f0f9ff' }}>⚙️</div>
          <span style={{ flex:1 }}>Settings</span>
        </div>
      </div>

      {/* Health widget */}
      <div style={{ margin:'10px 12px 14px', padding:'14px', background:'linear-gradient(135deg,#f0fdff,#ecfeff)', border:'1px solid #a5f3fc', borderRadius:11 }}>
        <div style={{ fontSize:9.5, fontWeight:700, color:'#0891b2', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:12 }}>Inventory health</div>
        {[
          { label:'Reissue', color:'#dc2626', value:inventoryAlerts||0, pct:Math.min(100,(inventoryAlerts||0)/1.55) },
          { label:'Renew',   color:'#f59e0b', value:130, pct:84 },
          { label:'Healthy', color:'#10b981', value:0,   pct:0  },
        ].map(h => (
          <div key={h.label} style={{ marginBottom:9 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:11.5, color:'#52525b', fontWeight:500 }}>{h.label}</span>
              <span style={{ fontSize:11.5, fontWeight:800, color:h.color }}>{h.value}</span>
            </div>
            <div style={{ height:5, background:'#e0f9ff', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${h.pct}%`, background:h.color, borderRadius:99 }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
