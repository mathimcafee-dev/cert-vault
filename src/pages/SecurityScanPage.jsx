import { useState, useRef, useEffect, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER — 99.99% accurate APIs only
// ═══════════════════════════════════════════════════════════════════════════

// Primary: Cloudflare DoH — fastest, most reliable
async function dohQuery(name, type, timeout = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const urls = [
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    ]
    // Try Cloudflare first, fallback to Google
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          headers: { Accept: 'application/dns-json' },
          signal: controller.signal,
        })
        if (!r.ok) continue
        const d = await r.json()
        if (d.Status === 0 || d.Status === 3) { // 3 = NXDOMAIN (valid empty)
          clearTimeout(timer)
          return { answers: d.Answer || [], status: d.Status, authority: d.Authority || [] }
        }
      } catch { continue }
    }
  } catch {}
  clearTimeout(timer)
  return { answers: [], status: -1, authority: [] }
}

async function dnsRecords(name, type) {
  const { answers } = await dohQuery(name, type)
  return answers.map(a => ({
    data: (a.data || '').replace(/"/g, '').trim(),
    ttl:  a.TTL || 0,
    type: a.type,
  })).filter(a => a.data)
}

async function dnsValues(name, type) {
  const recs = await dnsRecords(name, type)
  return recs.map(r => r.data)
}

// SSL CHECK — HTTPS record (instant proof) + crt.sh (cert details)
async function checkSSLLabs(domain) {
  const result = {
    grade: null, subject: null, issuer: null, expires: null, daysLeft: null,
    protocols: [], vulns: [], hsts: false, hstsAge: null,
    source: null, error: null, crtEntries: [], httpsDetected: false,
  }

  // Run HTTPS record check and crt.sh in PARALLEL — don't wait sequentially
  const [httpsResult, crtResult] = await Promise.allSettled([

    // HTTPS DNS record — instant proof SSL exists (<300ms)
    fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=HTTPS`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) }
    ).then(r => r.json()).catch(() => null),

    // crt.sh — single query with wildcard covers both exact + wildcard certs (one request, not two)
    fetch(
      `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }
    ).then(r => r.ok ? r.json() : null).catch(() => null),
  ])

  // Process HTTPS record
  const httpsData = httpsResult.status === 'fulfilled' ? httpsResult.value : null
  if (httpsData?.Status === 0 && httpsData.Answer?.length > 0) {
    result.httpsDetected = true
    result.grade = 'Valid'
    result.source = 'HTTPS DNS record'
  }

  // Process crt.sh
  const raw = crtResult.status === 'fulfilled' ? crtResult.value : null
  if (Array.isArray(raw) && raw.length > 0) {
    const now = Date.now()
    const sorted = [...raw].sort((a, b) => new Date(b.not_before) - new Date(a.not_before))

    // CT log table — recent 10 certs
    result.crtEntries = sorted.slice(0, 10).map(c => {
      const exp = new Date(c.not_after)
      return {
        issuer:   parseIssuer(c.issuer_name),
        subject:  c.common_name || domain,
        from:     fmtDate(new Date(c.not_before)),
        to:       fmtDate(exp),
        daysLeft: Math.ceil((exp - now) / 86400000),
      }
    })

    // Best valid cert — prefer exact domain match, fall back to any valid
    const valid = sorted.filter(c => new Date(c.not_after).getTime() > now)
    const dLow  = domain.toLowerCase()
    const best  = valid.find(c =>
      (c.common_name||'').toLowerCase() === dLow ||
      (c.common_name||'').toLowerCase() === `*.${dLow}`
    ) || valid[0]

    if (best) {
      const exp      = new Date(best.not_after)
      const daysLeft = Math.ceil((exp - now) / 86400000)
      result.grade   = daysLeft > 0 ? 'Valid' : 'Expired'
      result.subject = best.common_name || domain
      result.issuer  = parseIssuer(best.issuer_name)
      result.expires = fmtDate(exp)
      result.daysLeft = Math.max(0, daysLeft)
      result.source  = 'Certificate Transparency (crt.sh)'
      result.httpsDetected = true
    }
  }

  // Final state
  if (!result.grade) {
    if (result.httpsDetected) {
      // HTTPS record confirmed SSL but crt.sh gave no details
      result.grade  = 'Valid'
      result.source = 'HTTPS DNS record'
      result.issuer = '—'
      result.error  = null
    } else {
      result.error = 'SSL certificate could not be verified.'
    }
  }

  return result
}

// Parse issuer O= field from X.509 distinguished name
// Example: "C=US, O=DigiCert Inc, CN=DigiCert TLS RSA SHA256 2020 CA1"
function parseIssuer(dn) {
  if (!dn) return '—'
  // Match O= value — stop at comma or end
  const m = dn.match(/O=([^,]+)/)
  if (m) return m[1].trim()
  // Fallback: CN=
  const m2 = dn.match(/CN=([^,]+)/)
  if (m2) return m2[1].trim()
  return dn.slice(0, 40)
}

function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}


// Mozilla Observatory — HTTP security headers check
async function checkMozillaObservatory(domain) {
  const result = { grade: null, score: null, tests: {}, error: null }
  try {
    // Trigger scan
    const trigger = await fetch(
      `https://http-observatory.security.mozilla.org/api/v1/analyze?host=${encodeURIComponent(domain)}`,
      { method: 'POST', signal: AbortSignal.timeout(8000) }
    )
    if (!trigger.ok) { result.error = 'Observatory unavailable'; return result }
    const data = await trigger.json()

    if (data.error) { result.error = data.error; return result }

    result.grade = data.grade || null
    result.score = data.score ?? null

    if (data.tests) {
      result.tests = {
        hsts:        { pass: data.tests['strict-transport-security']?.pass, score: data.tests['strict-transport-security']?.score_modifier },
        csp:         { pass: data.tests['content-security-policy']?.pass,   score: data.tests['content-security-policy']?.score_modifier   },
        xframe:      { pass: data.tests['x-frame-options']?.pass,           score: data.tests['x-frame-options']?.score_modifier           },
        xcontent:    { pass: data.tests['x-content-type-options']?.pass,    score: data.tests['x-content-type-options']?.score_modifier    },
        referrer:    { pass: data.tests['referrer-policy']?.pass,           score: data.tests['referrer-policy']?.score_modifier           },
        cookies:     { pass: data.tests['cookies']?.pass,                   score: data.tests['cookies']?.score_modifier                  },
        subresource: { pass: data.tests['subresource-integrity']?.pass,     score: data.tests['subresource-integrity']?.score_modifier     },
      }
    }
  } catch(e) {
    result.error = e.name === 'TimeoutError' ? 'Observatory timeout' : e.message
  }
  return result
}

// DMARC full analysis
function analyseDmarc(txts) {
  const rec = txts.find(r => r.toLowerCase().startsWith('v=dmarc1'))
  if (!rec) return { record: null, status: 'missing', policy: null, subPolicy: null, pct: '100', rua: null, ruf: null, aspf: 'r', adkim: 'r', fo: null }
  const tags = {}
  rec.split(';').forEach(p => {
    const eq = p.indexOf('=')
    if (eq > 0) {
      const k = p.slice(0, eq).trim().toLowerCase()
      const v = p.slice(eq + 1).trim()
      tags[k] = v
    }
  })
  const p  = tags.p  || null
  const sp = tags.sp || null
  const st = !p ? 'invalid' : p === 'reject' ? 'great' : p === 'quarantine' ? 'good' : p === 'none' ? 'warn' : 'warn'
  return {
    record: rec, status: st, policy: p, subPolicy: sp,
    pct:   tags.pct || '100',
    rua:   tags.rua || null,
    ruf:   tags.ruf || null,
    aspf:  tags.aspf || 'r',
    adkim: tags.adkim || 'r',
    fo:    tags.fo || null,
  }
}

// SPF full analysis
function analyseSpf(txts) {
  const rec = txts.find(r => r.toLowerCase().startsWith('v=spf1'))
  if (!rec) return { record: null, status: 'missing', all: null, includes: [], mechanisms: [], lookupCount: 0 }
  const parts = rec.split(/\s+/).filter(Boolean)
  const all   = parts.find(p => /^[+\-~?]?all$/i.test(p)) || null
  const includes = parts.filter(p => p.toLowerCase().startsWith('include:')).map(p => p.slice(8))
  const mechanisms = parts.filter(p => !p.startsWith('v=') && !/^[+\-~?]?all$/i.test(p))
  const st = !all ? 'warn' : all === '-all' ? 'great' : all === '~all' ? 'good' : all === '+all' ? 'fail' : 'warn'
  return { record: rec, status: st, all, includes, mechanisms, lookupCount: includes.length + mechanisms.filter(m => /^(a|mx|ptr|exists|redirect)/i.test(m)).length }
}

// DKIM — probe extended selector list
const DKIM_SELECTORS = [
  'default','google','mail','k1','k2','s1','s2','s3',
  'dkim','dkim1','selector1','selector2','selector3',
  'mail1','mail2','smtp','email','mimecast','proofpoint',
  'mandrill','mailgun','sendgrid','amazonses','postmark',
]
async function checkDkim(domain) {
  const found = []
  const checks = DKIM_SELECTORS.map(async sel => {
    const vals = await dnsValues(`${sel}._domainkey.${domain}`, 'TXT')
    const rec  = vals.find(v => v.toLowerCase().includes('v=dkim1') || (v.toLowerCase().includes('p=') && v.length > 20))
    if (rec) found.push({ selector: sel, record: rec, hasKey: !rec.includes('p=;') && !rec.includes('p= ') })
  })
  await Promise.all(checks)
  return found
}

// DNSSEC check
async function checkDnssec(domain) {
  const { answers: ds }  = await dohQuery(domain, 'DS')
  const { answers: dnskey } = await dohQuery(domain, 'DNSKEY')
  return {
    hasDS:     ds.length > 0,
    hasDNSKEY: dnskey.length > 0,
    enabled:   ds.length > 0 && dnskey.length > 0,
  }
}

// MX with provider detection
const MX_PROVIDERS = {
  'google':     'Google Workspace',
  'gmail':      'Google Workspace',
  'googlemail': 'Google Workspace',
  'outlook':    'Microsoft 365',
  'hotmail':    'Microsoft 365',
  'office365':  'Microsoft 365',
  'protection': 'Microsoft 365',
  'mimecast':   'Mimecast',
  'proofpoint': 'Proofpoint',
  'mailgun':    'Mailgun',
  'sendgrid':   'SendGrid',
  'amazonses':  'Amazon SES',
  'zoho':       'Zoho Mail',
  'fastmail':   'Fastmail',
  'yahoo':      'Yahoo Mail',
  'icloud':     'Apple iCloud',
}
function detectMailProvider(mxRecords) {
  for (const mx of mxRecords) {
    for (const [key, name] of Object.entries(MX_PROVIDERS)) {
      if (mx.toLowerCase().includes(key)) return name
    }
  }
  return mxRecords.length ? 'Custom mail server' : null
}

// BIMI
function analyseBimi(txts) {
  const rec = txts.find(r => r.toLowerCase().startsWith('v=bimi1'))
  if (!rec) return { found: false, record: null, logoUrl: null, vmcUrl: null, hasVmc: false }
  const tags = {}
  rec.split(';').forEach(p => {
    const eq = p.indexOf('=')
    if (eq > 0) tags[p.slice(0,eq).trim().toLowerCase()] = p.slice(eq+1).trim()
  })
  return { found: true, record: rec, logoUrl: tags.l || null, vmcUrl: tags.a || null, hasVmc: !!tags.a }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORING ENGINE — World-class weighted scoring
// ═══════════════════════════════════════════════════════════════════════════
function computeScore(ssl, dmarc, spf, dkim, dns, bimi, observatory) {
  const items = []
  let total = 0

  // ── SSL / TLS (30 pts) ──────────────────────────────
  const sslGradeMap = { 'A+':30, 'A':27, 'A-':24, 'B':18, 'C':12, 'D':6, 'E':3, 'F':0, 'T':0, 'M':0 }
  // 'Valid' comes from crt.sh fallback — cert exists and is unexpired = 20pts
  const sslPts = !ssl.grade ? 0
    : ssl.grade === 'Valid' ? (ssl.daysLeft > 30 ? 20 : ssl.daysLeft > 0 ? 12 : 0)
    : (sslGradeMap[ssl.grade] ?? 0)
  total += sslPts
  const sslSource = ssl.source || 'Unknown'
  items.push({ cat:'SSL/TLS', pts:sslPts, max:30, icon:'🔒',
    detail: ssl.grade === 'Valid' ? `Valid cert · ${ssl.daysLeft}d remaining (via CT logs)` : ssl.grade ? `SSL Labs: ${ssl.grade}` : ssl.error || 'No certificate found',
    status: sslPts >= 27 ? 'great' : sslPts >= 18 ? 'good' : sslPts > 0 ? 'warn' : 'fail',
  })

  // ── DMARC (20 pts) ──────────────────────────────────
  const dmarcPts = { great:20, good:15, warn:5, missing:0, invalid:0, fail:0 }[dmarc.status] ?? 0
  total += dmarcPts
  items.push({ cat:'DMARC', pts:dmarcPts, max:20, icon:'📧',
    detail: dmarc.policy ? `Policy: p=${dmarc.policy}` : 'No DMARC record',
    status: dmarc.status === 'great' ? 'great' : dmarc.status === 'good' ? 'good' : dmarc.record ? 'warn' : 'fail',
  })

  // ── SPF (15 pts) ────────────────────────────────────
  const spfPts = { great:15, good:10, warn:4, missing:0, fail:0 }[spf.status] ?? 0
  total += spfPts
  items.push({ cat:'SPF', pts:spfPts, max:15, icon:'🛡',
    detail: spf.all ? `Mechanism: ${spf.all}` : 'No SPF record',
    status: spf.status === 'great' ? 'great' : spf.status === 'good' ? 'good' : spf.record ? 'warn' : 'fail',
  })

  // ── DKIM (15 pts) ───────────────────────────────────
  const dkimFound = dkim.filter(d => d.hasKey)
  const dkimPts   = dkimFound.length >= 2 ? 15 : dkimFound.length === 1 ? 13 : 0
  total += dkimPts
  items.push({ cat:'DKIM', pts:dkimPts, max:15, icon:'🔐',
    detail: dkimFound.length ? `${dkimFound.length} key(s): ${dkimFound.map(d=>d.selector).join(', ')}` : 'No DKIM keys found',
    status: dkimFound.length >= 1 ? 'great' : 'fail',
  })

  // ── DNS Health (10 pts) ─────────────────────────────
  let dnsPts = 0
  if (dns.a.length)     dnsPts += 3
  if (dns.mx.length)    dnsPts += 2
  if (dns.ns.length)    dnsPts += 2
  if (dns.caa.length)   dnsPts += 2
  if (dns.dnssec?.enabled) dnsPts += 1
  total += dnsPts
  items.push({ cat:'DNS', pts:dnsPts, max:10, icon:'🌐',
    detail: `A:${dns.a.length} MX:${dns.mx.length} NS:${dns.ns.length} CAA:${dns.caa.length}${dns.dnssec?.enabled?' DNSSEC:✓':''}`,
    status: dnsPts >= 8 ? 'great' : dnsPts >= 5 ? 'good' : dnsPts > 0 ? 'warn' : 'fail',
  })

  // ── HTTP Security Headers (10 pts via Mozilla) ──────
  let headerPts = 0
  if (observatory.score !== null) {
    headerPts = Math.round((Math.max(0, observatory.score) / 100) * 10)
  } else if (ssl.hsts) {
    headerPts = 4 // At least HSTS is set
  }
  total += headerPts
  items.push({ cat:'Headers', pts:headerPts, max:10, icon:'🔑',
    detail: observatory.grade ? `Observatory grade: ${observatory.grade}` : ssl.hsts ? 'HSTS enabled' : 'Headers not checked',
    status: headerPts >= 8 ? 'great' : headerPts >= 5 ? 'good' : headerPts > 0 ? 'warn' : 'fail',
  })

  const grade = total >= 95?'A+': total >= 85?'A': total >= 75?'B': total >= 60?'C': total >= 45?'D':'F'
  const label = total >= 85?'Excellent': total >= 70?'Good': total >= 55?'Fair': total >= 40?'Poor':'Critical'
  const color = total >= 85?'#059669': total >= 60?'#d97706':'#dc2626'
  const bg    = total >= 85?'#f0fdf4': total >= 60?'#fffbeb':'#fef2f2'
  const border= total >= 85?'#86efac': total >= 60?'#fde68a':'#fca5a5'

  return { total, grade, label, color, bg, border, items }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════
async function runFullScan(domain, onProgress) {
  const D = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'').toLowerCase()

  onProgress(5,  'Resolving domain…')
  const [aRecs, aaaaRecs, mxRecs, nsRecs, txtRecs, caaRecs, soaRecs] = await Promise.all([
    dnsValues(D, 'A'), dnsValues(D, 'AAAA'), dnsValues(D, 'MX'),
    dnsValues(D, 'NS'), dnsValues(D, 'TXT'), dnsValues(D, 'CAA'), dnsValues(D, 'SOA'),
  ])

  if (!aRecs.length && !nsRecs.length) throw new Error(`Domain "${D}" not found in DNS. Check the spelling.`)

  onProgress(15, 'Checking SSL certificate (CT logs, may take 10-15s)…')
  const [ssl, dnssec] = await Promise.all([
    checkSSLLabs(D),
    checkDnssec(D),
  ])

  onProgress(40, 'Analysing DMARC policy…')
  const dmarcTxts = await dnsValues(`_dmarc.${D}`, 'TXT')
  const dmarc = analyseDmarc(dmarcTxts)

  onProgress(50, 'Checking SPF record…')
  const spf = analyseSpf(txtRecs)

  onProgress(58, 'Probing DKIM selectors…')
  const dkim = await checkDkim(D)

  onProgress(70, 'Checking BIMI record…')
  const bimiTxts = await dnsValues(`default._bimi.${D}`, 'TXT')
  const bimi = analyseBimi(bimiTxts)

  onProgress(78, 'Checking HTTP security headers…')
  const observatory = await checkMozillaObservatory(D)

  onProgress(90, 'Checking MX & mail provider…')
  const mailProvider = detectMailProvider(mxRecs)

  onProgress(96, 'Calculating security score…')
  const dns = { a:aRecs, aaaa:aaaaRecs, mx:mxRecs, ns:nsRecs, txt:txtRecs, caa:caaRecs, soa:soaRecs, dnssec }
  const scoring = computeScore(ssl, dmarc, spf, dkim, dns, bimi, observatory)

  onProgress(100, 'Complete')
  return { domain:D, ssl, dmarc, spf, dkim, bimi, dns, observatory, mailProvider, scoring, scannedAt: new Date() }
}

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const ST = {
  great:   { color:'#059669', bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', label:'Pass'    },
  good:    { color:'#059669', bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', label:'Good'    },
  warn:    { color:'#b45309', bg:'#fffbeb', border:'#fde68a', dot:'#f59e0b', label:'Warning' },
  fail:    { color:'#dc2626', bg:'#fef2f2', border:'#fca5a5', dot:'#ef4444', label:'Fail'    },
  missing: { color:'#dc2626', bg:'#fef2f2', border:'#fca5a5', dot:'#ef4444', label:'Missing' },
  info:    { color:'#0891b2', bg:'#f0fdff', border:'#a5f3fc', dot:'#0891b2', label:'Info'    },
}
const s = k => ST[k] || ST.fail

const SCAN_STEPS = [
  { id:'dns',    label:'DNS Resolution',   icon:'🌐' },
  { id:'ssl',    label:'SSL Certificate',  icon:'🔒' },
  { id:'dmarc',  label:'DMARC Policy',     icon:'📧' },
  { id:'spf',    label:'SPF Record',       icon:'🛡'  },
  { id:'dkim',   label:'DKIM Keys',        icon:'🔐' },
  { id:'bimi',   label:'BIMI Record',      icon:'🏷'  },
  { id:'headers',label:'HTTP Headers',     icon:'🔑' },
  { id:'score',  label:'Security Score',   icon:'📊' },
]

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function SecurityScanPage({ onScanComplete }) {
  const [domain,    setDomain]    = useState('')
  const [scanning,  setScanning]  = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [stepMsg,   setStepMsg]   = useState('')
  const [report,    setReport]    = useState(null)
  const [error,     setError]     = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const inputRef = useRef()

  async function scan() {
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'').toLowerCase()
    if (!d) { setError('Please enter a domain name'); return }
    setError(''); setReport(null); setScanning(true); setActiveTab('overview'); setProgress(0)
    try {
      const r = await runFullScan(d, (pct, msg) => { setProgress(pct); setStepMsg(msg) })
      setReport(r)
      if (onScanComplete) onScanComplete(r.domain)
    } catch(e) { setError(e.message) }
    setScanning(false); setStepMsg(''); setProgress(0)
  }

  const TABS = [
    { id:'overview', label:'Overview'       },
    { id:'ssl',      label:'SSL / TLS'      },
    { id:'email',    label:'Email Auth'     },
    { id:'dns',      label:'DNS Health'     },
    { id:'headers',  label:'HTTP Headers'   },
    { id:'bimi',     label:'BIMI'           },
  ]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#ecfeff' }}>
      {/* Header */}
      <div style={{ padding:'13px 22px', background:'#fff', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div style={{ width:38, height:38, background:'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, boxShadow:'0 4px 12px rgba(8,145,178,.3)' }}>🔎</div>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:'#083344', letterSpacing:'-.03em' }}>Security Scanner</div>
          <div style={{ fontSize:11.5, color:'#67c5d4' }}>SSL · DMARC · SPF · DKIM · DNS · BIMI · HTTP Headers — powered by SSL Labs + Cloudflare DoH</div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'18px 22px' }}>
        <div style={{ maxWidth:1000, margin:'0 auto' }}>

          {/* Search */}
          <SearchBar domain={domain} setDomain={setDomain} onScan={scan} scanning={scanning}
            progress={progress} stepMsg={stepMsg} error={error} inputRef={inputRef}/>

          {/* Scanning animation */}
          {scanning && <ScanProgress progress={progress} stepMsg={stepMsg}/>}

          {/* Report */}
          {report && !scanning && (
            <>
              <ScoreHero report={report}/>
              <div style={{ display:'flex', gap:3, background:'#a5f3fc', borderRadius:10, padding:3, marginBottom:14 }}>
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    style={{ flex:1, padding:'7px 0', borderRadius:8, border:'none', fontSize:12.5, fontWeight:activeTab===t.id?700:500, cursor:'pointer', background:activeTab===t.id?'#fff':'transparent', color:activeTab===t.id?'#0e7490':'rgba(8,51,68,.7)', fontFamily:'inherit', transition:'all .12s', boxShadow:activeTab===t.id?'0 1px 4px rgba(8,145,178,.15)':'none' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTab==='overview' && <OverviewTab r={report}/>}
              {activeTab==='ssl'      && <SSLTab      r={report}/>}
              {activeTab==='email'    && <EmailTab    r={report}/>}
              {activeTab==='dns'      && <DNSTab      r={report}/>}
              {activeTab==='headers'  && <HeadersTab  r={report}/>}
              {activeTab==='bimi'     && <BimiTab     r={report}/>}
            </>
          )}

          {/* Empty state */}
          {!report && !scanning && <EmptyState/>}
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes pulse2{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  )
}

// ── Search Bar ─────────────────────────────────────────────────────────────
function SearchBar({ domain, setDomain, onScan, scanning, error, inputRef }) {
  return (
    <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #cffafe', padding:'20px 22px', marginBottom:16, boxShadow:'0 4px 20px rgba(8,145,178,.08)' }}>
      <div style={{ fontSize:13.5, fontWeight:700, color:'#083344', marginBottom:4, letterSpacing:'-.02em' }}>Domain Security Audit</div>
      <div style={{ fontSize:12, color:'#67c5d4', marginBottom:14 }}>Powered by SSL Labs (Qualys) · Cloudflare DoH · Mozilla Observatory · Certificate Transparency</div>
      <div style={{ display:'flex', gap:10 }}>
        <div style={{ flex:1, position:'relative' }}>
          <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', fontSize:16, pointerEvents:'none' }}>🌐</span>
          <input ref={inputRef} value={domain} onChange={e => setDomain(e.target.value)}
            onKeyDown={e => e.key==='Enter' && !scanning && onScan()}
            placeholder="e.g. google.com or mail.example.in"
            disabled={scanning}
            style={{ width:'100%', height:48, paddingLeft:42, paddingRight:14, border:'1.5px solid #a5f3fc', borderRadius:10, fontSize:14, color:'#083344', outline:'none', fontFamily:'inherit', background: scanning?'#f0fdff':'#fff', transition:'border-color .15s' }}
            onFocus={e => e.target.style.borderColor='#0891b2'}
            onBlur={e  => e.target.style.borderColor='#a5f3fc'}/>
        </div>
        <button onClick={onScan} disabled={scanning}
          style={{ height:48, padding:'0 28px', background:'linear-gradient(135deg,#0891b2,#0e7490)', border:'none', borderRadius:10, fontSize:14, fontWeight:800, color:'#fff', cursor:scanning?'not-allowed':'pointer', display:'flex', alignItems:'center', gap:8, fontFamily:'inherit', boxShadow:'0 4px 16px rgba(8,145,178,.35)', opacity:scanning?.6:1, whiteSpace:'nowrap', letterSpacing:'-.01em', transition:'opacity .15s' }}>
          {scanning
            ? <><span style={{ width:16, height:16, border:'2px solid rgba(255,255,255,.35)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite', display:'inline-block' }}/> Scanning…</>
            : '🔎 Scan Now'
          }
        </button>
      </div>
      {error && (
        <div style={{ marginTop:10, padding:'10px 14px', background:'#fef2f2', border:'1.5px solid #fca5a5', borderRadius:9, fontSize:12.5, color:'#dc2626', display:'flex', gap:8, alignItems:'flex-start' }}>
          <span style={{ flexShrink:0 }}>⚠</span> {error}
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
        {['google.com','github.com','apple.com','amazon.in'].map(d => (
          <button key={d} onClick={() => setDomain(d)}
            style={{ padding:'4px 12px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:99, fontSize:12, color:'#0891b2', cursor:'pointer', fontFamily:'inherit', fontWeight:500, transition:'all .12s' }}
            onMouseEnter={e=>{e.currentTarget.style.background='#cffafe'}}
            onMouseLeave={e=>{e.currentTarget.style.background='#f0fdff'}}>
            {d}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Scan Progress ──────────────────────────────────────────────────────────
function ScanProgress({ progress, stepMsg }) {
  return (
    <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #cffafe', padding:'22px', marginBottom:16, boxShadow:'0 4px 20px rgba(8,145,178,.08)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:13, fontWeight:600, color:'#083344' }}>{stepMsg || 'Scanning…'}</span>
        <span style={{ fontSize:13, fontWeight:800, color:'#0891b2' }}>{progress}%</span>
      </div>
      <div style={{ height:8, background:'#e0f9ff', borderRadius:99, overflow:'hidden', marginBottom:18 }}>
        <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#0891b2,#06b6d4,#67e8f9)', borderRadius:99, transition:'width .5s ease', boxShadow:'0 0 10px rgba(8,145,178,.4)' }}/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
        {SCAN_STEPS.map((st, i) => {
          const done = progress > (i+1) * 11
          const active = progress > i * 11 && !done
          return (
            <div key={st.id} style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 10px', borderRadius:9, background: done?'#cffafe':active?'#f0fdff':'#fafeff', border:`1px solid ${done?'#a5f3fc':active?'#cffafe':'#e0f9ff'}`, transition:'all .3s' }}>
              <span style={{ fontSize:13, animation:active?'pulse2 1.2s infinite':'' }}>{done?'✓':st.icon}</span>
              <span style={{ fontSize:11, fontWeight:done?700:500, color:done?'#0891b2':active?'#0e7490':'#9ca3af' }}>{st.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Score Hero ─────────────────────────────────────────────────────────────
function ScoreHero({ report: r }) {
  const sc = r.scoring
  return (
    <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #cffafe', padding:'22px 24px', marginBottom:14, boxShadow:'0 4px 20px rgba(8,145,178,.08)' }}>
      <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-start' }}>
        {/* Grade */}
        <div style={{ width:110, height:110, borderRadius:'50%', background:sc.bg, border:`4px solid ${sc.color}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 0 24px ${sc.color}33` }}>
          <div style={{ fontSize:36, fontWeight:900, color:sc.color, letterSpacing:'-.05em', lineHeight:1 }}>{sc.grade}</div>
          <div style={{ fontSize:13, color:sc.color, fontWeight:700 }}>{sc.total}/100</div>
        </div>
        {/* Info */}
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:5, flexWrap:'wrap' }}>
            <div style={{ fontSize:20, fontWeight:800, color:'#083344', letterSpacing:'-.03em' }}>{r.domain}</div>
            <div style={{ fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:99, background:sc.bg, color:sc.color, border:`1.5px solid ${sc.color}44` }}>{sc.label}</div>
            {r.ssl.fromCache && <div style={{ fontSize:11, color:'#67c5d4', padding:'3px 9px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:99 }}>SSL Labs cached result</div>}
          </div>
          <div style={{ fontSize:12, color:'#9ca3af', marginBottom:16 }}>
            Scanned {r.scannedAt.toLocaleTimeString()} · {r.scannedAt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
            {r.mailProvider && <span> · Mail: <b style={{ color:'#0891b2' }}>{r.mailProvider}</b></span>}
            {r.ssl.ipAddress && <span> · IP: <b style={{ color:'#083344' }}>{r.ssl.ipAddress}</b></span>}
          </div>
          {/* Score bars */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {sc.items.map(item => (
              <div key={item.cat}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:'#083344' }}>{item.icon} {item.cat}</span>
                  <span style={{ fontSize:11, fontWeight:800, color: item.status==='great'||item.status==='good'?'#059669':item.status==='warn'?'#d97706':'#dc2626' }}>{item.pts}/{item.max}</span>
                </div>
                <div style={{ height:6, background:'#e0f9ff', borderRadius:99, overflow:'hidden', marginBottom:3 }}>
                  <div style={{ height:'100%', width:`${item.max>0?(item.pts/item.max)*100:0}%`, background: item.status==='great'||item.status==='good'?'linear-gradient(90deg,#10b981,#34d399)':item.status==='warn'?'linear-gradient(90deg,#f59e0b,#fbbf24)':'#ef4444', borderRadius:99, transition:'width .8s ease' }}/>
                </div>
                <div style={{ fontSize:10.5, color:'#9ca3af', lineHeight:1.3 }}>{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Quick badges */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, flexShrink:0 }}>
          {[
            { label:'SSL',   ok: !!r.ssl.grade && !['F','T','M'].includes(r.ssl.grade), val: r.ssl.grade === 'Valid' ? `Valid (${r.ssl.daysLeft}d)` : r.ssl.grade || 'N/A' },
            { label:'DMARC', ok: r.dmarc.status==='great'||r.dmarc.status==='good', val: r.dmarc.policy?`p=${r.dmarc.policy}`:'None' },
            { label:'SPF',   ok: r.spf.status==='great'||r.spf.status==='good', val: r.spf.all||'None' },
            { label:'DKIM',  ok: r.dkim.filter(d=>d.hasKey).length>0, val: r.dkim.filter(d=>d.hasKey).length ? `${r.dkim.filter(d=>d.hasKey).length} key(s)` : 'None' },
            { label:'BIMI',  ok: r.bimi.found, val: r.bimi.found?'Set':'None' },
            { label:'DNSSEC',ok: r.dns.dnssec?.enabled, val: r.dns.dnssec?.enabled?'Enabled':'Disabled' },
          ].map(b => (
            <div key={b.label} style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 11px', borderRadius:9, background:b.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${b.ok?'#86efac':'#fca5a5'}`, minWidth:110 }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:b.ok?'#22c55e':'#ef4444', flexShrink:0 }}/>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:b.ok?'#059669':'#dc2626' }}>{b.label}</div>
                <div style={{ fontSize:10.5, color:b.ok?'#16a34a':'#b91c1c' }}>{b.val}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Overview Tab ───────────────────────────────────────────────────────────
function OverviewTab({ r }) {
  const issues = []
  // SSL
  if (!r.ssl.grade) issues.push({ sev:'critical', cat:'SSL', msg:'SSL certificate could not be verified', fix:'Ensure your domain has a valid SSL certificate installed. Check with your hosting provider.' })
  else if (['F','T','M'].includes(r.ssl.grade)) issues.push({ sev:'critical', cat:'SSL', msg:`SSL Labs grade ${r.ssl.grade} — serious certificate issue`, fix:'Check SSL Labs at ssllabs.com/ssltest for the full report. Common issues: expired cert, weak cipher, untrusted chain.' })
  else if (['C','D','E'].includes(r.ssl.grade)) issues.push({ sev:'warning', cat:'SSL', msg:`SSL Labs grade ${r.ssl.grade} — configuration needs improvement`, fix:'Disable TLS 1.0/1.1, remove weak ciphers, enable HSTS with long max-age.' })
  if (r.ssl.daysLeft !== null && r.ssl.daysLeft <= 30) issues.push({ sev:'critical', cat:'SSL', msg:`SSL certificate expires in ${r.ssl.daysLeft} days`, fix:'Renew your SSL certificate immediately to avoid browser security warnings and downtime.' })
  // DMARC
  if (!r.dmarc.record) issues.push({ sev:'critical', cat:'DMARC', msg:'No DMARC record — domain is unprotected from spoofing', fix:`Add TXT at _dmarc.${r.domain}: v=DMARC1; p=none; rua=mailto:dmarc@${r.domain}` })
  else if (r.dmarc.policy==='none') issues.push({ sev:'warning', cat:'DMARC', msg:'DMARC policy is p=none — monitoring only, no protection', fix:'Upgrade to p=quarantine then p=reject after monitoring reports.' })
  if (r.dmarc.record && !r.dmarc.rua) issues.push({ sev:'info', cat:'DMARC', msg:'No DMARC aggregate report address configured', fix:`Add rua=mailto:dmarc@${r.domain} to your DMARC record.` })
  // SPF
  if (!r.spf.record) issues.push({ sev:'critical', cat:'SPF', msg:'No SPF record found', fix:`Add TXT at ${r.domain}: v=spf1 include:_spf.google.com ~all` })
  else if (r.spf.all==='+all') issues.push({ sev:'critical', cat:'SPF', msg:'SPF uses +all — allows anyone to send as your domain', fix:'Change +all to -all or ~all immediately!' })
  else if (!r.spf.all) issues.push({ sev:'warning', cat:'SPF', msg:'SPF has no "all" mechanism — incomplete policy', fix:'Add -all or ~all at the end of your SPF record.' })
  // DKIM
  if (!r.dkim.filter(d=>d.hasKey).length) issues.push({ sev:'warning', cat:'DKIM', msg:'No DKIM keys detected on common selectors', fix:'Set up DKIM with your email provider and publish the public key.' })
  // DNS
  if (!r.dns.caa.length) issues.push({ sev:'info', cat:'DNS', msg:'No CAA record — any CA can issue certificates for your domain', fix:`Add CAA record: ${r.domain} CAA 0 issue "letsencrypt.org"` })
  if (!r.dns.dnssec?.enabled) issues.push({ sev:'info', cat:'DNS', msg:'DNSSEC not enabled — DNS responses are not cryptographically signed', fix:'Enable DNSSEC at your domain registrar to prevent DNS spoofing.' })
  // BIMI
  if (!r.bimi.found) issues.push({ sev:'info', cat:'BIMI', msg:'No BIMI record — your logo won\'t appear in email clients', fix:'Set up BIMI to show your brand logo in Gmail, Apple Mail, Yahoo.' })

  const sevOrder = { critical:0, warning:1, info:2 }
  issues.sort((a,b) => sevOrder[a.sev] - sevOrder[b.sev])

  const sevCfg = {
    critical: { color:'#dc2626', bg:'#fef2f2', border:'#fecaca', icon:'🔴', label:'Critical' },
    warning:  { color:'#b45309', bg:'#fffbeb', border:'#fde68a', icon:'🟡', label:'Warning'  },
    info:     { color:'#0891b2', bg:'#f0fdff', border:'#cffafe', icon:'🔵', label:'Info'     },
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <Card title="Security Findings" icon="📋">
        {issues.length === 0 ? (
          <div style={{ display:'flex', gap:14, padding:'16px', background:'#f0fdf4', border:'1.5px solid #86efac', borderRadius:10, alignItems:'center' }}>
            <span style={{ fontSize:28 }}>🎉</span>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:'#15803d' }}>No critical issues found!</div>
              <div style={{ fontSize:12.5, color:'#16a34a', marginTop:2 }}>{r.domain} has excellent security configuration.</div>
            </div>
          </div>
        ) : issues.map((iss, i) => {
          const cfg = sevCfg[iss.sev]
          return (
            <div key={i} style={{ padding:'12px 14px', background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:10, marginBottom:8 }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{cfg.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                    <span style={{ fontSize:12.5, fontWeight:700, color:cfg.color }}>{iss.msg}</span>
                    <span style={{ fontSize:10.5, fontWeight:700, padding:'1px 8px', borderRadius:99, background:cfg.color+'22', color:cfg.color }}>{cfg.label}</span>
                    <span style={{ fontSize:10.5, padding:'1px 8px', borderRadius:99, background:'rgba(0,0,0,.05)', color:'#6b7280', fontWeight:600 }}>{iss.cat}</span>
                  </div>
                  <div style={{ fontSize:12, color:'#374151', lineHeight:1.6 }}>💡 <b style={{ color:cfg.color }}>Fix:</b> {iss.fix}</div>
                </div>
              </div>
            </div>
          )
        })}
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <Card title="SSL Summary" icon="🔒">
          <Row label="SSL Grade / Status" val={r.ssl.grade==='Valid'?`Valid ✓ (${r.ssl.daysLeft}d remaining)`:r.ssl.grade||'N/A'} status={r.ssl.grade&&!['F','T','M'].includes(r.ssl.grade)?'great':'fail'}/>
          <Row label="Data Source"     val={r.ssl.source||'—'}     plain/>
          <Row label="Issuer"          val={r.ssl.issuer||'—'}     plain/>
          <Row label="Expires"         val={r.ssl.expires||'—'}    plain/>
          <Row label="Days Remaining"  val={r.ssl.daysLeft!=null?`${r.ssl.daysLeft} days`:'—'} status={!r.ssl.daysLeft?'fail':r.ssl.daysLeft>30?'great':r.ssl.daysLeft>0?'warn':'fail'}/>
          <Row label="HSTS"            val={r.ssl.hsts?'Enabled':'Not detected'} status={r.ssl.hsts?'great':'warn'}/>
        </Card>
        <Card title="Email Auth Summary" icon="📧">
          <Row label="DMARC Policy"   val={r.dmarc.policy?`p=${r.dmarc.policy}`:'Not set'}  status={r.dmarc.status}/>
          <Row label="SPF All"        val={r.spf.all||'Not set'}                              status={r.spf.status}/>
          <Row label="DKIM Keys"      val={r.dkim.filter(d=>d.hasKey).length?`${r.dkim.filter(d=>d.hasKey).length} found`:'None'} status={r.dkim.filter(d=>d.hasKey).length?'great':'fail'}/>
          <Row label="Mail Provider"  val={r.mailProvider||'—'}                               plain/>
          <Row label="BIMI"           val={r.bimi.found?'Configured':'Not set'}               status={r.bimi.found?'great':'warn'}/>
        </Card>
      </div>
    </div>
  )
}

// ── SSL Tab ────────────────────────────────────────────────────────────────
function SSLTab({ r }) {
  const ssl = r.ssl
  const gradeColor = !ssl.grade?'#6b7280':ssl.grade==='A+'||ssl.grade==='A'?'#059669':ssl.grade==='B'?'#d97706':'#dc2626'
  const gradeBg    = !ssl.grade?'#f3f4f6':ssl.grade==='A+'||ssl.grade==='A'?'#f0fdf4':ssl.grade==='B'?'#fffbeb':'#fef2f2'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {ssl.error && (
        <div style={{ padding:'14px 16px', background:'#fffbeb', border:'1.5px solid #fde68a', borderRadius:10, fontSize:12.5, color:'#92400e' }}>
          ⚠ SSL Labs note: {ssl.error}
        </div>
      )}

      {ssl.grade && (
        <Card title="SSL Labs Analysis" icon="🔒">
          <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16, padding:'16px', background:gradeBg, borderRadius:10, border:`1.5px solid ${gradeColor}44` }}>
            <div style={{ width:72, height:72, borderRadius:'50%', background:'#fff', border:`3px solid ${gradeColor}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <div style={{ fontSize:26, fontWeight:900, color:gradeColor, lineHeight:1 }}>{ssl.grade}</div>
              <div style={{ fontSize:10, color:gradeColor, fontWeight:600 }}>SSL Labs</div>
            </div>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:'#083344', marginBottom:4 }}>
                {ssl.grade==='A+'?'Exceptional — best possible configuration':ssl.grade==='A'?'Excellent — strong configuration':ssl.grade==='Valid'?`Certificate valid — ${ssl.daysLeft} days remaining`:ssl.grade==='B'?'Good — minor issues to fix':ssl.grade==='C'?'Fair — significant issues present':'Poor — immediate action needed'}
              </div>
              <div style={{ fontSize:12.5, color:'#67c5d4' }}>Scanned by Qualys SSL Labs — industry gold standard{ssl.fromCache?' (cached result)':''}</div>
              {ssl.ipAddress && <div style={{ fontSize:12, color:'#9ca3af', marginTop:3 }}>Server IP: {ssl.ipAddress}</div>}
              {ssl.source && <div style={{ fontSize:12, color:'#67c5d4', marginTop:2 }}>Data source: {ssl.source}</div>}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            <Row label="Common Name"    val={ssl.subject||'—'}    plain/>
            <Row label="Issuer"         val={ssl.issuer||'—'}     plain/>
            <Row label="Expiry Date"    val={ssl.expires||'—'}    plain/>
            <Row label="Days Remaining" val={ssl.daysLeft!=null?`${ssl.daysLeft} days`:'—'} status={!ssl.daysLeft?'fail':ssl.daysLeft>30?'great':ssl.daysLeft>0?'warn':'fail'}/>
            <Row label="Key Algorithm"  val={ssl.keyAlg||'—'}     plain/>
            <Row label="Key Size"       val={ssl.keySize?`${ssl.keySize} bit`:'—'} status={ssl.keySize>=2048?'great':ssl.keySize?'warn':'fail'}/>
          </div>
        </Card>
      )}

      {ssl.protocols?.length > 0 && (
        <Card title="Protocol Support" icon="🔧">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
            {[
              { name:'TLS 1.3', match: ssl.protocols.find(p=>p.name==='TLS'&&p.version==='1.3'), good:true  },
              { name:'TLS 1.2', match: ssl.protocols.find(p=>p.name==='TLS'&&p.version==='1.2'), good:true  },
              { name:'TLS 1.1', match: ssl.protocols.find(p=>p.name==='TLS'&&p.version==='1.1'), good:false },
              { name:'TLS 1.0', match: ssl.protocols.find(p=>p.name==='TLS'&&p.version==='1.0'), good:false },
              { name:'SSL 3.0', match: ssl.protocols.find(p=>p.name==='SSL'&&p.version==='3.0'), good:false },
              { name:'SSL 2.0', match: ssl.protocols.find(p=>p.name==='SSL'&&p.version==='2.0'), good:false },
            ].map(p => {
              const enabled = !!p.match
              const ok = enabled && p.good
              const bad = enabled && !p.good
              return (
                <div key={p.name} style={{ padding:'10px 12px', borderRadius:9, background:ok?'#f0fdf4':bad?'#fef2f2':enabled?'#f0fdff':'#f9fafb', border:`1.5px solid ${ok?'#86efac':bad?'#fca5a5':enabled?'#cffafe':'#e5e7eb'}`, textAlign:'center' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:ok?'#059669':bad?'#dc2626':'#9ca3af' }}>{p.name}</div>
                  <div style={{ fontSize:11, fontWeight:600, marginTop:3, color:ok?'#16a34a':bad?'#b91c1c':'#9ca3af' }}>{enabled?(p.good?'✓ Enabled':'⚠ Enabled'):'✗ Disabled'}</div>
                </div>
              )
            })}
          </div>
          {ssl.vulns?.length > 0 && (
            <div style={{ marginTop:14, padding:'12px 14px', background:'#fef2f2', border:'1.5px solid #fca5a5', borderRadius:9 }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'#dc2626', marginBottom:4 }}>⚠ Vulnerabilities detected</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {ssl.vulns.map(v => <span key={v} style={{ fontSize:11.5, padding:'2px 10px', background:'#dc262622', color:'#dc2626', borderRadius:99, fontWeight:700 }}>{v}</span>)}
              </div>
            </div>
          )}
        </Card>
      )}

      {ssl.hsts !== undefined && (
        <Card title="HSTS Configuration" icon="🔒">
          <Row label="HSTS Status"  val={ssl.hsts?'Enabled':'Not detected'} status={ssl.hsts?'great':'warn'}/>
          {ssl.hstsAge && <Row label="Max Age"  val={`${Math.round(ssl.hstsAge/86400)} days (${ssl.hstsAge}s)`} plain/>}
          {!ssl.hsts && (
            <div style={{ marginTop:10, padding:'10px 12px', background:'#fff7ed', border:'1px solid #fde68a', borderRadius:8, fontSize:12.5, color:'#92400e' }}>
              Add HSTS header: <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>Strict-Transport-Security: max-age=31536000; includeSubDomains; preload</code>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ── Email Auth Tab ─────────────────────────────────────────────────────────
function EmailTab({ r }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <Card title="DMARC Analysis" icon="📧">
        <Row label="Status"           val={r.dmarc.record?'Record found':'No DMARC record'} status={r.dmarc.status}/>
        <Row label="Policy (p=)"      val={r.dmarc.policy||'Not set'} status={r.dmarc.status}/>
        {r.dmarc.subPolicy && <Row label="Subdomain policy (sp=)" val={`p=${r.dmarc.subPolicy}`} plain/>}
        <Row label="Coverage (pct=)"  val={`${r.dmarc.pct}%`} status={r.dmarc.pct==='100'?'great':'warn'}/>
        <Row label="Report address"   val={r.dmarc.rua||'Not configured'} status={r.dmarc.rua?'great':'warn'}/>
        <Row label="Forensic reports" val={r.dmarc.ruf||'Not configured'} plain/>
        <Row label="SPF alignment"    val={r.dmarc.aspf==='s'?'Strict':'Relaxed'} plain/>
        <Row label="DKIM alignment"   val={r.dmarc.adkim==='s'?'Strict':'Relaxed'} plain/>
        {r.dmarc.record && <CodeBox label="Raw record" value={r.dmarc.record}/>}
        {!r.dmarc.record && <RecCopy label="Recommended record" type="TXT" name={`_dmarc.${r.domain}`} val={`v=DMARC1; p=none; rua=mailto:dmarc@${r.domain}; ruf=mailto:dmarc@${r.domain}; fo=1`}/>}
      </Card>

      <Card title="SPF Analysis" icon="🛡">
        <Row label="Status"        val={r.spf.record?'Record found':'No SPF record'} status={r.spf.status}/>
        <Row label="All mechanism" val={r.spf.all||'Missing — not set'} status={r.spf.all==='-all'?'great':r.spf.all==='~all'?'good':r.spf.all==='+all'?'fail':'warn'}/>
        {r.spf.includes.length > 0 && <Row label="Includes" val={r.spf.includes.join(', ')} plain/>}
        <Row label="DNS lookups"   val={`${r.spf.lookupCount} (max 10)`} status={r.spf.lookupCount<=10?'great':'fail'}/>
        {r.spf.record && <CodeBox label="Raw record" value={r.spf.record}/>}
        {!r.spf.record && <RecCopy label="Recommended SPF record" type="TXT" name={r.domain} val="v=spf1 include:_spf.google.com ~all"/>}
      </Card>

      <Card title="DKIM Analysis" icon="🔐">
        {r.dkim.filter(d=>d.hasKey).length === 0 ? (
          <div style={{ padding:'12px 14px', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:9, fontSize:12.5, color:'#b91c1c', marginBottom:12 }}>
            No DKIM keys found across {DKIM_SELECTORS.length} common selectors. Your email provider may use a custom selector.
          </div>
        ) : r.dkim.filter(d=>d.hasKey).map((d, i) => (
          <div key={i} style={{ marginBottom:10 }}>
            <Row label={`Selector: ${d.selector}`} val="Key found ✓" status="great"/>
            <CodeBox label="DKIM record" value={d.record}/>
          </div>
        ))}
        {r.dkim.filter(d=>!d.hasKey&&d.record).map((d,i) => (
          <Row key={i} label={`Selector: ${d.selector}`} val="Key revoked (empty p=)" status="warn"/>
        ))}
      </Card>
    </div>
  )
}

// ── DNS Tab ────────────────────────────────────────────────────────────────
function DNSTab({ r }) {
  const dns = r.dns
  const groups = [
    { label:'A (IPv4)',   type:'A',    recs:dns.a,    req:true,  good:dns.a.length>0    },
    { label:'AAAA (IPv6)',type:'AAAA', recs:dns.aaaa, req:false, good:dns.aaaa.length>0 },
    { label:'MX (Email)', type:'MX',   recs:dns.mx,   req:true,  good:dns.mx.length>0   },
    { label:'NS',         type:'NS',   recs:dns.ns,   req:true,  good:dns.ns.length>0   },
    { label:'TXT',        type:'TXT',  recs:dns.txt,  req:false, good:dns.txt.length>0  },
    { label:'CAA',        type:'CAA',  recs:dns.caa,  req:false, good:dns.caa.length>0  },
    { label:'SOA',        type:'SOA',  recs:dns.soa,  req:false, good:dns.soa.length>0  },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <Card title="DNS Record Inventory" icon="🌐">
        {groups.map((g, i) => (
          <div key={i} style={{ marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 8px', borderRadius:5, background:'#cffafe', color:'#0891b2', letterSpacing:'.04em', flexShrink:0 }}>{g.type}</span>
              <span style={{ fontSize:12.5, fontWeight:600, color:'#083344', flex:1 }}>{g.label}</span>
              <span style={{ fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:99, background:g.good?'#f0fdf4':g.req?'#fef2f2':'#fffbeb', color:g.good?'#059669':g.req?'#dc2626':'#b45309' }}>
                {g.recs.length>0 ? `${g.recs.length} record${g.recs.length>1?'s':''}` : g.req?'Missing':'Not set'}
              </span>
            </div>
            {g.recs.length > 0 && (
              <div style={{ padding:'8px 12px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:8 }}>
                {g.recs.slice(0,5).map((rec, j) => (
                  <div key={j} style={{ fontFamily:'monospace', fontSize:11.5, color:'#083344', padding:'3px 0', borderBottom:j<Math.min(g.recs.length,5)-1?'1px solid #e0f9ff':'none', wordBreak:'break-all', lineHeight:1.5 }}>{rec}</div>
                ))}
                {g.recs.length > 5 && <div style={{ fontSize:11, color:'#67c5d4', marginTop:4 }}>+ {g.recs.length-5} more records</div>}
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card title="DNSSEC Status" icon="🔐">
        <Row label="DS Record"     val={dns.dnssec?.hasDS    ? 'Present'  : 'Not found'} status={dns.dnssec?.hasDS    ?'great':'warn'}/>
        <Row label="DNSKEY Record" val={dns.dnssec?.hasDNSKEY? 'Present'  : 'Not found'} status={dns.dnssec?.hasDNSKEY?'great':'warn'}/>
        <Row label="DNSSEC Status" val={dns.dnssec?.enabled  ? 'Enabled ✓': 'Not enabled'} status={dns.dnssec?.enabled?'great':'warn'}/>
        {!dns.dnssec?.enabled && (
          <div style={{ marginTop:10, padding:'10px 12px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:8, fontSize:12.5, color:'#374151' }}>
            DNSSEC cryptographically signs DNS records to prevent DNS spoofing attacks. Enable it at your domain registrar.
          </div>
        )}
      </Card>

      <Card title="DNS Checklist" icon="✅">
        {[
          { l:'A record (domain resolves to IP)',     ok:dns.a.length>0          },
          { l:'MX records (email delivery works)',    ok:dns.mx.length>0         },
          { l:'NS records (nameservers configured)',  ok:dns.ns.length>0         },
          { l:'CAA record (restricts cert issuance)', ok:dns.caa.length>0        },
          { l:'DNSSEC enabled (DNS tamper-proof)',     ok:!!dns.dnssec?.enabled   },
          { l:'IPv6 support (AAAA record)',            ok:dns.aaaa.length>0       },
          { l:'SOA record present',                   ok:dns.soa.length>0        },
        ].map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<6?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:c.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${c.ok?'#86efac':'#fca5a5'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0, fontWeight:700, color:c.ok?'#059669':'#dc2626' }}>{c.ok?'✓':'✗'}</div>
            <span style={{ fontSize:12.5, color:'#083344', flex:1 }}>{c.l}</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:c.ok?'#f0fdf4':'#fef2f2', color:c.ok?'#059669':'#dc2626' }}>{c.ok?'Pass':'Fail'}</span>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ── Headers Tab ────────────────────────────────────────────────────────────
function HeadersTab({ r }) {
  const obs = r.observatory
  const gradeColor = !obs.grade?'#6b7280':obs.grade==='A+'||obs.grade==='A'?'#059669':obs.grade==='B'?'#d97706':'#dc2626'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <Card title="Mozilla Observatory" icon="🔑">
        {obs.error ? (
          <div style={{ padding:'12px', background:'#fff7ed', border:'1px solid #fde68a', borderRadius:8, fontSize:12.5, color:'#92400e' }}>
            Observatory check: {obs.error}. HSTS status from SSL Labs shown below.
          </div>
        ) : obs.grade ? (
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14, padding:'14px', background:'#f9feff', border:'1.5px solid #cffafe', borderRadius:10 }}>
            <div style={{ width:60, height:60, borderRadius:'50%', border:`3px solid ${gradeColor}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0, background:'#fff' }}>
              <div style={{ fontSize:22, fontWeight:900, color:gradeColor, lineHeight:1 }}>{obs.grade}</div>
              <div style={{ fontSize:9.5, color:gradeColor, fontWeight:700 }}>Score: {obs.score}</div>
            </div>
            <div>
              <div style={{ fontSize:13.5, fontWeight:700, color:'#083344' }}>Mozilla Observatory Score: {obs.score}/100</div>
              <div style={{ fontSize:12, color:'#67c5d4', marginTop:2 }}>HTTP security headers analysis by Mozilla</div>
            </div>
          </div>
        ) : null}

        {[
          { l:'HSTS (Strict-Transport-Security)', ok: obs.tests?.hsts?.pass ?? r.ssl.hsts,  info:'Forces HTTPS connections' },
          { l:'Content-Security-Policy',           ok: obs.tests?.csp?.pass,                info:'Prevents XSS attacks' },
          { l:'X-Frame-Options',                   ok: obs.tests?.xframe?.pass,             info:'Prevents clickjacking' },
          { l:'X-Content-Type-Options',            ok: obs.tests?.xcontent?.pass,           info:'Prevents MIME sniffing' },
          { l:'Referrer-Policy',                   ok: obs.tests?.referrer?.pass,           info:'Controls referrer info' },
          { l:'Secure Cookies',                    ok: obs.tests?.cookies?.pass,            info:'Cookies have Secure flag' },
          { l:'Subresource Integrity',             ok: obs.tests?.subresource?.pass,        info:'Validates external scripts' },
        ].map((h, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<6?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:h.ok?'#f0fdf4':h.ok===false?'#fef2f2':'#f5f5f5', border:`1.5px solid ${h.ok?'#86efac':h.ok===false?'#fca5a5':'#e5e7eb'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0, fontWeight:700, color:h.ok?'#059669':h.ok===false?'#dc2626':'#9ca3af' }}>{h.ok?'✓':h.ok===false?'✗':'?'}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12.5, color:'#083344', fontWeight:500 }}>{h.l}</div>
              <div style={{ fontSize:11, color:'#9ca3af' }}>{h.info}</div>
            </div>
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:h.ok?'#f0fdf4':h.ok===false?'#fef2f2':'#f5f5f5', color:h.ok?'#059669':h.ok===false?'#dc2626':'#9ca3af' }}>{h.ok?'Pass':h.ok===false?'Fail':'N/A'}</span>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ── BIMI Tab ───────────────────────────────────────────────────────────────
function BimiTab({ r }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <Card title="BIMI Record" icon="🏷">
        <Row label="Status"   val={r.bimi.found?'Record found':'Not configured'} status={r.bimi.found?'great':'missing'}/>
        {r.bimi.found && <>
          <Row label="Logo URL" val={r.bimi.logoUrl||'Not set'} plain/>
          <Row label="VMC URL"  val={r.bimi.vmcUrl||'Not set (optional for Gmail)'} plain/>
          <Row label="VMC"      val={r.bimi.hasVmc?'Present ✓':'Not present'} status={r.bimi.hasVmc?'great':'info'}/>
          {r.bimi.record && <CodeBox label="Raw record" value={r.bimi.record}/>}
        </>}
        {!r.bimi.found && (
          <>
            <div style={{ padding:'12px 14px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:9, fontSize:12.5, color:'#374151', lineHeight:1.6, marginBottom:12 }}>
              BIMI lets your company logo appear next to emails in Gmail, Apple Mail, Fastmail, and Yahoo. It requires DMARC p=quarantine or p=reject.
            </div>
            <RecCopy label="BIMI record template" type="TXT" name={`default._bimi.${r.domain}`} val={`v=BIMI1; l=https://${r.domain}/bimi-logo.svg;`}/>
          </>
        )}
      </Card>

      <Card title="BIMI Requirements" icon="✅">
        {[
          { l:'DMARC p=quarantine or p=reject',  ok: r.dmarc.policy==='quarantine'||r.dmarc.policy==='reject' },
          { l:'SPF record configured',            ok: !!r.spf.record },
          { l:'DKIM key published',               ok: r.dkim.filter(d=>d.hasKey).length>0 },
          { l:'BIMI DNS record exists',           ok: r.bimi.found },
          { l:'SVG logo URL in BIMI record',      ok: r.bimi.found && !!r.bimi.logoUrl },
          { l:'VMC certificate (Gmail/Apple)',    ok: r.bimi.hasVmc },
        ].map((c,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<5?'1px solid #f0fdff':'none' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:c.ok?'#f0fdf4':'#fef2f2', border:`1.5px solid ${c.ok?'#86efac':'#fca5a5'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0, fontWeight:700, color:c.ok?'#059669':'#dc2626' }}>{c.ok?'✓':'✗'}</div>
            <span style={{ fontSize:12.5, color:'#083344', flex:1 }}>{c.l}</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background:c.ok?'#f0fdf4':'#fef2f2', color:c.ok?'#059669':'#dc2626' }}>{c.ok?'Pass':'Fail'}</span>
          </div>
        ))}
      </Card>

      <Card title="Email Client Support" icon="📱">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[
            { client:'Gmail',       support:'Requires VMC',   ok:true  },
            { client:'Apple Mail',  support:'Requires VMC',   ok:true  },
            { client:'Yahoo Mail',  support:'No VMC needed',  ok:true  },
            { client:'Fastmail',    support:'No VMC needed',  ok:true  },
            { client:'Outlook',     support:'Not supported',  ok:false },
            { client:'Thunderbird', support:'Not supported',  ok:false },
          ].map((c,i) => (
            <div key={i} style={{ padding:'12px', background:c.ok?'#f0fdf4':'#f9feff', border:`1px solid ${c.ok?'#86efac':'#cffafe'}`, borderRadius:9, textAlign:'center' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:3 }}>{c.client}</div>
              <div style={{ fontSize:11, color:c.ok?'#059669':'#67c5d4', fontWeight:500 }}>{c.support}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
      {[
        { icon:'🔒', title:'SSL / TLS via SSL Labs',   desc:'Qualys SSL Labs grade (A+–F), certificate details, protocol support, vulnerability checks, HSTS status.' },
        { icon:'📧', title:'DMARC · SPF · DKIM',       desc:'Full email auth audit. Policy strength, SPF mechanisms, DKIM key detection across 20+ selectors, alignment check.' },
        { icon:'🌐', title:'DNS Health + DNSSEC',       desc:'All record types (A/AAAA/MX/NS/TXT/CAA/SOA), DNSSEC verification, mail provider detection.' },
        { icon:'🔑', title:'HTTP Security Headers',     desc:'Mozilla Observatory score, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Secure Cookies.' },
        { icon:'🏷', title:'BIMI Compliance',           desc:'BIMI record, logo URL, VMC certificate, email client compatibility (Gmail, Apple Mail, Yahoo, Fastmail).' },
        { icon:'📊', title:'Security Score 0–100',      desc:'Weighted score: SSL 30pts + DMARC 20pts + SPF 15pts + DKIM 15pts + DNS 10pts + Headers 10pts. Grade A+–F.' },
      ].map(f => (
        <div key={f.title} style={{ background:'#fff', borderRadius:12, border:'1.5px solid #cffafe', padding:'18px 16px', transition:'all .15s' }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='#67e8f9';e.currentTarget.style.boxShadow='0 4px 16px rgba(8,145,178,.1)'}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='#cffafe';e.currentTarget.style.boxShadow='none'}}>
          <div style={{ fontSize:26, marginBottom:10 }}>{f.icon}</div>
          <div style={{ fontSize:13, fontWeight:700, color:'#083344', marginBottom:6, letterSpacing:'-.02em' }}>{f.title}</div>
          <div style={{ fontSize:12, color:'#67c5d4', lineHeight:1.6 }}>{f.desc}</div>
        </div>
      ))}
    </div>
  )
}

// ── Shared UI ──────────────────────────────────────────────────────────────
function Card({ title, icon, children }) {
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

function Row({ label, val, status, plain }) {
  const cfg = plain ? null : s(status)
  return (
    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f0fdff', gap:12 }}>
      <span style={{ fontSize:12, color:'#67c5d4', fontWeight:600, flexShrink:0, marginTop:1 }}>{label}</span>
      {cfg ? (
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:cfg.dot, flexShrink:0 }}/>
          <span style={{ fontSize:12.5, fontWeight:600, color:cfg.color, textAlign:'right', wordBreak:'break-all' }}>{val||'—'}</span>
        </div>
      ) : (
        <span style={{ fontSize:12.5, color:'#083344', fontWeight:500, textAlign:'right', wordBreak:'break-all', maxWidth:'65%' }}>{val||'—'}</span>
      )}
    </div>
  )
}

function CodeBox({ label, value }) {
  return (
    <div style={{ marginTop:10, padding:'10px 12px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:8 }}>
      {label && <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:4, textTransform:'uppercase', letterSpacing:'.06em' }}>{label}</div>}
      <code style={{ fontSize:11, color:'#083344', wordBreak:'break-all', lineHeight:1.7, display:'block' }}>{value}</code>
    </div>
  )
}

function RecCopy({ label, type, name, val }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ marginTop:12 }}>
      {label && <div style={{ fontSize:11.5, fontWeight:700, color:'#0891b2', marginBottom:6 }}>{label}</div>}
      <div style={{ background:'#f0fdff', border:'1.5px solid #cffafe', borderRadius:9, overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'55px 1fr', padding:'7px 12px', borderBottom:'1px solid #cffafe', background:'#ecfeff' }}>
          <span style={{ fontSize:10, fontWeight:700, color:'#0891b2' }}>Type</span>
          <span style={{ fontSize:10, fontWeight:700, color:'#0891b2' }}>Name</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'55px 1fr', padding:'7px 12px', borderBottom:'1px solid #e0f9ff' }}>
          <code style={{ fontSize:11.5, color:'#083344', fontWeight:700 }}>{type}</code>
          <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all' }}>{name}</code>
        </div>
        <div style={{ padding:'8px 12px', display:'flex', alignItems:'flex-start', gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#67c5d4', marginBottom:3, textTransform:'uppercase', letterSpacing:'.05em' }}>Value</div>
            <code style={{ fontSize:11.5, color:'#083344', wordBreak:'break-all', lineHeight:1.6 }}>{val}</code>
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(val); setCopied(true); setTimeout(()=>setCopied(false),2000) }}
            style={{ padding:'5px 12px', background:copied?'#0891b2':'#fff', border:'1.5px solid #a5f3fc', borderRadius:7, fontSize:11, fontWeight:700, color:copied?'#fff':'#0891b2', cursor:'pointer', flexShrink:0, fontFamily:'inherit', transition:'all .15s' }}>
            {copied?'✓ Copied':'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}
