import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

// ── DNS lookup via Cloudflare DoH ─────────────────────────────────────────
async function dnsLookup(name, type = 'TXT') {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  const res = await fetch(url, { headers: { Accept: 'application/dns-json' } })
  if (!res.ok) return []
  const data = await res.json()
  return (data.Answer || []).map(r => r.data?.replace(/"/g, '').trim()).filter(Boolean)
}

// ── Parsers ───────────────────────────────────────────────────────────────
function parseDmarc(records) {
  const rec = records.find(r => r.toLowerCase().startsWith('v=dmarc1'))
  if (!rec) return { record: null, status: 'missing', policy: null, pct: null, rua: null, ruf: null, aspf: null, adkim: null }
  const tags = {}
  rec.split(';').forEach(p => {
    const [k, v] = p.trim().split('=')
    if (k && v) tags[k.trim().toLowerCase()] = v.trim()
  })
  const policy = tags.p || null
  const status = !policy ? 'invalid' : policy === 'none' ? 'warn' : policy === 'quarantine' ? 'good' : policy === 'reject' ? 'great' : 'warn'
  return { record: rec, status, policy, pct: tags.pct || '100', rua: tags.rua || null, ruf: tags.ruf || null, aspf: tags.aspf || 'r', adkim: tags.adkim || 'r' }
}

function parseSpf(records) {
  const rec = records.find(r => r.toLowerCase().startsWith('v=spf1'))
  if (!rec) return { record: null, status: 'missing', mechanisms: [], all: null }
  const parts = rec.split(/\s+/)
  const all = parts.find(p => p.toLowerCase().endsWith('all'))
  const mechanisms = parts.filter(p => !p.startsWith('v=') && !p.toLowerCase().endsWith('all'))
  const status = !all ? 'warn' : all === '-all' ? 'great' : all === '~all' ? 'good' : 'warn'
  return { record: rec, status, mechanisms, all }
}

function parseDkim(records, selector) {
  const rec = records.find(r => r.toLowerCase().includes('v=dkim1') || r.toLowerCase().includes('p='))
  if (!rec) return { record: null, status: 'missing', keyType: null, hasKey: false }
  const hasKey = rec.includes('p=') && !rec.includes('p=;') && !rec.includes('p= ')
  const keyType = rec.includes('k=rsa') ? 'RSA' : rec.includes('k=ed25519') ? 'Ed25519' : 'RSA'
  return { record: rec, status: hasKey ? 'great' : 'missing', keyType, hasKey }
}

// ── Score calculator ──────────────────────────────────────────────────────
function calcScore(dmarc, spf, dkim) {
  let score = 0
  if (dmarc.status === 'great') score += 40
  else if (dmarc.status === 'good') score += 28
  else if (dmarc.status === 'warn') score += 15
  if (spf.status === 'great') score += 30
  else if (spf.status === 'good') score += 20
  else if (spf.status === 'warn') score += 10
  if (dkim.status === 'great') score += 30
  return Math.min(score, 100)
}

function scoreColor(s) { return s >= 80 ? '#059669' : s >= 50 ? '#d97706' : '#dc2626' }
function scoreLabel(s) { return s >= 80 ? 'Strong' : s >= 50 ? 'Moderate' : 'Weak' }

function statusCfg(st) {
  return {
    great:   { bg:'#ecfdf5', color:'#059669', border:'#86efac', label:'Pass',    dot:'#059669' },
    good:    { bg:'#f0fdf4', color:'#16a34a', border:'#bbf7d0', label:'Good',    dot:'#16a34a' },
    warn:    { bg:'#fffbeb', color:'#d97706', border:'#fde68a', label:'Warning', dot:'#d97706' },
    missing: { bg:'#fef2f2', color:'#dc2626', border:'#fca5a5', label:'Missing', dot:'#dc2626' },
    invalid: { bg:'#fef2f2', color:'#dc2626', border:'#fca5a5', label:'Invalid', dot:'#dc2626' },
  }[st] || { bg:'#f3f4f6', color:'#6b7280', border:'#d1d5db', label:'Unknown', dot:'#9ca3af' }
}

// ── Recommendations ───────────────────────────────────────────────────────
function getRecommendations(dmarc, spf, dkim) {
  const recs = []
  if (dmarc.status === 'missing') recs.push({ severity:'error', title:'No DMARC record found', detail:'Add a TXT record at _dmarc.yourdomain.com with at minimum: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com' })
  else if (dmarc.policy === 'none') recs.push({ severity:'warn', title:'DMARC policy is set to none', detail:'Change p=none to p=quarantine or p=reject to actively protect your domain from spoofing.' })
  else if (dmarc.policy === 'quarantine') recs.push({ severity:'info', title:'Consider upgrading to p=reject', detail:'p=quarantine is good, but p=reject gives the strongest protection by blocking unauthenticated emails entirely.' })
  if (!dmarc.rua) recs.push({ severity:'warn', title:'No DMARC reporting address set', detail:'Add rua=mailto:dmarc@yourdomain.com to receive aggregate reports about who is sending email using your domain.' })
  if (spf.status === 'missing') recs.push({ severity:'error', title:'No SPF record found', detail:'Add a TXT record at your root domain: v=spf1 include:_spf.google.com ~all (adjust for your mail provider).' })
  else if (spf.all === '+all') recs.push({ severity:'error', title:'SPF allows all senders (+all)', detail:'Change +all to -all or ~all immediately. +all allows anyone to send email as your domain.' })
  else if (spf.all === '?all') recs.push({ severity:'warn', title:'SPF is neutral (?all)', detail:'Change ?all to ~all (softfail) or -all (hardfail) for better protection.' })
  if (dkim.status === 'missing') recs.push({ severity:'error', title:'No DKIM record found', detail:'Set up DKIM signing with your email provider and publish the public key as a TXT record at selector._domainkey.yourdomain.com.' })
  if (recs.length === 0) recs.push({ severity:'success', title:'All email authentication records look good', detail:'Your domain has DMARC, SPF and DKIM properly configured. Keep monitoring with regular checks.' })
  return recs
}

const fmtDateTime = iso => new Date(iso).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })

export default function DmarcPage({ user }) {
  const [domain,   setDomain]   = useState('')
  const [selector, setSelector] = useState('default')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')
  const [history,  setHistory]  = useState([])
  const [histTab,  setHistTab]  = useState(false)

  useEffect(() => { if (user?.id) loadHistory() }, [user])

  async function loadHistory() {
    const { data } = await supabase.from('dmarc_history').select('*').eq('user_id', user.id).order('checked_at', { ascending: false }).limit(20)
    if (data) setHistory(data)
  }

  async function handleCheck(e) {
    e?.preventDefault()
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '')
    if (!d) { setError('Please enter a domain name.'); return }
    setLoading(true); setError(''); setResult(null)

    try {
      const [dmarcRecs, spfRecs, dkimRecs] = await Promise.all([
        dnsLookup(`_dmarc.${d}`, 'TXT'),
        dnsLookup(d, 'TXT'),
        dnsLookup(`${selector}._domainkey.${d}`, 'TXT'),
      ])

      const dmarc = parseDmarc(dmarcRecs)
      const spf   = parseSpf(spfRecs)
      const dkim  = parseDkim(dkimRecs, selector)
      const score = calcScore(dmarc, spf, dkim)
      const recs  = getRecommendations(dmarc, spf, dkim)

      const resultObj = { domain: d, score, dmarc, spf, dkim, recommendations: recs, checkedAt: new Date().toISOString() }
      setResult(resultObj)

      // Save to Supabase
      await supabase.from('dmarc_history').insert({
        user_id: user.id, domain: d, score,
        dmarc_record: dmarc.record, dmarc_policy: dmarc.policy, dmarc_status: dmarc.status,
        spf_record: spf.record, spf_status: spf.status,
        dkim_selector: selector, dkim_record: dkim.record, dkim_status: dkim.status,
        raw_json: { dmarc, spf, dkim },
      })
      loadHistory()
    } catch (err) {
      setError('DNS lookup failed. Check the domain and try again.')
    } finally {
      setLoading(false)
    }
  }

  function loadFromHistory(h) {
    const raw = h.raw_json || {}
    const dmarc = raw.dmarc || { status: h.dmarc_status, record: h.dmarc_record, policy: h.dmarc_policy }
    const spf   = raw.spf   || { status: h.spf_status,   record: h.spf_record   }
    const dkim  = raw.dkim  || { status: h.dkim_status,  record: h.dkim_record  }
    const recs  = getRecommendations(dmarc, spf, dkim)
    setDomain(h.domain)
    setResult({ domain: h.domain, score: h.score, dmarc, spf, dkim, recommendations: recs, checkedAt: h.checked_at })
    setHistTab(false)
  }

  async function deleteHistory(id, e) {
    e.stopPropagation()
    await supabase.from('dmarc_history').delete().eq('id', id)
    loadHistory()
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#f5f6fa' }}>

      {/* Header */}
      <div style={{ padding:'14px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, background:'#fffbeb', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>📧</div>
          <div>
            <h1 style={{ fontSize:16, fontWeight:700, color:'#111827', letterSpacing:'-0.02em', margin:0 }}>DMARC Checker</h1>
            <p style={{ fontSize:11.5, color:'#9ca3af', margin:0, marginTop:1 }}>Analyse DMARC, SPF and DKIM for any domain</p>
          </div>
        </div>
        <button onClick={() => setHistTab(h => !h)} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background: histTab?'#4f46e5':'#fff', color:histTab?'#fff':'#374151', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
          🕐 History {history.length > 0 && `(${history.length})`}
        </button>
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'20px 28px' }}>

        {/* Search bar */}
        <form onSubmit={handleCheck} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px', marginBottom:20 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 180px 120px', gap:10, alignItems:'end' }}>
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'#6b7280', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>Domain Name</label>
              <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com"
                style={{ width:'100%', padding:'10px 14px', border:'1px solid #e5e7eb', borderRadius:9, fontSize:14, color:'#111827', outline:'none', fontWeight:500 }}
                onFocus={e => e.target.style.borderColor='#4f46e5'}
                onBlur={e => e.target.style.borderColor='#e5e7eb'} />
            </div>
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'#6b7280', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>DKIM Selector</label>
              <input value={selector} onChange={e => setSelector(e.target.value)} placeholder="default"
                style={{ width:'100%', padding:'10px 14px', border:'1px solid #e5e7eb', borderRadius:9, fontSize:13.5, color:'#111827', outline:'none' }}
                onFocus={e => e.target.style.borderColor='#4f46e5'}
                onBlur={e => e.target.style.borderColor='#e5e7eb'} />
            </div>
            <button type="submit" disabled={loading} style={{ padding:'10px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:9, fontSize:13.5, fontWeight:700, cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1, letterSpacing:'-0.01em' }}>
              {loading ? 'Checking…' : 'Check Domain'}
            </button>
          </div>
          {error && <div style={{ marginTop:10, fontSize:12.5, color:'#dc2626', background:'#fef2f2', padding:'8px 12px', borderRadius:7, border:'1px solid #fca5a5' }}>{error}</div>}
          <div style={{ marginTop:8, fontSize:11.5, color:'#9ca3af' }}>Common DKIM selectors: <span style={{ fontFamily:'monospace', color:'#6b7280' }}>default, google, selector1, selector2, mail, dkim</span></div>
        </form>

        {/* History panel */}
        {histTab && (
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, marginBottom:20, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid #f0f0f0', background:'#fafafa', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, fontWeight:600, color:'#374151' }}>Check History</span>
              <span style={{ fontSize:11.5, color:'#9ca3af' }}>{history.length} records saved</span>
            </div>
            {history.length === 0 && <div style={{ padding:'30px 0', textAlign:'center', fontSize:13, color:'#9ca3af' }}>No history yet. Check a domain to save results.</div>}
            {history.map((h, i) => (
              <div key={h.id} onClick={() => loadFromHistory(h)}
                style={{ display:'grid', gridTemplateColumns:'1fr 80px 80px 120px 32px', gap:12, padding:'11px 16px', borderBottom:i<history.length-1?'1px solid #f5f5f5':'none', alignItems:'center', cursor:'pointer', transition:'background 0.1s' }}
                onMouseEnter={e=>e.currentTarget.style.background='#f8f9ff'}
                onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#111827' }}>{h.domain}</div>
                  <div style={{ fontSize:11, color:'#9ca3af', marginTop:1 }}>{fmtDateTime(h.checked_at)}</div>
                </div>
                <ScorePill score={h.score} />
                <div style={{ display:'flex', gap:4 }}>
                  {[h.dmarc_status, h.spf_status, h.dkim_status].map((st, j) => {
                    const c = statusCfg(st)
                    return <span key={j} style={{ width:8, height:8, borderRadius:'50%', background:c.dot, display:'inline-block' }} title={['DMARC','SPF','DKIM'][j]} />
                  })}
                </div>
                <div style={{ fontSize:11, color:'#9ca3af' }}>{fmtDateTime(h.checked_at).split(',')[0]}</div>
                <button onClick={e=>deleteHistory(h.id,e)} style={{ width:28, height:28, border:'1px solid #fca5a5', background:'#fef2f2', borderRadius:6, cursor:'pointer', fontSize:12, color:'#dc2626', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Loading spinner */}
        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0', flexDirection:'column', gap:14 }}>
            <div style={{ width:40, height:40, border:'3px solid #e5e7eb', borderTopColor:'#4f46e5', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
            <div style={{ fontSize:13, color:'#6b7280' }}>Querying DNS records for {domain}…</div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* Score card */}
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, padding:'24px 28px', display:'grid', gridTemplateColumns:'auto 1fr auto', gap:24, alignItems:'center' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:48, fontWeight:800, color:scoreColor(result.score), letterSpacing:'-0.04em', lineHeight:1 }}>{result.score}</div>
                <div style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>out of 100</div>
              </div>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <div style={{ fontSize:20, fontWeight:800, color:scoreColor(result.score), letterSpacing:'-0.02em' }}>{scoreLabel(result.score)} Protection</div>
                  <span style={{ fontSize:11, padding:'3px 10px', borderRadius:99, background:scoreColor(result.score)+'22', color:scoreColor(result.score), fontWeight:700 }}>{result.domain}</span>
                </div>
                <div style={{ height:10, background:'#f3f4f6', borderRadius:99, overflow:'hidden', maxWidth:400 }}>
                  <div style={{ height:'100%', width:`${result.score}%`, background:scoreColor(result.score), borderRadius:99, transition:'width 0.8s ease' }} />
                </div>
                <div style={{ fontSize:12, color:'#9ca3af', marginTop:6 }}>Checked {fmtDateTime(result.checkedAt)}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {[
                  { label:'DMARC', st: result.dmarc.status },
                  { label:'SPF',   st: result.spf.status   },
                  { label:'DKIM',  st: result.dkim.status  },
                ].map(({ label, st }) => {
                  const c = statusCfg(st)
                  return (
                    <div key={label} style={{ textAlign:'center', padding:'10px 14px', background:c.bg, border:`1px solid ${c.border}`, borderRadius:10 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color:c.color, marginTop:4 }}>{c.label}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 3 panels */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:14 }}>
              <RecordPanel title="DMARC" emoji="🛡" data={result.dmarc} fields={[
                { label:'Policy',    value: result.dmarc.policy || '—' },
                { label:'Percent',   value: result.dmarc.pct ? result.dmarc.pct + '%' : '—' },
                { label:'RUA',       value: result.dmarc.rua || 'Not set' },
                { label:'ASPF',      value: result.dmarc.aspf === 's' ? 'Strict' : 'Relaxed' },
                { label:'ADKIM',     value: result.dmarc.adkim === 's' ? 'Strict' : 'Relaxed' },
              ]} lookup={`_dmarc.${result.domain}`} />

              <RecordPanel title="SPF" emoji="📮" data={result.spf} fields={[
                { label:'All tag',    value: result.spf.all || '—' },
                { label:'Mechanisms', value: result.spf.mechanisms?.length ? result.spf.mechanisms.join(', ') : '—' },
              ]} lookup={result.domain} />

              <RecordPanel title="DKIM" emoji="🔑" data={result.dkim} fields={[
                { label:'Selector', value: selector },
                { label:'Key type', value: result.dkim.keyType || '—' },
                { label:'Key present', value: result.dkim.hasKey ? 'Yes' : 'No' },
              ]} lookup={`${selector}._domainkey.${result.domain}`} />
            </div>

            {/* Recommendations */}
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, overflow:'hidden' }}>
              <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0f0f0', background:'#fafafa' }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#374151' }}>Recommendations</div>
                <div style={{ fontSize:11.5, color:'#9ca3af', marginTop:1 }}>Step-by-step actions to improve your email security</div>
              </div>
              <div style={{ padding:'8px 0' }}>
                {result.recommendations.map((r, i) => {
                  const cfg = {
                    error:   { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', icon:'✕', iconBg:'#fee2e2' },
                    warn:    { bg:'#fffbeb', border:'#fde68a', color:'#d97706', icon:'!', iconBg:'#fef9c3' },
                    info:    { bg:'#eff6ff', border:'#bfdbfe', color:'#2563eb', icon:'i', iconBg:'#dbeafe' },
                    success: { bg:'#f0fdf4', border:'#bbf7d0', color:'#059669', icon:'✓', iconBg:'#dcfce7' },
                  }[r.severity] || {}
                  return (
                    <div key={i} style={{ margin:'8px 16px', background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:10, padding:'12px 14px', display:'flex', gap:12, alignItems:'flex-start' }}>
                      <div style={{ width:24, height:24, borderRadius:7, background:cfg.iconBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:cfg.color, flexShrink:0 }}>{cfg.icon}</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:cfg.color, marginBottom:3 }}>{r.title}</div>
                        <div style={{ fontSize:12.5, color:'#374151', lineHeight:1.6 }}>{r.detail}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:48, marginBottom:14 }}>📧</div>
            <div style={{ fontSize:16, fontWeight:600, color:'#374151', marginBottom:6 }}>Enter a domain to check</div>
            <div style={{ fontSize:13, color:'#9ca3af', maxWidth:400, margin:'0 auto', lineHeight:1.7 }}>We'll analyse the DMARC, SPF and DKIM DNS records and give you a full security score with recommendations.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function RecordPanel({ title, emoji, data, fields, lookup }) {
  const [showRaw, setShowRaw] = useState(false)
  const sc = statusCfg(data.status)
  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid #f0f0f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>{emoji}</span>
          <span style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{title}</span>
        </div>
        <span style={{ fontSize:11, padding:'3px 9px', borderRadius:99, background:sc.bg, color:sc.color, fontWeight:700, border:`1px solid ${sc.border}` }}>{sc.label}</span>
      </div>
      <div style={{ padding:'12px 16px' }}>
        {fields.map(f => (
          <div key={f.label} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #f9fafb', fontSize:12 }}>
            <span style={{ color:'#9ca3af', fontWeight:500 }}>{f.label}</span>
            <span style={{ color:'#111827', fontWeight:600, textAlign:'right', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.value}</span>
          </div>
        ))}
        <div style={{ marginTop:10 }}>
          <div style={{ fontSize:10.5, color:'#9ca3af', marginBottom:4, fontFamily:'monospace' }}>Lookup: {lookup}</div>
          <button onClick={() => setShowRaw(s => !s)} style={{ fontSize:11, padding:'3px 9px', border:'1px solid #e5e7eb', borderRadius:6, background:'#f9fafb', cursor:'pointer', color:'#6b7280' }}>
            {showRaw ? 'Hide' : 'Show'} raw record
          </button>
          {showRaw && (
            <pre style={{ marginTop:8, background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px', fontSize:10.5, fontFamily:'monospace', color:'#374151', lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-all', maxHeight:120, overflowY:'auto' }}>
              {data.record || 'No record found'}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

function ScorePill({ score }) {
  const color = scoreColor(score)
  return (
    <span style={{ fontSize:12, fontWeight:700, color, padding:'3px 10px', borderRadius:99, background:color+'18', border:`1px solid ${color}44` }}>{score}/100</span>
  )
}
