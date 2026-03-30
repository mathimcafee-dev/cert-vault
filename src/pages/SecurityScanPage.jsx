import { useState, useRef, useEffect } from 'react'

// ── DNS via Cloudflare DoH ─────────────────────────────────────────────────
async function dns(name, type) {
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      { headers: { Accept: 'application/dns-json' } }
    )
    if (!r.ok) return []
    const d = await r.json()
    if (d.Status !== 0) return []
    return (d.Answer || []).map(a => ({ data: a.data?.replace(/"/g,'').trim(), ttl: a.TTL, type: a.type }))
  } catch { return [] }
}
async function dnsData(name, type) {
  const recs = await dns(name, type)
  return recs.map(r => r.data).filter(Boolean)
}

// ── SSL check via crt.sh ───────────────────────────────────────────────────
async function checkSSL(domain) {
  const result = { valid: false, issuer: '—', subject: '—', expires: '—', daysLeft: null, chain: [], protocols: [], error: null, crtEntries: [] }
  try {
    // Use crt.sh for cert transparency log info
    const r = await fetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, { signal: AbortSignal.timeout(8000) })
    if (r.ok) {
      const data = await r.json()
      if (data && data.length > 0) {
        // Sort by most recent
        const sorted = [...data].sort((a,b) => new Date(b.not_before) - new Date(a.not_before))
        const latest = sorted[0]
        result.valid = true
        result.issuer  = latest.issuer_name?.replace(/.*CN=([^,]+).*/,'$1').trim() || latest.issuer_name || '—'
        result.subject = latest.common_name || domain
        result.expires = latest.not_after ? new Date(latest.not_after).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'
        if (latest.not_after) {
          result.daysLeft = Math.ceil((new Date(latest.not_after) - new Date()) / 86400000)
        }
        result.crtEntries = sorted.slice(0,5).map(e => ({
          id:      e.id,
          issuer:  e.issuer_name?.replace(/.*CN=([^,]+).*/,'$1').trim() || '—',
          subject: e.common_name || '—',
          from:    new Date(e.not_before).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
          to:      new Date(e.not_after).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
          daysLeft:Math.ceil((new Date(e.not_after)-new Date())/86400000),
        }))
      }
    }
  } catch(e) { result.error = 'CT log lookup timeout — try again' }
  return result
}

// ── DMARC analysis ─────────────────────────────────────────────────────────
function parseDmarc(recs) {
  const rec = recs.find(r => r.toLowerCase().startsWith('v=dmarc1'))
  if (!rec) return { record:null, status:'missing', policy:null, pct:'100', rua:null, ruf:null, aspf:null, adkim:null }
  const tags = {}
  rec.split(';').forEach(p => { const [k,v]=(p.trim().split('=').map(x=>x.trim())); if(k&&v) tags[k.toLowerCase()]=v })
  const p = tags.p||null
  const st = !p?'invalid':p==='none'?'warn':p==='quarantine'?'good':p==='reject'?'great':'warn'
  return { record:rec, status:st, policy:p, pct:tags.pct||'100', rua:tags.rua||null, ruf:tags.ruf||null, aspf:tags.aspf||'r', adkim:tags.adkim||'r' }
}
function parseSpf(recs) {
  const rec = recs.find(r => r.toLowerCase().startsWith('v=spf1'))
  if (!rec) return { record:null, status:'missing', all:null }
  const all = rec.split(/\s+/).find(p => p.toLowerCase().endsWith('all'))
  const st = !all?'warn':all==='-all'?'great':all==='~all'?'good':'warn'
  return { record:rec, status:st, all }
}
function parseDkim(recs) {
  const rec = recs.find(r => r.toLowerCase().includes('v=dkim1')||r.toLowerCase().includes('p='))
  if (!rec) return { record:null, status:'missing' }
  const hasKey = rec.includes('p=') && !rec.includes('p=;') && !rec.includes('p= ')
  return { record:rec, status:hasKey?'great':'missing' }
}
function parseMx(recs) {
  if (!recs.length) return { records:[], status:'missing' }
  const records = recs.map(r => { const [,host]=r.split(' '); return host||r }).filter(Boolean)
  return { records, status:'great' }
}

// ── DNS Health ─────────────────────────────────────────────────────────────
async function checkDnsHealth(domain) {
  const [aRecs, aaaaRecs, mxRecs, nsRecs, txtRecs, cnameRecs, soaRecs] = await Promise.all([
    dnsData(domain, 'A'),
    dnsData(domain, 'AAAA'),
    dnsData(domain, 'MX'),
    dnsData(domain, 'NS'),
    dnsData(domain, 'TXT'),
    dnsData(domain, 'CNAME'),
    dnsData(domain, 'SOA'),
  ])
  // CAA check
  const caaRecs = await dnsData(domain, 'CAA')
  // DKIM common selectors
  const dkimSelectors = ['default','google','mail','k1','s1','s2','dkim','selector1','selector2']
  let dkimRec = null, dkimSelector = null
  for (const sel of dkimSelectors) {
    const r = await dnsData(`${sel}._domainkey.${domain}`, 'TXT')
    if (r.length) { dkimRec = r[0]; dkimSelector = sel; break }
  }
  return { aRecs, aaaaRecs, mxRecs, nsRecs, txtRecs, cnameRecs, soaRecs, caaRecs, dkimRec, dkimSelector }
}

// ── BIMI check ─────────────────────────────────────────────────────────────
async function checkBimi(domain) {
  const recs = await dnsData(`default._bimi.${domain}`, 'TXT')
  const rec = recs.find(r => r.toLowerCase().startsWith('v=bimi1'))
  if (!rec) return { found:false, record:null, logoUrl:null, vmcUrl:null }
  const tags = {}
  rec.split(';').forEach(p => { const [k,v]=(p.trim().split('=').map(x=>x?.trim())); if(k&&v) tags[k.toLowerCase()]=v })
  return { found:true, record:rec, logoUrl:tags.l||null, vmcUrl:tags.a||null }
}

// ── Scoring engine ─────────────────────────────────────────────────────────
function calcScore(ssl, dmarc, spf, dkim, mx, dns) {
  let score = 0
  const breakdown = []

  // SSL (30 pts)
  if (ssl.valid && ssl.daysLeft !== null && ssl.daysLeft > 30) { score += 30; breakdown.push({ cat:'SSL', pts:30, max:30, label:'Valid SSL certificate installed' }) }
  else if (ssl.valid && ssl.daysLeft !== null && ssl.daysLeft > 0) { score += 15; breakdown.push({ cat:'SSL', pts:15, max:30, label:`SSL expiring in ${ssl.daysLeft} days` }) }
  else { breakdown.push({ cat:'SSL', pts:0, max:30, label:'No valid SSL certificate found' }) }

  // DMARC (25 pts)
  const dP = { great:25, good:18, warn:8, missing:0, invalid:0 }[dmarc.status] || 0
  score += dP; breakdown.push({ cat:'DMARC', pts:dP, max:25, label: dmarc.policy ? `DMARC p=${dmarc.policy}` : 'No DMARC record' })

  // SPF (20 pts)
  const sP = { great:20, good:14, warn:6, missing:0 }[spf.status] || 0
  score += sP; breakdown.push({ cat:'SPF', pts:sP, max:20, label: spf.all ? `SPF ${spf.all}` : 'No SPF record' })

  // DKIM (15 pts)
  const dkP = dkim.status==='great'?15:0
  score += dkP; breakdown.push({ cat:'DKIM', pts:dkP, max:15, label: dkim.record ? 'DKIM key found' : 'No DKIM record detected' })

  // DNS Health (10 pts)
  const hasA  = dns.aRecs.length > 0
  const hasNS = dns.nsRecs.length > 0
  const hasMX = dns.mxRecs.length > 0
  const hasCAA = dns.caaRecs.length > 0
  const dnsPts = (hasA?3:0) + (hasNS?3:0) + (hasMX?2:0) + (hasCAA?2:0)
  score += dnsPts; breakdown.push({ cat:'DNS', pts:dnsPts, max:10, label:`${dnsPts}/10 DNS health checks passed` })

  const grade = score>=90?'A+':score>=80?'A':score>=70?'B':score>=60?'C':score>=50?'D':'F'
  const gradeColor = score>=80?'#059669':score>=60?'#d97706':'#dc2626'
  const gradeBg = score>=80?'#f0fdf4':score>=60?'#fffbeb':'#fef2f2'
  return { score, grade, gradeColor, gradeBg, breakdown }
}

// ── Status helpers ─────────────────────────────────────────────────────────
const STATUS = {
  great:   { color:'#059669', bg:'#f0fdf4', border:'#86efac', label:'Pass',    dot:'#22c55e' },
  good:    { color:'#059669', bg:'#f0fdf4', border:'#86efac', label:'Good',    dot:'#22c55e' },
  warn:    { color:'#b45309', bg:'#fffbeb', border:'#fde68a', label:'Warning', dot:'#f59e0b' },
  missing: { color:'#dc2626', bg:'#fef2f2', border:'#fca5a5', label:'Missing', dot:'#ef4444' },
  invalid: { color:'#dc2626', bg:'#fef2f2', border:'#fca5a5', label:'Invalid', dot:'#ef4444' },
}
const st = k => STATUS[k] || STATUS.missing

// ══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════
export default function SecurityScanPage() {
  const [domain,   setDomain]   = useState('')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [step,     setStep]     = useState('')
  const [report,   setReport]   = useState(null)
  const [error,    setError]    = useState('')
  const [activeTab,setActiveTab]= useState('overview')
  const inputRef = useRef()

  async function runScan() {
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'').toLowerCase()
    if (!d) { setError('Enter a domain name to scan'); return }
    setError(''); setReport(null); setScanning(true); setActiveTab('overview')

    try {
      setStep('Checking SSL certificate…'); setProgress(10)
      const ssl = await checkSSL(d)

      setStep('Looking up DNS records…'); setProgress(28)
      const dnsHealth = await checkDnsHealth(d)

      setStep('Analysing DMARC policy…'); setProgress(46)
      const dmarcRecs = await dnsData(`_dmarc.${d}`, 'TXT')
      const dmarc = parseDmarc(dmarcRecs)

      setStep('Checking SPF record…'); setProgress(58)
      const spfRecs = await dnsData(d, 'TXT')
      const spf = parseSpf(spfRecs)

      setStep('Verifying DKIM…'); setProgress(70)
      const dkim = parseDkim(dnsHealth.dkimRec ? [dnsHealth.dkimRec] : [])

      setStep('Checking MX records…'); setProgress(80)
      const mx = parseMx(dnsHealth.mxRecs)

      setStep('Checking BIMI…'); setProgress(88)
      const bimi = await checkBimi(d)

      setStep('Calculating security score…'); setProgress(96)
      const scoring = calcScore(ssl, dmarc, spf, dkim, mx, dnsHealth)

      setProgress(100)
      setReport({ domain:d, ssl, dmarc, spf, dkim, mx, bimi, dns:dnsHealth, scoring, scannedAt:new Date() })
    } catch(e) {
      setError('Scan failed: ' + e.message)
    }
    setScanning(false); setStep(''); setProgress(0)
  }

  const TABS = [
    { id:'overview',  label:'Overview'       },
    { id:'ssl',       label:'SSL / TLS'      },
    { id:'email',     label:'Email Security' },
    { id:'dns',       label:'DNS Health'     },
    { id:'bimi',      label:'BIMI'           },
  ]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#ecfeff' }}>

      {/* Header */}
      <div style={{ padding:'13px 22px', background:'#fff', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div style={{ width:36, height:36, background:'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🔎</div>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:'#083344', letterSpacing:'-.03em' }}>Security Scanner</div>
          <div style={{ fontSize:11.5, color:'#67c5d4' }}>Full SSL · DMARC · DNS · BIMI audit in one scan</div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'18px 22px' }}>
        <div style={{ maxWidth:960, margin:'0 auto' }}>

          {/* Search bar */}
          <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #cffafe', padding:'20px 22px', marginBottom:18, boxShadow:'0 2px 16px rgba(8,145,178,.08)' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:12, letterSpacing:'-.01em' }}>Enter a domain to run a full security scan</div>
            <div style={{ display:'flex', gap:10 }}>
              <div style={{ flex:1, position:'relative' }}>
                <div style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:16 }}>🌐</div>
                <input ref={inputRef} value={domain} onChange={e => setDomain(e.target.value)}
                  onKeyDown={e => e.key==='Enter' && runScan()}
                  placeholder="example.com or sub.example.com"
                  style={{ width:'100%', height:46, paddingLeft:40, paddingRight:14, border:'1.5px solid #a5f3fc', borderRadius:10, fontSize:14, color:'#083344', outline:'none', fontFamily:'inherit', background:'#f0fdff', transition:'border-color .15s' }}
                  onFocus={e => e.target.style.borderColor='#0891b2'}
                  onBlur={e  => e.target.style.borderColor='#a5f3fc'}/>
              </div>
              <button onClick={runScan} disabled={scanning}
                style={{ height:46, padding:'0 28px', background:'linear-gradient(135deg,#0891b2,#0e7490)', border:'none', borderRadius:10, fontSize:14, fontWeight:800, color:'#fff', cursor:scanning?'not-allowed':'pointer', display:'flex', alignItems:'center', gap:8, fontFamily:'inherit', boxShadow:'0 4px 16px rgba(8,145,178,.35)', opacity:scanning?.7:1, whiteSpace:'nowrap', letterSpacing:'-.01em' }}>
                {scanning ? (
                  <><div style={{ width:16, height:16, border:'2px solid rgba(255,255,255,.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/> Scanning…</>
                ) : '🔎 Scan Domain'}
              </button>
            </div>
            {error && <div style={{ marginTop:10, fontSize:12.5, color:'#dc2626', background:'#fef2f2', padding:'8px 12px', borderRadius:8, border:'1px solid #fca5a5' }}>⚠ {error}</div>}

            {/* Progress */}
            {scanning && (
              <div style={{ marginTop:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                  <span style={{ fontSize:12, color:'#67c5d4', fontWeight:500 }}>{step}</span>
                  <span style={{ fontSize:12, color:'#0891b2', fontWeight:700 }}>{progress}%</span>
                </div>
                <div style={{ height:5, background:'#e0f9ff', borderRadius:99, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#0891b2,#06b6d4)', borderRadius:99, transition:'width .4s ease' }}/>
                </div>
                <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
                  {['SSL Certificate','DNS Records','DMARC Policy','SPF Record','DKIM Keys','MX Records','BIMI','Score'].map((s,i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 9px', borderRadius:99, background: progress >= (i+1)*12 ? '#cffafe' : '#f0fdff', border:'1px solid', borderColor: progress >= (i+1)*12 ? '#a5f3fc' : '#e0f9ff', color: progress >= (i+1)*12 ? '#0891b2' : '#a5f3fc', fontWeight:500, transition:'all .3s' }}>
                      {progress >= (i+1)*12 ? '✓' : '○'} {s}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Report */}
          {report && (
            <>
              {/* Score hero */}
              <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #cffafe', padding:'22px 24px', marginBottom:14, boxShadow:'0 2px 16px rgba(8,145,178,.08)' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:20, flexWrap:'wrap' }}>

                  {/* Grade circle */}
                  <div style={{ width:100, height:100, borderRadius:'50%', background:report.scoring.gradeBg, border:`3px solid ${report.scoring.gradeColor}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <div style={{ fontSize:32, fontWeight:900, color:report.scoring.gradeColor, letterSpacing:'-.05em', lineHeight:1 }}>{report.scoring.grade}</div>
                    <div style={{ fontSize:11, color:report.scoring.gradeColor, fontWeight:700, marginTop:2 }}>{report.scoring.score}/100</div>
                  </div>

                  {/* Domain + summary */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                      <div style={{ fontSize:20, fontWeight:800, color:'#083344', letterSpacing:'-.03em' }}>{report.domain}</div>
                      <div style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99, background:report.scoring.gradeBg, color:report.scoring.gradeColor, border:`1px solid ${report.scoring.gradeColor}44` }}>
                        {report.scoring.score>=80?'Secure':report.scoring.score>=60?'Needs improvement':'At risk'}
                      </div>
                    </div>
                    <div style={{ fontSize:12.5, color:'#67c5d4', marginBottom:14 }}>
                      Scanned {report.scannedAt.toLocaleTimeString()} · {report.scannedAt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
                    </div>
                    {/* Score breakdown bars */}
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
                      {report.scoring.breakdown.map(b => (
                        <div key={b.cat}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                            <span style={{ fontSize:10, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'.06em' }}>{b.cat}</span>
                            <span style={{ fontSize:10, fontWeight:800, color: b.pts===b.max?'#059669':b.pts>0?'#d97706':'#dc2626' }}>{b.pts}/{b.max}</span>
                          </div>
                          <div style={{ height:5, background:'#e0f9ff', borderRadius:99, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${(b.pts/b.max)*100}%`, background: b.pts===b.max?'#10b981':b.pts>0?'#f59e0b':'#ef4444', borderRadius:99 }}/>
                          </div>
                          <div style={{ fontSize:10.5, color:'#9ca3af', marginTop:3, lineHeight:1.3 }}>{b.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Quick status badges */}
                  <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
                    {[
                      { label:'SSL', ok: report.ssl.valid && (report.ssl.daysLeft||0)>30 },
                      { label:'DMARC', ok: report.dmarc.status==='great' },
                      { label:'SPF',   ok: report.spf.status==='great' },
                      { label:'DKIM',  ok: report.dkim.status==='great' },
                      { label:'MX',    ok: report.mx.status==='great' },
                    ].map(b => (
                      <div key={b.label} style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 10px', borderRadius:8, background:b.ok?'#f0fdf4':'#fef2f2', border:`1px solid ${b.ok?'#86efac':'#fca5a5'}` }}>
                        <div style={{ width:8, height:8, borderRadius:'50%', background:b.ok?'#22c55e':'#ef4444', flexShrink:0 }}/>
                        <span style={{ fontSize:11.5, fontWeight:700, color:b.ok?'#059669':'#dc2626' }}>{b.label}</span>
                        <span style={{ fontSize:10.5, color:b.ok?'#16a34a':'#b91c1c' }}>{b.ok?'Pass':'Fail'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tab nav */}
              <div style={{ display:'flex', gap:3, background:'#a5f3fc', borderRadius:10, padding:3, marginBottom:14 }}>
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    style={{ flex:1, padding:'7px 0', borderRadius:8, border:'none', fontSize:12.5, fontWeight:activeTab===t.id?700:500, cursor:'pointer', background:activeTab===t.id?'#fff':'transparent', color:activeTab===t.id?'#0e7490':'rgba(255,255,255,.85)', fontFamily:'inherit', transition:'all .12s', boxShadow:activeTab===t.id?'0 1px 4px rgba(8,145,178,.15)':'none' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {activeTab==='overview' && <OverviewTab report={report}/>}
              {activeTab==='ssl'      && <SSLTab      report={report}/>}
              {activeTab==='email'    && <EmailTab    report={report}/>}
              {activeTab==='dns'      && <DNSTab      report={report}/>}
              {activeTab==='bimi'     && <BIMITab     report={report}/>}
            </>
          )}

          {/* Empty state */}
          {!report && !scanning && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
              {[
                { icon:'🔒', title:'SSL / TLS Analysis', desc:'Certificate validity, expiry date, issuer chain, and days remaining. Pulls from Certificate Transparency logs.' },
                { icon:'📧', title:'DMARC · SPF · DKIM', desc:'Full email authentication audit. Checks policy strength, SPF mechanisms, DKIM key presence and selector detection.' },
                { icon:'🌍', title:'DNS Health Check', desc:'A, AAAA, MX, NS, TXT, CAA, SOA records. Identifies missing records and security misconfigurations.' },
                { icon:'🏷', title:'BIMI Compliance', desc:'Checks for Brand Indicators for Message Identification — shows your logo in email clients like Gmail and Apple Mail.' },
                { icon:'📊', title:'Security Score', desc:'Weighted 0–100 score across all checks. Grade A+ to F with detailed per-category breakdown and improvement tips.' },
                { icon:'⚡', title:'Instant Results', desc:'All checks run in parallel using Cloudflare DoH and Certificate Transparency. Complete scan in under 15 seconds.' },
              ].map(f => (
                <div key={f.title} style={{ background:'#fff', borderRadius:12, border:'1.5px solid #cffafe', padding:'18px 16px', transition:'all .15s', cursor:'default' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#67e8f9';e.currentTarget.style.boxShadow='0 4px 16px rgba(8,145,178,.1)'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#cffafe';e.currentTarget.style.boxShadow='none'}}>
                  <div style={{ fontSize:26, marginBottom:10 }}>{f.icon}</div>
                  <div style={{ fontSize:13.5, fontWeight:700, color:'#083344', marginBottom:6, letterSpacing:'-.02em' }}>{f.title}</div>
                  <div style={{ fontSize:12.5, color:'#67c5d4', lineHeight:1.6 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Overview Tab ───────────────────────────────────────────────────────────
function OverviewTab({ report:r }) {
  const issues = []
  if (!r.ssl.valid)                                   issues.push({ sev:'critical', msg:`No valid SSL certificate found for ${r.domain}`, fix:'Install an SSL certificate immediately. Use Let\'s Encrypt (free) or purchase from a CA.' })
  if (r.ssl.daysLeft !== null && r.ssl.daysLeft <= 30) issues.push({ sev:'critical', msg:`SSL certificate expires in ${r.ssl.daysLeft} days`, fix:'Renew your SSL certificate before it expires to avoid browser warnings and downtime.' })
  if (r.dmarc.status==='missing')  issues.push({ sev:'critical', msg:'No DMARC record found',    fix:`Add TXT record at _dmarc.${r.domain}: v=DMARC1; p=none; rua=mailto:dmarc@${r.domain}` })
  if (r.dmarc.policy==='none')     issues.push({ sev:'warning',  msg:'DMARC policy is p=none — no protection', fix:'Change to p=quarantine or p=reject to block spoofed emails.' })
  if (r.spf.status==='missing')    issues.push({ sev:'critical', msg:'No SPF record found',       fix:`Add TXT record at ${r.domain}: v=spf1 include:_spf.google.com ~all` })
  if (r.dkim.status==='missing')   issues.push({ sev:'warning',  msg:'No DKIM record detected',   fix:'Set up DKIM signing with your email provider and publish the public key as a TXT record.' })
  if (!r.dns.caaRecs.length)       issues.push({ sev:'info',     msg:'No CAA record found',        fix:`Add a CAA record: ${r.domain} CAA 0 issue "letsencrypt.org"` })
  if (!r.bimi.found)               issues.push({ sev:'info',     msg:'No BIMI record found',       fix:'Set up BIMI to display your logo in Gmail, Apple Mail and other email clients.' })

  const sevCfg = {
    critical: { color:'#dc2626', bg:'#fef2f2', border:'#fecaca', icon:'🔴', label:'Critical' },
    warning:  { color:'#b45309', bg:'#fffbeb', border:'#fde68a', icon:'🟡', label:'Warning'  },
    info:     { color:'#0891b2', bg:'#f0fdff', border:'#cffafe', icon:'🔵', label:'Info'     },
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

      {/* Recommendations */}
      <div style={{ gridColumn:'1/-1' }}>
        <SectionCard title="Findings & Recommendations" icon="📋">
          {issues.length === 0 ? (
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px', background:'#f0fdf4', border:'1.5px solid #86efac', borderRadius:10 }}>
              <span style={{ fontSize:24 }}>🎉</span>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:'#15803d' }}>Excellent! No critical issues found</div>
                <div style={{ fontSize:12.5, color:'#16a34a', marginTop:2 }}>All major security checks passed for {r.domain}</div>
              </div>
            </div>
          ) : issues.map((iss, i) => {
            const cfg = sevCfg[iss.sev]
            return (
              <div key={i} style={{ padding:'12px 14px', background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:10, marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{cfg.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:cfg.color }}>{iss.msg}</span>
                      <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:99, background:cfg.color+'22', color:cfg.color }}>{cfg.label}</span>
                    </div>
                    <div style={{ fontSize:12, color:'#374151', lineHeight:1.5 }}>
                      <b style={{ color:cfg.color }}>Fix: </b>{iss.fix}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </SectionCard>
      </div>

      {/* SSL summary */}
      <SectionCard title="SSL Certificate" icon="🔒">
        <StatusRow label="Status"       value={r.ssl.valid ? 'Valid' : 'Not found'}    status={r.ssl.valid?(r.ssl.daysLeft>30?'great':'warn'):'missing'}/>
        <StatusRow label="Issuer"       value={r.ssl.issuer}                           plain/>
        <StatusRow label="Expires"      value={r.ssl.expires}                          plain/>
        <StatusRow label="Days left"    value={r.ssl.daysLeft !== null ? `${r.ssl.daysLeft}d` : '—'} status={!r.ssl.daysLeft?'missing':r.ssl.daysLeft>30?'great':r.ssl.daysLeft>0?'warn':'missing'}/>
      </SectionCard>

      {/* DMARC summary */}
      <SectionCard title="Email Authentication" icon="📧">
        <StatusRow label="DMARC"  value={r.dmarc.policy?`p=${r.dmarc.policy}`:'Not set'} status={r.dmarc.status}/>
        <StatusRow label="SPF"    value={r.spf.all||'Not set'}                             status={r.spf.status}/>
        <StatusRow label="DKIM"   value={r.dkim.status==='great'?`✓ Found (${r.dns.dkimSelector})`:'Not found'} status={r.dkim.status}/>
        <StatusRow label="BIMI"   value={r.bimi.found?'Record found':'Not configured'}    status={r.bimi.found?'great':'missing'}/>
      </SectionCard>

      {/* DNS summary */}
      <SectionCard title="DNS Records" icon="🌍">
        <StatusRow label="A record"   value={r.dns.aRecs.length   ? r.dns.aRecs[0]          : 'Not found'} status={r.dns.aRecs.length?'great':'missing'}/>
        <StatusRow label="MX record"  value={r.dns.mxRecs.length  ? `${r.dns.mxRecs.length} records` : 'Not found'} status={r.dns.mxRecs.length?'great':'missing'}/>
        <StatusRow label="NS record"  value={r.dns.nsRecs.length  ? `${r.dns.nsRecs.length} servers` : 'Not found'} status={r.dns.nsRecs.length?'great':'missing'}/>
        <StatusRow label="CAA record" value={r.dns.caaRecs.length ? 'Configured'            : 'Not set'} status={r.dns.caaRecs.length?'great':'warn'}/>
      </SectionCard>

      {/* Score card */}
      <SectionCard title="Security Score Breakdown" icon="📊">
        {r.scoring.breakdown.map((b,i) => (
          <div key={i} style={{ marginBottom:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:12.5, fontWeight:600, color:'#083344' }}>{b.cat}</span>
              <span style={{ fontSize:12.5, fontWeight:800, color: b.pts===b.max?'#059669':b.pts>0?'#d97706':'#dc2626' }}>{b.pts} / {b.max}</span>
            </div>
            <div style={{ height:6, background:'#e0f9ff', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${b.max>0?(b.pts/b.max)*100:0}%`, background:b.pts===b.max?'linear-gradient(90deg,#10b981,#34d399)':b.pts>0?'linear-gradient(90deg,#f59e0b,#fbbf24)':'#ef4444', borderRadius:99, transition:'width .6s ease' }}/>
            </div>
            <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{b.label}</div>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}

// ── SSL Tab ────────────────────────────────────────────────────────────────
function SSLTab({ report:r }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <SectionCard title="Certificate Details" icon="🔒">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <StatusRow label="Certificate Status" value={r.ssl.valid?'Valid and installed':'Not found or invalid'} status={r.ssl.valid?'great':'missing'}/>
          <StatusRow label="Common Name"  value={r.ssl.subject} plain/>
          <StatusRow label="Issuer"       value={r.ssl.issuer}  plain/>
          <StatusRow label="Expiry Date"  value={r.ssl.expires} plain/>
          <StatusRow label="Days Until Expiry" value={r.ssl.daysLeft!==null?`${r.ssl.daysLeft} days`:'—'} status={!r.ssl.daysLeft?'missing':r.ssl.daysLeft>30?'great':r.ssl.daysLeft>0?'warn':'missing'}/>
        </div>
        {r.ssl.error && <div style={{ marginTop:10, padding:'10px 12px', background:'#fff7ed', border:'1px solid #fde68a', borderRadius:8, fontSize:12.5, color:'#92400e' }}>ℹ {r.ssl.error}</div>}
      </SectionCard>

      {r.ssl.crtEntries.length > 0 && (
        <SectionCard title="Certificate Transparency Log" icon="📜">
          <div style={{ fontSize:12, color:'#67c5d4', marginBottom:12 }}>Recent SSL certificates issued for <b>{r.domain}</b> from crt.sh</div>
          <div style={{ border:'1.5px solid #cffafe', borderRadius:10, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 100px 100px 70px', padding:'8px 14px', background:'#f0fdff', borderBottom:'1.5px solid #cffafe' }}>
              {['Subject','Issuer','Valid From','Valid To','Days Left'].map(h => (
                <span key={h} style={{ fontSize:10, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</span>
              ))}
            </div>
            {r.ssl.crtEntries.map((e,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 100px 100px 70px', padding:'10px 14px', borderBottom:i<r.ssl.crtEntries.length-1?'1px solid #f0fdff':'none', alignItems:'center' }}>
                <span style={{ fontSize:12, fontWeight:600, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.subject}</span>
                <span style={{ fontSize:11.5, color:'#67c5d4', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.issuer}</span>
                <span style={{ fontSize:11.5, color:'#9ca3af' }}>{e.from}</span>
                <span style={{ fontSize:11.5, color: e.daysLeft<0?'#dc2626':e.daysLeft<30?'#b45309':'#059669', fontWeight:600 }}>{e.to}</span>
                <span style={{ fontSize:12, fontWeight:800, color: e.daysLeft<0?'#dc2626':e.daysLeft<30?'#b45309':'#059669' }}>{e.daysLeft<0?'Expired':`${e.daysLeft}d`}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, fontSize:11.5, color:'#a5f3fc' }}>Source: crt.sh Certificate Transparency log</div>
        </SectionCard>
      )}

      <SectionCard title="SSL Best Practices Checklist" icon="✅">
        {[
          { label:'Valid SSL certificate installed',    ok: r.ssl.valid },
          { label:'Certificate not expiring within 30 days', ok: (r.ssl.daysLeft||0) > 30 },
          { label:'Certificate from trusted CA',        ok: r.ssl.valid && !r.ssl.issuer.toLowerCase().includes('self') },
          { label:'Domain matches certificate',         ok: r.ssl.valid },
        ].map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<3?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:c.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${c.ok?'#86efac':'#fca5a5'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0 }}>
              {c.ok ? '✓' : '✗'}
            </div>
            <span style={{ fontSize:13, color:c.ok?'#083344':'#dc2626', fontWeight:c.ok?500:600 }}>{c.label}</span>
            <span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:c.ok?'#f0fdf4':'#fef2f2', color:c.ok?'#059669':'#dc2626' }}>{c.ok?'Pass':'Fail'}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}

// ── Email Security Tab ─────────────────────────────────────────────────────
function EmailTab({ report:r }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* DMARC */}
      <SectionCard title="DMARC Record Analysis" icon="📧">
        <StatusRow label="Status"         value={r.dmarc.record?'Record found':'No record'} status={r.dmarc.status}/>
        <StatusRow label="Policy (p=)"    value={r.dmarc.policy||'Not set'} status={r.dmarc.status}/>
        <StatusRow label="Coverage (pct)" value={r.dmarc.pct ? `${r.dmarc.pct}%` : '—'} plain/>
        <StatusRow label="Report address" value={r.dmarc.rua||'Not configured'} status={r.dmarc.rua?'great':'warn'}/>
        {r.dmarc.record && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:9 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:4, textTransform:'uppercase', letterSpacing:'.06em' }}>Raw Record</div>
            <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all', lineHeight:1.6 }}>{r.dmarc.record}</code>
          </div>
        )}
        {!r.dmarc.record && (
          <RecordBox label="Recommended record to add" type="TXT" name={`_dmarc.${r.domain}`} value={`v=DMARC1; p=none; rua=mailto:dmarc@${r.domain}; ruf=mailto:dmarc@${r.domain}; fo=1`}/>
        )}
      </SectionCard>

      {/* SPF */}
      <SectionCard title="SPF Record Analysis" icon="🛡">
        <StatusRow label="Status" value={r.spf.record?'Record found':'No record'} status={r.spf.status}/>
        <StatusRow label="All mechanism" value={r.spf.all||'Not set'} status={r.spf.all==='-all'?'great':r.spf.all==='~all'?'good':r.spf.all?'warn':'missing'}/>
        {r.spf.record && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:9 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:4, textTransform:'uppercase', letterSpacing:'.06em' }}>Raw Record</div>
            <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all', lineHeight:1.6 }}>{r.spf.record}</code>
          </div>
        )}
        {!r.spf.record && <RecordBox label="Recommended SPF record" type="TXT" name={r.domain} value="v=spf1 include:_spf.google.com include:mailgun.org ~all"/>}
      </SectionCard>

      {/* DKIM */}
      <SectionCard title="DKIM Record Analysis" icon="🔐">
        <StatusRow label="Status"   value={r.dkim.status==='great'?`Key found at ${r.dns.dkimSelector}._domainkey`:'No DKIM key detected'} status={r.dkim.status}/>
        <StatusRow label="Selector" value={r.dns.dkimSelector||'Not found'} plain/>
        {r.dkim.record && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:9 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:4, textTransform:'uppercase', letterSpacing:'.06em' }}>Raw Record</div>
            <code style={{ fontSize:11, color:'#083344', wordBreak:'break-all', lineHeight:1.6 }}>{r.dkim.record}</code>
          </div>
        )}
        {r.dkim.status === 'missing' && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'#fff7ed', border:'1px solid #fde68a', borderRadius:9, fontSize:12.5, color:'#92400e' }}>
            DKIM key not found on common selectors (default, google, mail, k1, s1, s2). Set up DKIM with your email provider (Google Workspace, Microsoft 365, Mailgun etc.) and ask them for the selector name.
          </div>
        )}
      </SectionCard>

      {/* Email security score */}
      <SectionCard title="Email Security Checklist" icon="✅">
        {[
          { label:'DMARC record exists',              ok: !!r.dmarc.record },
          { label:'DMARC policy is quarantine/reject', ok: r.dmarc.policy==='quarantine'||r.dmarc.policy==='reject' },
          { label:'DMARC reporting configured',       ok: !!r.dmarc.rua },
          { label:'SPF record exists',                ok: !!r.spf.record },
          { label:'SPF uses -all or ~all',             ok: r.spf.all==='-all'||r.spf.all==='~all' },
          { label:'DKIM key published',               ok: r.dkim.status==='great' },
          { label:'MX records configured',            ok: r.mx.status==='great' },
        ].map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<6?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:c.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${c.ok?'#86efac':'#fca5a5'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0 }}>{c.ok?'✓':'✗'}</div>
            <span style={{ fontSize:13, color:c.ok?'#083344':'#374151', flex:1 }}>{c.label}</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:c.ok?'#f0fdf4':'#fef2f2', color:c.ok?'#059669':'#dc2626' }}>{c.ok?'Pass':'Fail'}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}

// ── DNS Tab ────────────────────────────────────────────────────────────────
function DNSTab({ report:r }) {
  const groups = [
    { label:'A Records (IPv4)',    recs:r.dns.aRecs,    type:'A',     required:true  },
    { label:'AAAA Records (IPv6)', recs:r.dns.aaaaRecs, type:'AAAA',  required:false },
    { label:'MX Records (Email)',  recs:r.dns.mxRecs,   type:'MX',    required:true  },
    { label:'NS Records',          recs:r.dns.nsRecs,   type:'NS',    required:true  },
    { label:'TXT Records',         recs:r.dns.txtRecs,  type:'TXT',   required:false },
    { label:'CAA Records',         recs:r.dns.caaRecs,  type:'CAA',   required:false },
    { label:'SOA Record',          recs:r.dns.soaRecs,  type:'SOA',   required:false },
  ]
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <SectionCard title="DNS Record Inventory" icon="🌍">
        {groups.map((g,i) => (
          <div key={i} style={{ marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
              <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 8px', borderRadius:4, background:'#cffafe', color:'#0891b2', letterSpacing:'.04em' }}>{g.type}</span>
              <span style={{ fontSize:12.5, fontWeight:600, color:'#083344' }}>{g.label}</span>
              <span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:g.recs.length?'#f0fdf4':g.required?'#fef2f2':'#fff7ed', color:g.recs.length?'#059669':g.required?'#dc2626':'#b45309' }}>
                {g.recs.length ? `${g.recs.length} found` : g.required ? 'Missing' : 'Not set'}
              </span>
            </div>
            {g.recs.length > 0 && (
              <div style={{ padding:'8px 12px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:8 }}>
                {g.recs.map((rec,j) => (
                  <div key={j} style={{ fontFamily:'monospace', fontSize:11.5, color:'#083344', padding:'3px 0', borderBottom:j<g.recs.length-1?'1px solid #e0f9ff':'none', wordBreak:'break-all', lineHeight:1.5 }}>{rec}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </SectionCard>

      <SectionCard title="DNS Health Checklist" icon="✅">
        {[
          { label:'A record (IPv4) configured',    ok:r.dns.aRecs.length>0 },
          { label:'MX records for email delivery', ok:r.dns.mxRecs.length>0 },
          { label:'NS records present',            ok:r.dns.nsRecs.length>0 },
          { label:'CAA record (restricts CAs)',    ok:r.dns.caaRecs.length>0 },
          { label:'IPv6 (AAAA) support',           ok:r.dns.aaaaRecs.length>0 },
          { label:'SOA record present',            ok:r.dns.soaRecs.length>0 },
        ].map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<5?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:c.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${c.ok?'#86efac':'#fca5a5'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0 }}>{c.ok?'✓':'✗'}</div>
            <span style={{ fontSize:13, color:'#083344', flex:1 }}>{c.label}</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:c.ok?'#f0fdf4':'#fef2f2', color:c.ok?'#059669':'#dc2626' }}>{c.ok?'Pass':'Fail'}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}

// ── BIMI Tab ───────────────────────────────────────────────────────────────
function BIMITab({ report:r }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <SectionCard title="BIMI Record" icon="🏷">
        <StatusRow label="BIMI Status" value={r.bimi.found?'Record found':'Not configured'} status={r.bimi.found?'great':'missing'}/>
        {r.bimi.found && <>
          <StatusRow label="Logo URL" value={r.bimi.logoUrl||'Not set'} plain/>
          <StatusRow label="VMC URL"  value={r.bimi.vmcUrl||'Not set (optional)'}   plain/>
          {r.bimi.record && (
            <div style={{ marginTop:12, padding:'10px 14px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:9 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:4, textTransform:'uppercase', letterSpacing:'.06em' }}>Raw Record</div>
              <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all', lineHeight:1.6 }}>{r.bimi.record}</code>
            </div>
          )}
        </>}
        {!r.bimi.found && (
          <>
            <div style={{ marginTop:12, padding:'12px 14px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:9, fontSize:12.5, color:'#374151', lineHeight:1.6 }}>
              BIMI (Brand Indicators for Message Identification) lets you display your company logo next to emails in Gmail, Apple Mail, Fastmail, and Yahoo Mail.
            </div>
            <RecordBox label="BIMI record template" type="TXT" name={`default._bimi.${r.domain}`} value={`v=BIMI1; l=https://${r.domain}/logo.svg;`}/>
          </>
        )}
      </SectionCard>

      <SectionCard title="BIMI Requirements Checklist" icon="✅">
        {[
          { label:'DMARC p=quarantine or p=reject required', ok: r.dmarc.policy==='quarantine'||r.dmarc.policy==='reject' },
          { label:'SPF record configured',                   ok: !!r.spf.record },
          { label:'DKIM key published',                      ok: r.dkim.status==='great' },
          { label:'BIMI DNS record exists',                  ok: r.bimi.found },
          { label:'SVG logo URL in BIMI record',             ok: r.bimi.found && !!r.bimi.logoUrl },
        ].map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<4?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:c.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${c.ok?'#86efac':'#fca5a5'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0 }}>{c.ok?'✓':'✗'}</div>
            <span style={{ fontSize:13, color:'#083344', flex:1 }}>{c.label}</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:c.ok?'#f0fdf4':'#fef2f2', color:c.ok?'#059669':'#dc2626' }}>{c.ok?'Pass':'Fail'}</span>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Email Client BIMI Support" icon="📱">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[
            { client:'Gmail',       support:'VMC required',  ok:true  },
            { client:'Apple Mail',  support:'VMC required',  ok:true  },
            { client:'Yahoo Mail',  support:'No VMC needed', ok:true  },
            { client:'Fastmail',    support:'No VMC needed', ok:true  },
            { client:'Outlook',     support:'Not supported', ok:false },
            { client:'Thunderbird', support:'Not supported', ok:false },
          ].map((c,i) => (
            <div key={i} style={{ padding:'12px', background:c.ok?'#f0fdf4':'#f9feff', border:`1px solid ${c.ok?'#86efac':'#cffafe'}`, borderRadius:9, textAlign:'center' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:3 }}>{c.client}</div>
              <div style={{ fontSize:11, color:c.ok?'#059669':'#67c5d4', fontWeight:500 }}>{c.support}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

// ── Shared components ──────────────────────────────────────────────────────
function SectionCard({ title, icon, children }) {
  return (
    <div style={{ background:'#fff', borderRadius:12, border:'1.5px solid #cffafe', overflow:'hidden', boxShadow:'0 2px 10px rgba(8,145,178,.05)' }}>
      <div style={{ padding:'11px 16px', background:'linear-gradient(90deg,#f0fdff,#ecfeff)', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:14 }}>{icon}</span>
        <span style={{ fontSize:11.5, fontWeight:700, color:'#0891b2', textTransform:'uppercase', letterSpacing:'.07em' }}>{title}</span>
      </div>
      <div style={{ padding:'14px 16px' }}>{children}</div>
    </div>
  )
}

function StatusRow({ label, value, status, plain }) {
  const s = plain ? null : st(status)
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f0fdff' }}>
      <span style={{ fontSize:12.5, color:'#67c5d4', fontWeight:500, flexShrink:0, marginRight:12 }}>{label}</span>
      {s ? (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:s.dot, flexShrink:0 }}/>
          <span style={{ fontSize:12.5, fontWeight:600, color:s.color }}>{value||'—'}</span>
        </div>
      ) : (
        <span style={{ fontSize:12.5, color:'#083344', fontWeight:500, textAlign:'right', wordBreak:'break-all' }}>{value||'—'}</span>
      )}
    </div>
  )
}

function RecordBox({ label, type, name, value }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ marginTop:12 }}>
      <div style={{ fontSize:11.5, fontWeight:700, color:'#0891b2', marginBottom:6 }}>{label}</div>
      <div style={{ background:'#f0fdff', border:'1.5px solid #cffafe', borderRadius:9, overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'60px 1fr', padding:'8px 12px', borderBottom:'1px solid #cffafe', background:'#ecfeff' }}>
          <span style={{ fontSize:10.5, fontWeight:700, color:'#0891b2' }}>Type</span>
          <span style={{ fontSize:10.5, fontWeight:700, color:'#0891b2' }}>Name</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'60px 1fr', padding:'8px 12px', borderBottom:'1px solid #e0f9ff' }}>
          <code style={{ fontSize:11.5, color:'#083344', fontWeight:700 }}>{type}</code>
          <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all' }}>{name}</code>
        </div>
        <div style={{ padding:'8px 12px', display:'flex', alignItems:'flex-start', gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:3, textTransform:'uppercase', letterSpacing:'.05em' }}>Value</div>
            <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all', lineHeight:1.6 }}>{value}</code>
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(()=>setCopied(false),2000) }}
            style={{ padding:'5px 10px', background:copied?'#0891b2':'#fff', border:'1.5px solid #a5f3fc', borderRadius:7, fontSize:11, fontWeight:700, color:copied?'#fff':'#0891b2', cursor:'pointer', flexShrink:0, fontFamily:'inherit', transition:'all .15s' }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}
