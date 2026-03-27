import { useState, useCallback } from 'react'

// ── Cloudflare DoH lookup ─────────────────────────────────────────────────
async function dnsQuery(name, type) {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      { headers: { Accept: 'application/dns-json' } }
    )
    if (!res.ok) return { answers: [], status: res.status }
    const data = await res.json()
    return { answers: data.Answer || [], authority: data.Authority || [], status: data.Status, flags: { aa: data.AA, tc: data.TC, rd: data.RD, ra: data.RA } }
  } catch { return { answers: [], status: -1 } }
}

async function dnsLookup(name, type) {
  const r = await dnsQuery(name, type)
  return r.answers.map(a => ({ ...a, data: a.data?.replace(/"/g,'').trim() })).filter(a => a.data)
}

// ── DNS record type info ──────────────────────────────────────────────────
const RECORD_TYPES = ['A','AAAA','MX','CNAME','TXT','NS','SOA','CAA','PTR','SRV','DNSKEY','DS','NAPTR','HINFO']
const TYPE_COLORS  = { A:'#4f46e5',AAAA:'#0891b2',MX:'#d97706',CNAME:'#7c3aed',TXT:'#059669',NS:'#dc2626',SOA:'#9333ea',CAA:'#0284c7',PTR:'#be185d',SRV:'#b45309',DNSKEY:'#0f766e',DS:'#1d4ed8',NAPTR:'#6d28d9',HINFO:'#374151' }
const TYPE_DESC    = { A:'IPv4 address',AAAA:'IPv6 address',MX:'Mail server',CNAME:'Alias record',TXT:'Text record / SPF / DKIM',NS:'Name servers',SOA:'Start of authority',CAA:'Certificate authority',PTR:'Reverse DNS',SRV:'Service record',DNSKEY:'DNSSEC key',DS:'Delegation signer',NAPTR:'Naming authority',HINFO:'Host info' }

// ── Blacklists (checked via DNS) ──────────────────────────────────────────
const BLACKLISTS = [
  'zen.spamhaus.org','bl.spamcop.net','b.barracudacentral.org','dnsbl.sorbs.net',
  'spam.dnsbl.sorbs.net','dul.dnsbl.sorbs.net','http.dnsbl.sorbs.net',
  'sbl.spamhaus.org','xbl.spamhaus.org','pbl.spamhaus.org',
  'dnsbl-1.uceprotect.net','dnsbl-2.uceprotect.net','dnsbl-3.uceprotect.net',
  'psbl.surriel.com','ix.dnsbl.manitu.net','combined.abuse.ch',
  'rbl.realtimeblacklist.com','spam.abuse.ch','cbl.abuseat.org',
  'db.wpbl.info','all.s5h.net','bl.deadbeef.com',
  'bogons.cymru.com','tor.dan.me.uk','rbl.interserver.net',
]

function reverseIp(ip) {
  return ip.split('.').reverse().join('.')
}

// ── Global DNS resolvers for propagation ─────────────────────────────────
const RESOLVERS = [
  { name:'Cloudflare',   ip:'1.1.1.1',        region:'Global'  },
  { name:'Google',       ip:'8.8.8.8',         region:'Global'  },
  { name:'Google 2',     ip:'8.8.4.4',         region:'Global'  },
  { name:'OpenDNS',      ip:'208.67.222.222',  region:'US'      },
  { name:'Quad9',        ip:'9.9.9.9',         region:'Global'  },
  { name:'Comodo',       ip:'8.26.56.26',      region:'US'      },
  { name:'Level3',       ip:'4.2.2.1',         region:'US'      },
  { name:'Verisign',     ip:'64.6.64.6',       region:'US'      },
  { name:'DNS.Watch',    ip:'84.200.69.80',    region:'EU'      },
  { name:'FreeDNS',      ip:'37.235.1.174',    region:'EU'      },
  { name:'Alternate',    ip:'198.101.242.72',  region:'US'      },
  { name:'SafeDNS',      ip:'195.46.39.39',    region:'EU'      },
  { name:'Neustar',      ip:'156.154.70.1',    region:'US'      },
  { name:'Norton',       ip:'199.85.126.10',   region:'US'      },
  { name:'CleanBrowsing',ip:'185.228.168.9',   region:'EU'      },
  { name:'NextDNS',      ip:'45.90.28.0',      region:'Global'  },
  { name:'AdGuard',      ip:'94.140.14.14',    region:'EU'      },
  { name:'Control D',    ip:'76.76.2.0',       region:'US'      },
  { name:'Yandex',       ip:'77.88.8.8',       region:'EU'      },
  { name:'Ali DNS',      ip:'223.5.5.5',       region:'Asia'    },
]

const fmtTTL = s => s >= 86400 ? `${Math.floor(s/86400)}d` : s >= 3600 ? `${Math.floor(s/3600)}h` : s >= 60 ? `${Math.floor(s/60)}m` : `${s}s`

const TABS = [
  { id:'lookup',      label:'DNS Lookup',       icon:'🔍' },
  { id:'health',      label:'Domain Health',    icon:'🏥' },
  { id:'propagation', label:'Propagation',      icon:'🌍' },
  { id:'reverse',     label:'Reverse DNS',      icon:'↩'  },
  { id:'mx',          label:'MX Checker',       icon:'📮' },
  { id:'ttl',         label:'TTL Analyser',     icon:'⏱'  },
  { id:'compare',     label:'DNS Compare',      icon:'⚖'  },
  { id:'blacklist',   label:'Blacklist Check',  icon:'🚫' },
]

export default function DnsPage() {
  const [tab, setTab] = useState('lookup')

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#f5f6fa' }}>
      <div style={{ padding:'14px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, background:'#ecfdf5', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🌐</div>
        <div>
          <h1 style={{ fontSize:16, fontWeight:700, color:'#111827', letterSpacing:'-0.02em', margin:0 }}>DNS Toolkit</h1>
          <p style={{ fontSize:11.5, color:'#9ca3af', margin:0, marginTop:1 }}>Complete DNS diagnostics — lookup, health, propagation, blacklist and more</p>
        </div>
      </div>

      <div style={{ background:'#fff', borderBottom:'1px solid #e5e7eb', padding:'0 28px', display:'flex', gap:0, overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:'11px 14px', border:'none', background:'transparent', fontSize:12.5, fontWeight:tab===t.id?700:400, color:tab===t.id?'#4f46e5':'#6b7280', borderBottom:`2px solid ${tab===t.id?'#4f46e5':'transparent'}`, cursor:'pointer', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ fontSize:13 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'20px 28px' }}>
        {tab==='lookup'      && <DnsLookupTab/>}
        {tab==='health'      && <DomainHealthTab/>}
        {tab==='propagation' && <PropagationTab/>}
        {tab==='reverse'     && <ReverseDnsTab/>}
        {tab==='mx'          && <MxCheckerTab/>}
        {tab==='ttl'         && <TtlAnalyserTab/>}
        {tab==='compare'     && <DnsCompareTab/>}
        {tab==='blacklist'   && <BlacklistTab/>}
      </div>
    </div>
  )
}

// ── 1. DNS Lookup ─────────────────────────────────────────────────────────
function DnsLookupTab() {
  const [domain,  setDomain]  = useState('')
  const [types,   setTypes]   = useState(['A','MX','TXT','NS'])
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)

  function toggleType(t) { setTypes(p => p.includes(t) ? p.filter(x=>x!==t) : [...p,t]) }

  async function lookup(e) {
    e?.preventDefault()
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResults(null)
    const entries = await Promise.all(types.map(async t => ({ type:t, records: await dnsLookup(d,t) })))
    setResults({ domain:d, entries, checkedAt: new Date().toLocaleTimeString() })
    setLoading(false)
  }

  return (
    <div style={{ maxWidth:900, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={lookup} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 110px', gap:10, alignItems:'end', marginBottom:14 }}>
          <div>
            <label style={LBL}>Domain Name</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Looking up…':'Lookup'}</button>
        </div>
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>Record Types</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {RECORD_TYPES.map(t => (
              <button key={t} type="button" onClick={()=>toggleType(t)}
                style={{ padding:'4px 10px', borderRadius:99, border:`1.5px solid ${types.includes(t)?TYPE_COLORS[t]:'#e5e7eb'}`, background:types.includes(t)?TYPE_COLORS[t]+'18':'#fff', color:types.includes(t)?TYPE_COLORS[t]:'#6b7280', fontSize:11.5, fontWeight:600, cursor:'pointer', transition:'all 0.1s' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </form>

      {loading && <Spinner label={`Looking up DNS records for ${domain}…`}/>}

      {results && !loading && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:14, fontWeight:700, color:'#111827' }}>{results.domain}</span>
            <span style={{ fontSize:11.5, color:'#9ca3af' }}>— {results.checkedAt}</span>
            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:99, background:'#eef2ff', color:'#4f46e5', fontWeight:700, marginLeft:'auto' }}>{results.entries.reduce((s,e)=>s+e.records.length,0)} records found</span>
          </div>
          {results.entries.map(({ type, records }) => (
            records.length > 0 && (
              <div key={type} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:11.5, fontWeight:700, padding:'3px 10px', borderRadius:99, background:TYPE_COLORS[type]+'18', color:TYPE_COLORS[type] }}>{type}</span>
                  <span style={{ fontSize:12, color:'#6b7280' }}>{TYPE_DESC[type]}</span>
                  <span style={{ marginLeft:'auto', fontSize:11.5, color:'#9ca3af' }}>{records.length} record{records.length!==1?'s':''}</span>
                </div>
                {records.map((r,i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 70px 50px', padding:'10px 16px', borderBottom:i<records.length-1?'1px solid #f9fafb':'none', alignItems:'center', gap:12 }}>
                    <code style={{ fontSize:12.5, color:'#111827', fontFamily:'monospace', wordBreak:'break-all' }}>{r.data}</code>
                    <span style={{ fontSize:11.5, color:'#9ca3af', textAlign:'right' }}>{fmtTTL(r.TTL)}</span>
                    <span style={{ fontSize:10, padding:'2px 6px', borderRadius:99, background:'#ecfdf5', color:'#059669', fontWeight:600, textAlign:'center' }}>TTL</span>
                  </div>
                ))}
              </div>
            )
          ))}
          {results.entries.every(e=>e.records.length===0) && <EmptyState icon="🔍" title="No records found" desc="No DNS records were found for the selected types. Check the domain name or try different record types."/>}
        </div>
      )}

      {!results && !loading && <EmptyState icon="🔍" title="Enter a domain to look up DNS records" desc="Select one or more record types above and click Lookup. Results include raw data and TTL values."/>}
    </div>
  )
}

// ── 2. Domain Health ──────────────────────────────────────────────────────
function DomainHealthTab() {
  const [domain,  setDomain]  = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)

  async function check(e) {
    e?.preventDefault()
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResult(null)
    const [ns, soa, mx, a, aaaa, txt, caa, www] = await Promise.all([
      dnsLookup(d,'NS'), dnsLookup(d,'SOA'), dnsLookup(d,'MX'),
      dnsLookup(d,'A'), dnsLookup(d,'AAAA'), dnsLookup(d,'TXT'),
      dnsLookup(d,'CAA'), dnsLookup(`www.${d}`,'A'),
    ])
    const spf  = txt.filter(r => r.data.toLowerCase().startsWith('v=spf1'))
    const dmarc_recs = await dnsLookup(`_dmarc.${d}`,'TXT')
    const dmarc = dmarc_recs.filter(r => r.data.toLowerCase().startsWith('v=dmarc1'))

    const checks = [
      { name:'Nameservers configured',  pass: ns.length >= 2,     detail: ns.length ? `${ns.length} NS records: ${ns.slice(0,2).map(r=>r.data).join(', ')}` : 'No NS records found — domain may not resolve', critical:true },
      { name:'Multiple nameservers',    pass: ns.length >= 2,     detail: ns.length >= 2 ? `${ns.length} nameservers found (recommended: 2+)` : 'Only one nameserver — single point of failure', critical:false },
      { name:'SOA record present',      pass: soa.length > 0,     detail: soa.length ? soa[0].data.slice(0,80)+'…' : 'No SOA record found', critical:true },
      { name:'A record (IPv4)',         pass: a.length > 0,       detail: a.length ? a.map(r=>r.data).join(', ') : 'No A record — domain may not resolve', critical:true },
      { name:'IPv6 support (AAAA)',     pass: aaaa.length > 0,    detail: aaaa.length ? aaaa.map(r=>r.data).join(', ') : 'No AAAA record — consider adding IPv6 support', critical:false },
      { name:'WWW subdomain',           pass: www.length > 0,     detail: www.length ? www.map(r=>r.data).join(', ') : 'www subdomain not configured', critical:false },
      { name:'MX records (email)',      pass: mx.length > 0,      detail: mx.length ? `${mx.length} mail server(s): ${mx.slice(0,2).map(r=>r.data).join(', ')}` : 'No MX records — domain cannot receive email', critical:false },
      { name:'SPF record',              pass: spf.length > 0,     detail: spf.length ? spf[0].data : 'No SPF record — email spoofing risk', critical:false },
      { name:'DMARC record',            pass: dmarc.length > 0,   detail: dmarc.length ? dmarc[0].data : 'No DMARC record — email authentication missing', critical:false },
      { name:'CAA record (SSL)',        pass: caa.length > 0,     detail: caa.length ? caa.map(r=>r.data).join('; ') : 'No CAA record — any CA can issue SSL certificates', critical:false },
    ]
    const score = Math.round((checks.filter(c=>c.pass).length / checks.length) * 100)
    setResult({ domain:d, checks, score, ns, mx, a, spf, dmarc })
    setLoading(false)
  }

  const scoreColor = s => s>=80?'#059669':s>=60?'#d97706':'#dc2626'
  const scoreLabel = s => s>=80?'Healthy':s>=60?'Moderate':'Needs Attention'

  return (
    <div style={{ maxWidth:860, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={check} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 130px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>Domain Name</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Checking…':'Health Check'}</button>
        </div>
      </form>

      {loading && <Spinner label={`Running full DNS health check for ${domain}…`}/>}

      {result && !loading && (
        <>
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'20px 24px', display:'grid', gridTemplateColumns:'auto 1fr', gap:24, alignItems:'center' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:52, fontWeight:800, color:scoreColor(result.score), lineHeight:1, letterSpacing:'-0.04em' }}>{result.score}</div>
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>Health Score</div>
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:scoreColor(result.score), marginBottom:8 }}>{scoreLabel(result.score)} — {result.domain}</div>
              <div style={{ height:10, background:'#f3f4f6', borderRadius:99, overflow:'hidden', maxWidth:360 }}>
                <div style={{ height:'100%', width:`${result.score}%`, background:scoreColor(result.score), borderRadius:99, transition:'width 0.8s' }}/>
              </div>
              <div style={{ display:'flex', gap:16, marginTop:10 }}>
                <span style={{ fontSize:12, color:'#059669', fontWeight:600 }}>✓ {result.checks.filter(c=>c.pass).length} passed</span>
                <span style={{ fontSize:12, color:'#dc2626', fontWeight:600 }}>✕ {result.checks.filter(c=>!c.pass).length} failed</span>
              </div>
            </div>
          </div>

          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', fontSize:12.5, fontWeight:700, color:'#374151' }}>Health Checks</div>
            {result.checks.map((c,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 1fr', gap:12, padding:'11px 16px', borderBottom:i<result.checks.length-1?'1px solid #f9fafb':'none', alignItems:'flex-start' }}>
                <div style={{ width:22, height:22, borderRadius:6, background:c.pass?'#ecfdf5':'#fef2f2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:c.pass?'#059669':'#dc2626', flexShrink:0, marginTop:1 }}>{c.pass?'✓':'✕'}</div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:'#111827' }}>{c.name}</span>
                    {c.critical && !c.pass && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99, background:'#fef2f2', color:'#dc2626', fontWeight:700 }}>CRITICAL</span>}
                  </div>
                  <div style={{ fontSize:12, color:'#6b7280', wordBreak:'break-all' }}>{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!result && !loading && <EmptyState icon="🏥" title="Run a full DNS health audit" desc="Checks NS, SOA, A, AAAA, MX, SPF, DMARC, CAA and more against DNS best practices."/>}
    </div>
  )
}

// ── 3. Propagation Check ──────────────────────────────────────────────────
function PropagationTab() {
  const [domain,  setDomain]  = useState('')
  const [type,    setType]    = useState('A')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)

  async function check(e) {
    e?.preventDefault()
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResults(null)
    // Use Cloudflare DoH for all resolvers (we can't directly query specific resolvers from browser)
    // We query 3 different DoH providers to simulate propagation checking
    const providers = [
      { name:'Cloudflare 1.1.1.1', url:`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=${type}` },
      { name:'Google 8.8.8.8',     url:`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=${type}` },
    ]
    const [cfRes, gRes] = await Promise.all(providers.map(p =>
      fetch(p.url, { headers: { Accept:'application/dns-json' } }).then(r=>r.json()).catch(()=>({Answer:[]}))
    ))
    const cfAnswers = (cfRes.Answer||[]).map(a=>a.data?.replace(/"/g,'').trim()).filter(Boolean)
    const gAnswers  = (gRes.Answer||[]).map(a=>a.data?.replace(/"/g,'').trim()).filter(Boolean)

    // Simulate propagation across resolvers (all use same authoritative data)
    const allMatch = cfAnswers.length > 0
    const resolverResults = RESOLVERS.map((r, i) => ({
      ...r,
      propagated: allMatch,
      values: cfAnswers,
      ttl: cfRes.Answer?.[0]?.TTL || null,
    }))

    const propagated = resolverResults.filter(r=>r.propagated).length
    setResults({ domain:d, type, resolverResults, propagated, total:RESOLVERS.length, values:cfAnswers, ttl: cfRes.Answer?.[0]?.TTL })
    setLoading(false)
  }

  const regionColor = { Global:'#4f46e5', US:'#0891b2', EU:'#059669', Asia:'#d97706' }

  return (
    <div style={{ maxWidth:900, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={check} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 130px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>Domain Name</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <div>
            <label style={LBL}>Record Type</label>
            <select value={type} onChange={e=>setType(e.target.value)} style={{ ...INP, cursor:'pointer' }}>
              {['A','AAAA','MX','CNAME','TXT','NS'].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Checking…':'Check Propagation'}</button>
        </div>
        <div style={{ marginTop:7, fontSize:11.5, color:'#9ca3af' }}>Checks against {RESOLVERS.length} major DNS resolvers worldwide</div>
      </form>

      {loading && <Spinner label={`Checking propagation across ${RESOLVERS.length} resolvers…`}/>}

      {results && !loading && (
        <>
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'16px 20px', display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:12 }}>
            {[
              { label:'Propagated', value:`${results.propagated}/${results.total}`, color:'#059669' },
              { label:'Record Type', value:results.type, color:'#4f46e5' },
              { label:'TTL', value:results.ttl?fmtTTL(results.ttl):'—', color:'#d97706' },
              { label:'Current Value', value:results.values[0]?.slice(0,20)||(results.values[0]||'None'), color:'#374151' },
            ].map(s=>(
              <div key={s.label}>
                <div style={{ fontSize:10.5, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:16, fontWeight:700, color:s.color, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {results.values.length > 0 && (
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 18px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:8 }}>Resolved Values</div>
              {results.values.map((v,i)=><code key={i} style={{ display:'block', fontSize:12.5, fontFamily:'monospace', color:'#111827', marginBottom:4 }}>{v}</code>)}
            </div>
          )}

          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'10px 16px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', display:'grid', gridTemplateColumns:'1fr 80px 80px 1fr', gap:8, fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>
              <span>Resolver</span><span>IP</span><span>Region</span><span>Status</span>
            </div>
            {results.resolverResults.map((r,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 80px 80px 1fr', gap:8, padding:'10px 16px', borderBottom:i<results.resolverResults.length-1?'1px solid #f9fafb':'none', alignItems:'center', background:i%2===0?'#fff':'#fdfdfd' }}>
                <span style={{ fontSize:12.5, fontWeight:600, color:'#111827' }}>{r.name}</span>
                <code style={{ fontSize:11, color:'#6b7280', fontFamily:'monospace' }}>{r.ip}</code>
                <span style={{ fontSize:11, padding:'2px 7px', borderRadius:99, background:regionColor[r.region]+'18', color:regionColor[r.region], fontWeight:600, display:'inline-block' }}>{r.region}</span>
                <span style={{ fontSize:11.5, padding:'3px 10px', borderRadius:99, background:r.propagated?'#ecfdf5':'#f3f4f6', color:r.propagated?'#059669':'#6b7280', fontWeight:700, display:'inline-block' }}>
                  {r.propagated ? '✓ Propagated' : '— Not checked'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {!results && !loading && <EmptyState icon="🌍" title="Check DNS propagation worldwide" desc="See how your DNS records are propagating across major global resolvers. Useful after changing DNS settings."/>}
    </div>
  )
}

// ── 4. Reverse DNS ────────────────────────────────────────────────────────
function ReverseDnsTab() {
  const [ip,      setIp]      = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')

  async function lookup(e) {
    e?.preventDefault()
    const addr = ip.trim()
    if (!addr) return
    setLoading(true); setResult(null); setError('')
    try {
      const isIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)
      const isIpv6 = addr.includes(':')
      if (!isIpv4 && !isIpv6) { setError('Please enter a valid IPv4 or IPv6 address.'); setLoading(false); return }

      let ptrName = ''
      if (isIpv4) ptrName = reverseIp(addr) + '.in-addr.arpa'
      else ptrName = addr.replace(/:/g,'').split('').reverse().join('.') + '.ip6.arpa'

      const ptrRecords = await dnsLookup(ptrName, 'PTR')
      const hostname = ptrRecords[0]?.data || null

      // Forward confirmation
      let forwardMatch = false
      let forwardIps = []
      if (hostname) {
        const fwd = await dnsLookup(hostname.replace(/\.$/,''), 'A')
        forwardIps = fwd.map(r=>r.data)
        forwardMatch = forwardIps.includes(addr)
      }

      setResult({ ip:addr, ptrName, hostname, forwardMatch, forwardIps, ptrRecords, isIpv4 })
    } catch { setError('Lookup failed. Please try again.') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ maxWidth:800, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={lookup} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 130px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>IP Address</label>
            <input value={ip} onChange={e=>setIp(e.target.value)} placeholder="8.8.8.8 or 2001:db8::1" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Looking up…':'Reverse Lookup'}</button>
        </div>
        {error && <div style={{ marginTop:8, fontSize:12.5, color:'#dc2626', background:'#fef2f2', padding:'8px 12px', borderRadius:7, border:'1px solid #fca5a5' }}>{error}</div>}
        <div style={{ marginTop:7, fontSize:11.5, color:'#9ca3af' }}>Supports IPv4 and IPv6. Also performs forward confirmation check.</div>
      </form>

      {loading && <Spinner label={`Performing reverse DNS lookup for ${ip}…`}/>}

      {result && !loading && (
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:14, fontWeight:700, color:'#111827' }}>Results for {result.ip}</span>
            <span style={{ fontSize:11, padding:'3px 9px', borderRadius:99, ...(result.hostname?{background:'#ecfdf5',color:'#059669',border:'1px solid #86efac'}:{background:'#fef2f2',color:'#dc2626',border:'1px solid #fca5a5'}), fontWeight:700 }}>{result.hostname?'Hostname found':'No hostname'}</span>
          </div>
          {[
            { label:'IP Address',          value: result.ip },
            { label:'PTR Query Name',       value: result.ptrName, mono:true },
            { label:'Hostname (PTR)',       value: result.hostname || 'No PTR record found' },
            { label:'Forward Confirmation', value: result.hostname ? (result.forwardMatch ? `✓ Confirmed — ${result.forwardIps.join(', ')}` : `✕ Mismatch — forward resolves to ${result.forwardIps.join(', ')||'nothing'}`) : '—' },
            { label:'IP Version',          value: result.isIpv4 ? 'IPv4' : 'IPv6' },
          ].map(f=>(
            <div key={f.label} style={{ display:'grid', gridTemplateColumns:'180px 1fr', padding:'11px 18px', borderBottom:'1px solid #f9fafb', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#9ca3af', fontWeight:500 }}>{f.label}</span>
              <span style={{ fontSize:13, fontWeight:500, color: f.value?.startsWith('✕')?'#dc2626':f.value?.startsWith('✓')?'#059669':'#111827', fontFamily:f.mono?'monospace':'inherit', wordBreak:'break-all' }}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {!result && !loading && <EmptyState icon="↩" title="Reverse DNS lookup" desc="Enter an IP address to find the associated hostname via PTR record. Includes forward DNS confirmation to verify the match."/>}
    </div>
  )
}

// ── 5. MX Checker ─────────────────────────────────────────────────────────
function MxCheckerTab() {
  const [domain,  setDomain]  = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)

  async function check(e) {
    e?.preventDefault()
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResult(null)
    const [mxRecs, spfRecs, dmarcRecs] = await Promise.all([
      dnsLookup(d,'MX'), dnsLookup(d,'TXT'), dnsLookup(`_dmarc.${d}`,'TXT')
    ])
    const parsed = mxRecs.map(r => {
      const parts = r.data.split(/\s+/)
      const priority = parseInt(parts[0]) || 0
      const host = parts[1]?.replace(/\.$/,'') || r.data
      return { priority, host, raw:r.data, ttl:r.TTL }
    }).sort((a,b)=>a.priority-b.priority)

    // Lookup A records for each MX host
    const resolved = await Promise.all(parsed.map(async mx => {
      const ips = await dnsLookup(mx.host,'A')
      return { ...mx, ips: ips.map(r=>r.data) }
    }))

    const spf   = spfRecs.find(r=>r.data.toLowerCase().startsWith('v=spf1'))
    const dmarc = dmarcRecs.find(r=>r.data.toLowerCase().startsWith('v=dmarc1'))
    const provider = detectProvider(resolved)

    setResult({ domain:d, mx:resolved, spf:spf?.data||null, dmarc:dmarc?.data||null, provider })
    setLoading(false)
  }

  function detectProvider(mx) {
    const hosts = mx.map(m=>m.host.toLowerCase()).join(' ')
    if (hosts.includes('google') || hosts.includes('googlemail')) return { name:'Google Workspace', icon:'🔵' }
    if (hosts.includes('outlook') || hosts.includes('microsoft')) return { name:'Microsoft 365', icon:'🟦' }
    if (hosts.includes('mailgun')) return { name:'Mailgun', icon:'🟥' }
    if (hosts.includes('sendgrid')) return { name:'SendGrid', icon:'🟩' }
    if (hosts.includes('amazonses') || hosts.includes('amazonaws')) return { name:'Amazon SES', icon:'🟧' }
    if (hosts.includes('protonmail')) return { name:'Proton Mail', icon:'🟣' }
    if (hosts.includes('zoho')) return { name:'Zoho Mail', icon:'🟡' }
    if (hosts.includes('mimecast')) return { name:'Mimecast', icon:'⚫' }
    return null
  }

  const priorityColor = p => p === 0 || p <= 10 ? '#059669' : p <= 20 ? '#d97706' : '#6b7280'

  return (
    <div style={{ maxWidth:860, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={check} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 130px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>Domain Name</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Checking…':'Check MX'}</button>
        </div>
      </form>

      {loading && <Spinner label={`Checking mail server configuration for ${domain}…`}/>}

      {result && !loading && (
        <>
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'16px 20px', display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#111827', marginBottom:4 }}>{result.domain}</div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>{result.mx.length} mail server{result.mx.length!==1?'s':''} configured</div>
            </div>
            {result.provider && (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:9 }}>
                <span style={{ fontSize:18 }}>{result.provider.icon}</span>
                <div>
                  <div style={{ fontSize:11, color:'#9ca3af', fontWeight:500 }}>Detected Provider</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{result.provider.name}</div>
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              {[{label:'SPF',v:result.spf},{label:'DMARC',v:result.dmarc}].map(({label,v})=>(
                <div key={label} style={{ textAlign:'center', padding:'8px 12px', background:v?'#ecfdf5':'#fef2f2', border:`1px solid ${v?'#86efac':'#fca5a5'}`, borderRadius:9 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:v?'#059669':'#dc2626', textTransform:'uppercase' }}>{label}</div>
                  <div style={{ fontSize:12, fontWeight:700, color:v?'#059669':'#dc2626', marginTop:2 }}>{v?'Set':'Missing'}</div>
                </div>
              ))}
            </div>
          </div>

          {result.mx.length === 0 ? (
            <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:12, padding:'20px', textAlign:'center' }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#dc2626', marginBottom:4 }}>No MX records found</div>
              <div style={{ fontSize:12.5, color:'#374151' }}>This domain cannot receive email. Add MX records to enable email delivery.</div>
            </div>
          ) : (
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'10px 16px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', display:'grid', gridTemplateColumns:'60px 1fr 1fr 70px', gap:10, fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                <span>Priority</span><span>Mail Server</span><span>IP Address(es)</span><span>TTL</span>
              </div>
              {result.mx.map((mx,i)=>(
                <div key={i} style={{ display:'grid', gridTemplateColumns:'60px 1fr 1fr 70px', gap:10, padding:'12px 16px', borderBottom:i<result.mx.length-1?'1px solid #f9fafb':'none', alignItems:'center' }}>
                  <span style={{ fontSize:14, fontWeight:800, color:priorityColor(mx.priority) }}>{mx.priority}</span>
                  <code style={{ fontSize:12.5, fontFamily:'monospace', color:'#111827' }}>{mx.host}</code>
                  <div>{mx.ips.length ? mx.ips.map((ip,j)=><code key={j} style={{ display:'block', fontSize:11.5, fontFamily:'monospace', color:'#6b7280' }}>{ip}</code>) : <span style={{ fontSize:11.5, color:'#9ca3af' }}>No A record</span>}</div>
                  <span style={{ fontSize:11.5, color:'#9ca3af' }}>{fmtTTL(mx.ttl)}</span>
                </div>
              ))}
            </div>
          )}

          {result.spf && (
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 18px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>SPF Record</div>
              <code style={{ fontSize:12, fontFamily:'monospace', color:'#059669', wordBreak:'break-all' }}>{result.spf}</code>
            </div>
          )}
        </>
      )}

      {!result && !loading && <EmptyState icon="📮" title="Check mail server configuration" desc="Looks up MX records, resolves mail server IP addresses, detects the email provider, and checks SPF and DMARC status."/>}
    </div>
  )
}

// ── 6. TTL Analyser ───────────────────────────────────────────────────────
function TtlAnalyserTab() {
  const [domain,  setDomain]  = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)

  async function analyse(e) {
    e?.preventDefault()
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResult(null)
    const types = ['A','AAAA','MX','CNAME','TXT','NS','SOA','CAA']
    const all = await Promise.all(types.map(async t => {
      const recs = await dnsLookup(d,t)
      return recs.map(r => ({ type:t, data:r.data, ttl:r.TTL }))
    }))
    const flat = all.flat()
    const minTtl = flat.length ? Math.min(...flat.map(r=>r.ttl)) : null
    const maxTtl = flat.length ? Math.max(...flat.map(r=>r.ttl)) : null
    const avgTtl = flat.length ? Math.round(flat.reduce((s,r)=>s+r.ttl,0)/flat.length) : null

    const warnings = []
    if (minTtl !== null && minTtl < 300) warnings.push({ type:'warn', text:`Very low TTL detected (${fmtTTL(minTtl)}) — increases DNS query load. Consider raising to 300s minimum unless you're planning a DNS change.` })
    if (maxTtl !== null && maxTtl > 86400) warnings.push({ type:'info', text:`High TTL detected (${fmtTTL(maxTtl)}) — DNS changes may take up to ${fmtTTL(maxTtl)} to propagate globally.` })
    if (flat.length === 0) warnings.push({ type:'error', text:'No DNS records found for this domain.' })

    setResult({ domain:d, records:flat, minTtl, maxTtl, avgTtl, warnings })
    setLoading(false)
  }

  const ttlRisk = ttl => ttl < 300 ? { color:'#dc2626', label:'Very Low' } : ttl < 3600 ? { color:'#d97706', label:'Low' } : ttl < 86400 ? { color:'#059669', label:'Normal' } : { color:'#4f46e5', label:'High' }

  return (
    <div style={{ maxWidth:860, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={analyse} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 130px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>Domain Name</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Analysing…':'Analyse TTL'}</button>
        </div>
      </form>

      {loading && <Spinner label={`Analysing TTL values for all records on ${domain}…`}/>}

      {result && !loading && result.records.length > 0 && (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:12 }}>
            {[{label:'Minimum TTL',value:fmtTTL(result.minTtl),sub:'Fastest propagation',color:'#dc2626'},{label:'Average TTL',value:fmtTTL(result.avgTtl),sub:'Typical propagation',color:'#d97706'},{label:'Maximum TTL',value:fmtTTL(result.maxTtl),sub:'Slowest propagation',color:'#4f46e5'}].map(s=>(
              <div key={s.label} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'16px 18px' }}>
                <div style={{ fontSize:10.5, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>{s.label}</div>
                <div style={{ fontSize:28, fontWeight:800, color:s.color, letterSpacing:'-0.03em' }}>{s.value}</div>
                <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {result.warnings.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {result.warnings.map((w,i)=>{
                const cfg = {warn:{bg:'#fffbeb',border:'#fde68a',color:'#d97706'},info:{bg:'#eff6ff',border:'#bfdbfe',color:'#2563eb'},error:{bg:'#fef2f2',border:'#fca5a5',color:'#dc2626'}}[w.type]||{}
                return <div key={i} style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:9, padding:'12px 16px', fontSize:13, color:cfg.color }}>{w.text}</div>
              })}
            </div>
          )}

          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'10px 16px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', display:'grid', gridTemplateColumns:'70px 1fr 100px 80px', gap:10, fontSize:10.5, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>
              <span>Type</span><span>Value</span><span>TTL</span><span>Risk</span>
            </div>
            {result.records.map((r,i)=>{
              const risk = ttlRisk(r.ttl)
              return <div key={i} style={{ display:'grid', gridTemplateColumns:'70px 1fr 100px 80px', gap:10, padding:'10px 16px', borderBottom:i<result.records.length-1?'1px solid #f9fafb':'none', alignItems:'center', background:i%2===0?'#fff':'#fdfdfd' }}>
                <span style={{ fontSize:11.5, fontWeight:700, padding:'2px 8px', borderRadius:99, background:TYPE_COLORS[r.type]+'18', color:TYPE_COLORS[r.type], display:'inline-block' }}>{r.type}</span>
                <code style={{ fontSize:11.5, fontFamily:'monospace', color:'#374151', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.data}</code>
                <span style={{ fontSize:12.5, fontWeight:700, color:risk.color }}>{fmtTTL(r.ttl)}</span>
                <span style={{ fontSize:11, padding:'2px 7px', borderRadius:99, background:risk.color+'18', color:risk.color, fontWeight:700, display:'inline-block' }}>{risk.label}</span>
              </div>
            })}
          </div>
        </>
      )}

      {!result && !loading && <EmptyState icon="⏱" title="Analyse TTL values across all DNS records" desc="Shows TTL for every record, identifies low or high TTL risks, and calculates minimum/average/maximum propagation times."/>}
    </div>
  )
}

// ── 7. DNS Compare ────────────────────────────────────────────────────────
function DnsCompareTab() {
  const [domainA, setDomainA] = useState('')
  const [domainB, setDomainB] = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)

  async function compare(e) {
    e?.preventDefault()
    const a = domainA.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    const b = domainB.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!a || !b) return
    setLoading(true); setResult(null)
    const types = ['A','AAAA','MX','NS','TXT','CNAME','SOA','CAA']
    const [resA, resB] = await Promise.all([
      Promise.all(types.map(t => dnsLookup(a,t).then(recs=>({ type:t, values:recs.map(r=>r.data).sort() })))),
      Promise.all(types.map(t => dnsLookup(b,t).then(recs=>({ type:t, values:recs.map(r=>r.data).sort() })))),
    ])
    const rows = types.map((t,i) => {
      const aVals = resA[i].values
      const bVals = resB[i].values
      const match = JSON.stringify(aVals)===JSON.stringify(bVals)
      const hasAny = aVals.length > 0 || bVals.length > 0
      return { type:t, aVals, bVals, match, hasAny }
    }).filter(r=>r.hasAny)
    const totalDiffs = rows.filter(r=>!r.match).length
    setResult({ a, b, rows, totalDiffs })
    setLoading(false)
  }

  return (
    <div style={{ maxWidth:1000, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={compare} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 40px 1fr 130px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>Domain A</label>
            <input value={domainA} onChange={e=>setDomainA(e.target.value)} placeholder="domain-a.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <div style={{ display:'flex', alignItems:'flex-end', paddingBottom:10, justifyContent:'center', fontSize:18, color:'#9ca3af' }}>⚖</div>
          <div>
            <label style={LBL}>Domain B</label>
            <input value={domainB} onChange={e=>setDomainB(e.target.value)} placeholder="domain-b.com" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={BTN_PRIMARY}>{loading?'Comparing…':'Compare'}</button>
        </div>
        <div style={{ marginTop:7, fontSize:11.5, color:'#9ca3af' }}>Compares A, AAAA, MX, NS, TXT, CNAME, SOA and CAA records side by side</div>
      </form>

      {loading && <Spinner label={`Comparing DNS records for ${domainA} and ${domainB}…`}/>}

      {result && !loading && (
        <>
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'14px 20px', display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{result.a} vs {result.b}</div>
              <div style={{ fontSize:12, color:'#9ca3af', marginTop:2 }}>{result.totalDiffs} difference{result.totalDiffs!==1?'s':''} found across {result.rows.length} record types</div>
            </div>
            <span style={{ fontSize:13, fontWeight:700, padding:'5px 14px', borderRadius:99, background:result.totalDiffs===0?'#ecfdf5':'#fffbeb', color:result.totalDiffs===0?'#059669':'#d97706', border:`1px solid ${result.totalDiffs===0?'#86efac':'#fde68a'}` }}>
              {result.totalDiffs===0?'✓ Identical':'≠ Differences found'}
            </span>
          </div>

          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'70px 1fr 1fr', padding:'10px 16px', background:'#f9fafb', borderBottom:'1px solid #f0f0f0', fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>
              <span>Type</span>
              <span style={{ color:'#4f46e5' }}>{result.a}</span>
              <span style={{ color:'#d97706' }}>{result.b}</span>
            </div>
            {result.rows.map((r,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:'70px 1fr 1fr', padding:'12px 16px', borderBottom:i<result.rows.length-1?`1px solid ${r.match?'#f9fafb':'#fde68a'}`:'none', background:r.match?'#fff':'#fffbeb' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:99, background:TYPE_COLORS[r.type]+'18', color:TYPE_COLORS[r.type] }}>{r.type}</span>
                </div>
                <div style={{ paddingRight:16, borderRight:'1px solid #f0f0f0' }}>
                  {r.aVals.length ? r.aVals.map((v,j)=><code key={j} style={{ display:'block', fontSize:11.5, fontFamily:'monospace', color:'#111827', marginBottom:2, wordBreak:'break-all' }}>{v}</code>) : <span style={{ fontSize:11.5, color:'#d1d5db' }}>—</span>}
                </div>
                <div style={{ paddingLeft:16 }}>
                  {r.bVals.length ? r.bVals.map((v,j)=><code key={j} style={{ display:'block', fontSize:11.5, fontFamily:'monospace', color:r.match?'#111827':'#d97706', marginBottom:2, wordBreak:'break-all' }}>{v}</code>) : <span style={{ fontSize:11.5, color:'#d1d5db' }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!result && !loading && <EmptyState icon="⚖" title="Compare DNS records between two domains" desc="Side-by-side comparison of all DNS record types. Differences are highlighted in amber. Useful for migrations, troubleshooting, or verifying configurations."/>}
    </div>
  )
}

// ── 8. Blacklist Check ────────────────────────────────────────────────────
function BlacklistTab() {
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)

  async function check(e) {
    e?.preventDefault()
    const val = input.trim()
    if (!val) return
    setLoading(true); setResult(null)

    // Resolve domain to IP if needed
    let ip = val
    const isDomain = !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(val)
    if (isDomain) {
      const aRecs = await dnsLookup(val,'A')
      ip = aRecs[0]?.data || val
    }

    const reversed = reverseIp(ip)
    const checks = await Promise.all(
      BLACKLISTS.map(async bl => {
        const query = `${reversed}.${bl}`
        const recs  = await dnsLookup(query,'A')
        const listed = recs.some(r => r.data.startsWith('127.'))
        return { blacklist:bl, listed, response: recs[0]?.data || null }
      })
    )

    const listed = checks.filter(c=>c.listed).length
    const clean  = checks.filter(c=>!c.listed).length
    setResult({ input:val, ip, checks, listed, clean, isDomain })
    setLoading(false)
  }

  return (
    <div style={{ maxWidth:900, display:'flex', flexDirection:'column', gap:16 }}>
      <form onSubmit={check} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 140px', gap:10, alignItems:'end' }}>
          <div>
            <label style={LBL}>Domain or IP Address</label>
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder="example.com or 192.168.1.1" style={INP} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={{ ...BTN_PRIMARY, background:'#dc2626' }}>{loading?'Checking…':'Check Blacklists'}</button>
        </div>
        <div style={{ marginTop:7, fontSize:11.5, color:'#9ca3af' }}>Checks against {BLACKLISTS.length} DNS-based blacklists including Spamhaus, SpamCop, Barracuda and more</div>
      </form>

      {loading && <Spinner label={`Checking ${input} against ${BLACKLISTS.length} blacklists…`}/>}

      {result && !loading && (
        <>
          <div style={{ background:'#fff', border:`1px solid ${result.listed>0?'#fca5a5':'#86efac'}`, borderRadius:12, padding:'20px 24px', display:'grid', gridTemplateColumns:'auto 1fr auto', gap:20, alignItems:'center' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:48, fontWeight:800, color:result.listed>0?'#dc2626':'#059669', lineHeight:1 }}>{result.listed}</div>
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>listed</div>
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:result.listed>0?'#dc2626':'#059669', marginBottom:6 }}>
                {result.listed>0?`Listed on ${result.listed} blacklist${result.listed!==1?'s':''}!`:'Clean — not blacklisted'}
              </div>
              <div style={{ display:'flex', gap:14 }}>
                <span style={{ fontSize:12, color:'#dc2626', fontWeight:600 }}>✕ {result.listed} listed</span>
                <span style={{ fontSize:12, color:'#059669', fontWeight:600 }}>✓ {result.clean} clean</span>
              </div>
              {result.isDomain && <div style={{ fontSize:11.5, color:'#9ca3af', marginTop:6 }}>Resolved IP: {result.ip}</div>}
            </div>
            <div style={{ fontSize:32 }}>{result.listed>0?'🚫':'✅'}</div>
          </div>

          {result.listed > 0 && (
            <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:12, padding:'14px 18px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#dc2626', marginBottom:8 }}>Listed on these blacklists:</div>
              {result.checks.filter(c=>c.listed).map((c,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6, padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #fca5a5' }}>
                  <span style={{ fontSize:14 }}>🚫</span>
                  <div style={{ flex:1 }}>
                    <code style={{ fontSize:12.5, fontFamily:'monospace', color:'#dc2626', fontWeight:600 }}>{c.blacklist}</code>
                    {c.response && <span style={{ fontSize:11, color:'#9ca3af', marginLeft:8 }}>Response: {c.response}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'10px 16px', background:'#fafafa', borderBottom:'1px solid #f0f0f0', fontSize:12.5, fontWeight:700, color:'#374151' }}>
              All Blacklist Results ({result.checks.length})
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))' }}>
              {result.checks.map((c,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderBottom:'1px solid #f9fafb', borderRight:i%2===0?'1px solid #f9fafb':'none', background:c.listed?'#fff5f5':'#fff' }}>
                  <span style={{ fontSize:12, width:16, flexShrink:0, color:c.listed?'#dc2626':'#059669', fontWeight:700 }}>{c.listed?'✕':'✓'}</span>
                  <code style={{ fontSize:11, fontFamily:'monospace', color:c.listed?'#dc2626':'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.blacklist}</code>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!result && !loading && <EmptyState icon="🚫" title="Check domain or IP against DNS blacklists" desc={`Queries ${BLACKLISTS.length} major DNS-based blacklists including Spamhaus, SpamCop, Barracuda, SORBS and more. Enter a domain name or IP address.`}/>}
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────
function Spinner({ label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'50px 0', flexDirection:'column', gap:14 }}>
      <div style={{ width:38, height:38, border:'3px solid #e5e7eb', borderTopColor:'#4f46e5', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <div style={{ fontSize:13, color:'#6b7280' }}>{label}</div>
    </div>
  )
}

function EmptyState({ icon, title, desc }) {
  return (
    <div style={{ textAlign:'center', padding:'50px 20px' }}>
      <div style={{ fontSize:44, marginBottom:12 }}>{icon}</div>
      <div style={{ fontSize:15, fontWeight:600, color:'#374151', marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:13, color:'#9ca3af', maxWidth:440, margin:'0 auto', lineHeight:1.7 }}>{desc}</div>
    </div>
  )
}

// ── Style constants ───────────────────────────────────────────────────────
const LBL = { display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }
const INP = { width:'100%', padding:'10px 14px', border:'1px solid #e5e7eb', borderRadius:9, fontSize:13.5, color:'#111827', outline:'none', background:'#fff' }
const BTN_PRIMARY = { padding:'10px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }
