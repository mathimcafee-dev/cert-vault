const TOOLS = [
  {
    id: 'ssl-checker',
    label: 'SSL Installation Checker',
    icon: '🔍',
    color: '#4f46e5',
    light: '#eef2ff',
    description: 'Instantly verify SSL certificate installation on any domain. Check chain validity, protocol support, cipher suites, and HSTS configuration.',
    features: [
      'Full certificate chain validation',
      'TLS 1.2 / 1.3 protocol detection',
      'Cipher suite analysis',
      'HSTS and security header check',
      'Mixed content detection',
      'Real-time results with color coding',
    ],
    eta: 'Q2 2026',
  },
  {
    id: 'cert-labs',
    label: 'Certificate Labs',
    icon: '🧪',
    color: '#0891b2',
    light: '#ecfeff',
    description: 'Advanced certificate analysis and testing toolkit. Decode, validate, and compare SSL certificates in any format with detailed technical insights.',
    features: [
      'PEM / DER / PFX / P12 decoder',
      'Certificate chain builder',
      'Format converter (all formats)',
      'Expiry and validity checker',
      'Subject Alternative Names viewer',
      'Fingerprint and signature analysis',
    ],
    eta: 'Q2 2026',
  },
  {
    id: 'dns-checker',
    label: 'DNS Checker Tool',
    icon: '🌐',
    color: '#059669',
    light: '#ecfdf5',
    description: 'Comprehensive DNS lookup and propagation checker. Query any record type across global DNS servers and track propagation in real time.',
    features: [
      'A, AAAA, CNAME, MX, TXT, NS lookup',
      'Global propagation checker',
      'DNS health score',
      'TTL analysis and recommendations',
      'Reverse DNS (PTR) lookup',
      'DNS history and change tracking',
    ],
    eta: 'Q3 2026',
  },
  {
    id: 'dmarc',
    label: 'DMARC Data Page',
    icon: '📧',
    color: '#d97706',
    light: '#fffbeb',
    description: 'Full DMARC, SPF and DKIM analysis for your domains. Visualize email authentication status and get actionable recommendations to protect against spoofing.',
    features: [
      'DMARC policy analyzer',
      'SPF record validator',
      'DKIM key checker',
      'Email deliverability score',
      'Aggregate report viewer',
      'Step-by-step setup guidance',
    ],
    eta: 'Q3 2026',
  },
]

export default function ComingSoonPage({ toolId }) {
  const tool = TOOLS.find(t => t.id === toolId) || TOOLS[0]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', background:'#f5f6fa' }}>

      {/* Header */}
      <div style={{ padding:'16px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, background:tool.light, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{tool.icon}</div>
        <div>
          <h1 style={{ fontSize:16, fontWeight:700, color:'#111827', letterSpacing:'-0.02em', margin:0 }}>{tool.label}</h1>
          <p style={{ fontSize:11.5, color:'#9ca3af', margin:0, marginTop:1 }}>Coming soon · Expected {tool.eta}</p>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'5px 14px', background:tool.light, border:`1px solid ${tool.color}33`, borderRadius:99 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:tool.color, display:'inline-block', animation:'pulse 2s infinite' }} />
          <span style={{ fontSize:12, fontWeight:700, color:tool.color, letterSpacing:'0.03em' }}>COMING SOON</span>
        </div>
      </div>

      <div style={{ padding:'32px 28px', maxWidth:860, width:'100%', margin:'0 auto' }}>

        {/* Hero card */}
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:'36px', marginBottom:24, textAlign:'center', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, left:0, right:0, height:4, background:tool.color, borderRadius:'16px 16px 0 0' }} />
          <div style={{ fontSize:52, marginBottom:16 }}>{tool.icon}</div>
          <h2 style={{ fontSize:24, fontWeight:800, color:'#111827', letterSpacing:'-0.03em', marginBottom:12 }}>{tool.label}</h2>
          <p style={{ fontSize:15, color:'#6b7280', lineHeight:1.7, maxWidth:560, margin:'0 auto 24px' }}>{tool.description}</p>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'10px 24px', background:tool.color, color:'#fff', borderRadius:10, fontSize:13, fontWeight:700, opacity:0.7, cursor:'not-allowed' }}>
            🔒 Not yet available
          </div>
        </div>

        {/* Features grid */}
        <div style={{ marginBottom:24 }}>
          <h3 style={{ fontSize:14, fontWeight:700, color:'#374151', letterSpacing:'-0.01em', marginBottom:14, textTransform:'uppercase', letterSpacing:'0.05em', fontSize:11 }}>What's included</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10 }}>
            {tool.features.map((f, i) => (
              <div key={i} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:tool.light, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-6" stroke={tool.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{ fontSize:13, fontWeight:500, color:'#374151' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Other coming soon tools */}
        <div>
          <h3 style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:12 }}>Also coming soon</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:10 }}>
            {TOOLS.filter(t => t.id !== tool.id).map(t => (
              <div key={t.id} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'14px 16px', display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:32, height:32, background:t.light, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{t.icon}</div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:'#374151', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.label}</div>
                  <div style={{ fontSize:11, color:'#9ca3af', marginTop:1 }}>{t.eta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
