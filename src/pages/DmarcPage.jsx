import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

// ── DNS lookup ────────────────────────────────────────────────────────────
async function dnsLookup(name, type = 'TXT') {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/dns-json' } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.Answer || []).map(r => r.data?.replace(/"/g, '').trim()).filter(Boolean)
  } catch { return [] }
}

// ── Parsers ───────────────────────────────────────────────────────────────
function parseDmarc(records) {
  const rec = records.find(r => r.toLowerCase().startsWith('v=dmarc1'))
  if (!rec) return { record:null, status:'missing', policy:null, pct:null, rua:null, ruf:null, aspf:null, adkim:null }
  const tags = {}
  rec.split(';').forEach(p => { const [k,v] = p.trim().split('='); if (k&&v) tags[k.trim().toLowerCase()]=v.trim() })
  const policy = tags.p || null
  const status = !policy?'invalid':policy==='none'?'warn':policy==='quarantine'?'good':policy==='reject'?'great':'warn'
  return { record:rec, status, policy, pct:tags.pct||'100', rua:tags.rua||null, ruf:tags.ruf||null, aspf:tags.aspf||'r', adkim:tags.adkim||'r' }
}
function parseSpf(records) {
  const rec = records.find(r => r.toLowerCase().startsWith('v=spf1'))
  if (!rec) return { record:null, status:'missing', mechanisms:[], all:null }
  const parts = rec.split(/\s+/)
  const all = parts.find(p => p.toLowerCase().endsWith('all'))
  const mechanisms = parts.filter(p => !p.startsWith('v=') && !p.toLowerCase().endsWith('all'))
  const status = !all?'warn':all==='-all'?'great':all==='~all'?'good':'warn'
  return { record:rec, status, mechanisms, all }
}
function parseDkim(records) {
  const rec = records.find(r => r.toLowerCase().includes('v=dkim1') || r.toLowerCase().includes('p='))
  if (!rec) return { record:null, status:'missing', keyType:null, hasKey:false }
  const hasKey = rec.includes('p=') && !rec.includes('p=;') && !rec.includes('p= ')
  const keyType = rec.includes('k=rsa')?'RSA':rec.includes('k=ed25519')?'Ed25519':'RSA'
  return { record:rec, status:hasKey?'great':'missing', keyType, hasKey }
}
function calcScore(dmarc, spf, dkim) {
  let s = 0
  if (dmarc.status==='great') s+=40; else if (dmarc.status==='good') s+=28; else if (dmarc.status==='warn') s+=15
  if (spf.status==='great') s+=30; else if (spf.status==='good') s+=20; else if (spf.status==='warn') s+=10
  if (dkim.status==='great') s+=30
  return Math.min(s,100)
}
function scoreColor(s) { return s>=80?'#059669':s>=50?'#d97706':'#dc2626' }
function scoreLabel(s) { return s>=80?'Strong':s>=50?'Moderate':'Weak' }
function statusCfg(st) {
  return { great:{bg:'#ecfdf5',color:'#059669',border:'#86efac',label:'Pass'}, good:{bg:'#f0fdf4',color:'#16a34a',border:'#bbf7d0',label:'Good'}, warn:{bg:'#fffbeb',color:'#d97706',border:'#fde68a',label:'Warning'}, missing:{bg:'#fef2f2',color:'#dc2626',border:'#fca5a5',label:'Missing'}, invalid:{bg:'#fef2f2',color:'#dc2626',border:'#fca5a5',label:'Invalid'} }[st] || {bg:'#f3f4f6',color:'#6b7280',border:'#d1d5db',label:'Unknown'}
}
function getRecommendations(dmarc, spf, dkim) {
  const recs = []
  if (dmarc.status==='missing') recs.push({severity:'error',title:'No DMARC record found',detail:'Add TXT at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com'})
  else if (dmarc.policy==='none') recs.push({severity:'warn',title:'DMARC policy is set to none',detail:'Change p=none to p=quarantine or p=reject to actively protect your domain.'})
  else if (dmarc.policy==='quarantine') recs.push({severity:'info',title:'Consider upgrading to p=reject',detail:'p=reject gives the strongest protection by blocking unauthenticated emails entirely.'})
  if (!dmarc.rua) recs.push({severity:'warn',title:'No DMARC reporting address',detail:'Add rua=mailto:dmarc@yourdomain.com to receive aggregate reports.'})
  if (spf.status==='missing') recs.push({severity:'error',title:'No SPF record found',detail:'Add TXT at root domain: v=spf1 include:_spf.google.com ~all'})
  else if (spf.all==='+all') recs.push({severity:'error',title:'SPF allows all senders (+all)',detail:'Change +all to -all or ~all immediately.'})
  if (dkim.status==='missing') recs.push({severity:'error',title:'No DKIM record found',detail:'Set up DKIM with your email provider and publish the public key.'})
  if (recs.length===0) recs.push({severity:'success',title:'All email authentication records look good',detail:'Your domain has DMARC, SPF and DKIM properly configured.'})
  return recs
}

// ── CSV domain extractor ──────────────────────────────────────────────────
function extractDomains(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''))
  const colIdx = (() => {
    const di = headers.findIndex(h => h.includes('domain')||h.includes('url')||h.includes('website')||h.includes('host'))
    if (di>=0) return di
    for (let c=0;c<headers.length;c++) {
      const s = lines.slice(1,6).map(l=>l.split(',')[c]?.trim().replace(/"/g,'')||'')
      if (s.some(v=>/^[\w.-]+\.[a-z]{2,}$/i.test(v))) return c
    }
    return 0
  })()
  return lines.slice(1).map(l=>l.split(',')[colIdx]?.trim().replace(/"/g,'').toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*/,'')).filter(d=>d&&/^[\w.-]+\.[a-z]{2,}$/i.test(d)).filter((d,i,a)=>a.indexOf(d)===i)
}

async function checkDomain(domain, selector='default') {
  const [dmarcRecs,spfRecs,dkimRecs] = await Promise.all([dnsLookup(`_dmarc.${domain}`,'TXT'),dnsLookup(domain,'TXT'),dnsLookup(`${selector}._domainkey.${domain}`,'TXT')])
  const dmarc=parseDmarc(dmarcRecs), spf=parseSpf(spfRecs), dkim=parseDkim(dkimRecs)
  return { domain, score:calcScore(dmarc,spf,dkim), dmarc, spf, dkim, recommendations:getRecommendations(dmarc,spf,dkim), checkedAt:new Date().toISOString() }
}

const fmtDT = iso => new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
const PER = 15

const TABS = [
  { id:'single',    label:'DMARC Check'         },
  { id:'bulk',      label:'Bulk Check'           },
  { id:'spf-gen',   label:'SPF Generator'        },
  { id:'dkim-gen',  label:'DKIM Generator'       },
  { id:'bimi',      label:'BIMI Checker'         },
  { id:'headers',   label:'Email Headers'        },
  { id:'phishing',  label:'Phishing Checker'     },
]

export default function DmarcPage({ user }) {
  const [tab, setTab] = useState('single')
  const [domain,   setDomain]   = useState('')
  const [selector, setSelector] = useState('default')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')
  const [history,  setHistory]  = useState([])
  const [showHist, setShowHist] = useState(false)
  const [bulkDomains,  setBulkDomains]  = useState([])
  const [bulkResults,  setBulkResults]  = useState([])
  const [bulkRunning,  setBulkRunning]  = useState(false)
  const [bulkDone,     setBulkDone]     = useState(false)
  const [bulkFile,     setBulkFile]     = useState('')
  const [bulkSearch,   setBulkSearch]   = useState('')
  const [bulkFilter,   setBulkFilter]   = useState('all')
  const [bulkPage,     setBulkPage]     = useState(1)
  const [expandedRow,  setExpandedRow]  = useState(null)
  const fileRef = useRef()

  useEffect(() => { if (user?.id) loadHistory() }, [user])

  async function loadHistory() {
    const { data } = await supabase.from('dmarc_history').select('*').eq('user_id',user.id).order('checked_at',{ascending:false}).limit(30)
    if (data) setHistory(data)
  }

  async function handleSingleCheck(e) {
    e?.preventDefault()
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) { setError('Please enter a domain.'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await checkDomain(d, selector)
      setResult(r)
      await supabase.from('dmarc_history').insert({ user_id:user.id, domain:d, score:r.score, dmarc_record:r.dmarc.record, dmarc_policy:r.dmarc.policy, dmarc_status:r.dmarc.status, spf_record:r.spf.record, spf_status:r.spf.status, dkim_selector:selector, dkim_record:r.dkim.record, dkim_status:r.dkim.status, raw_json:{dmarc:r.dmarc,spf:r.spf,dkim:r.dkim} })
      loadHistory()
    } catch { setError('DNS lookup failed. Check the domain and try again.') }
    finally { setLoading(false) }
  }

  function onBulkFile(e) {
    const file = e.target.files[0]; if (!file) return
    setBulkFile(file.name); setBulkResults([]); setBulkDone(false); setExpandedRow(null)
    const reader = new FileReader()
    reader.onload = ev => setBulkDomains(extractDomains(ev.target.result))
    reader.readAsText(file)
  }

  async function runBulk() {
    if (!bulkDomains.length) return
    setBulkRunning(true); setBulkResults([]); setBulkDone(false); setExpandedRow(null)
    const results = await Promise.all(bulkDomains.map(d => checkDomain(d,selector).catch(()=>({domain:d,score:0,dmarc:{status:'missing'},spf:{status:'missing'},dkim:{status:'missing'},error:true,checkedAt:new Date().toISOString()}))))
    setBulkResults(results); setBulkRunning(false); setBulkDone(true)
    const rows = results.map(r=>({ user_id:user.id, domain:r.domain, score:r.score||0, dmarc_status:r.dmarc?.status, dmarc_record:r.dmarc?.record, dmarc_policy:r.dmarc?.policy, spf_status:r.spf?.status, spf_record:r.spf?.record, dkim_status:r.dkim?.status, dkim_record:r.dkim?.record, dkim_selector:selector, raw_json:{dmarc:r.dmarc,spf:r.spf,dkim:r.dkim} }))
    for (let i=0;i<rows.length;i+=20) await supabase.from('dmarc_history').insert(rows.slice(i,i+20))
    loadHistory()
  }

  function loadFromHistory(h) {
    const raw = h.raw_json||{}
    const dmarc=raw.dmarc||{status:h.dmarc_status,record:h.dmarc_record,policy:h.dmarc_policy}
    const spf=raw.spf||{status:h.spf_status,record:h.spf_record}
    const dkim=raw.dkim||{status:h.dkim_status,record:h.dkim_record}
    setResult({domain:h.domain,score:h.score,dmarc,spf,dkim,recommendations:getRecommendations(dmarc,spf,dkim),checkedAt:h.checked_at})
    setDomain(h.domain); setTab('single'); setShowHist(false)
  }

  async function deleteHistory(id, e) {
    e.stopPropagation()
    await supabase.from('dmarc_history').delete().eq('id',id)
    loadHistory()
  }

  const bulkFiltered = bulkResults.filter(r => {
    const mQ = !bulkSearch || r.domain.includes(bulkSearch.toLowerCase())
    const mF = bulkFilter==='all'?true:bulkFilter==='pass'?r.score>=80:bulkFilter==='warn'?(r.score>=50&&r.score<80):bulkFilter==='fail'?r.score<50:true
    return mQ && mF
  })
  const bulkTotalPages = Math.max(1,Math.ceil(bulkFiltered.length/PER))
  const bulkPaged = bulkFiltered.slice((bulkPage-1)*PER,bulkPage*PER)
  const bulkPass=bulkResults.filter(r=>r.score>=80).length, bulkWarn=bulkResults.filter(r=>r.score>=50&&r.score<80).length, bulkFail=bulkResults.filter(r=>r.score<50).length

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#f5f6fa'}}>
      {/* Header */}
      <div style={{padding:'14px 28px',background:'#fff',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:36,height:36,background:'#fffbeb',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>📧</div>
          <div>
            <h1 style={{fontSize:16,fontWeight:700,color:'#111827',letterSpacing:'-0.02em',margin:0}}>DMARC & Email Security</h1>
            <p style={{fontSize:11.5,color:'#9ca3af',margin:0,marginTop:1}}>Full email authentication toolkit</p>
          </div>
        </div>
        <button onClick={()=>setShowHist(h=>!h)} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',background:showHist?'#4f46e5':'#fff',color:showHist?'#fff':'#374151',border:'1px solid #e5e7eb',borderRadius:8,fontSize:12.5,fontWeight:600,cursor:'pointer'}}>
          🕐 History {history.length>0&&`(${history.length})`}
        </button>
      </div>

      {/* Tabs */}
      <div style={{background:'#fff',borderBottom:'1px solid #e5e7eb',padding:'0 28px',display:'flex',gap:0,overflowX:'auto'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'11px 16px',border:'none',background:'transparent',fontSize:12.5,fontWeight:tab===t.id?700:400,color:tab===t.id?'#4f46e5':'#6b7280',borderBottom:`2px solid ${tab===t.id?'#4f46e5':'transparent'}`,cursor:'pointer',whiteSpace:'nowrap'}}>
            {t.label}
            {t.id==='bulk'&&bulkResults.length>0&&<span style={{marginLeft:5,fontSize:10,padding:'2px 6px',borderRadius:99,background:'#eef2ff',color:'#4f46e5',fontWeight:700}}>{bulkResults.length}</span>}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflow:'auto',padding:'20px 28px'}}>

        {/* History */}
        {showHist && (
          <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,marginBottom:20,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fafafa',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:13,fontWeight:600,color:'#374151'}}>Check History</span>
              <span style={{fontSize:11.5,color:'#9ca3af'}}>{history.length} records</span>
            </div>
            {history.length===0 && <div style={{padding:'28px 0',textAlign:'center',fontSize:13,color:'#9ca3af'}}>No history yet.</div>}
            {history.map((h,i) => (
              <div key={h.id} onClick={()=>loadFromHistory(h)}
                style={{display:'grid',gridTemplateColumns:'1fr 80px 60px 32px',gap:12,padding:'10px 16px',borderBottom:i<history.length-1?'1px solid #f5f5f5':'none',alignItems:'center',cursor:'pointer'}}
                onMouseEnter={e=>e.currentTarget.style.background='#f8f9ff'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                <div>
                  <div style={{fontSize:12.5,fontWeight:600,color:'#111827'}}>{h.domain}</div>
                  <div style={{fontSize:11,color:'#9ca3af',marginTop:1}}>{fmtDT(h.checked_at)}</div>
                </div>
                <span style={{fontSize:12,fontWeight:700,color:scoreColor(h.score),padding:'3px 9px',borderRadius:99,background:scoreColor(h.score)+'18',textAlign:'center'}}>{h.score}/100</span>
                <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                  {[h.dmarc_status,h.spf_status,h.dkim_status].map((st,j)=><span key={j} style={{width:8,height:8,borderRadius:'50%',background:statusCfg(st).color,display:'inline-block'}}/>)}
                </div>
                <button onClick={e=>deleteHistory(h.id,e)} style={{width:28,height:28,border:'1px solid #fca5a5',background:'#fef2f2',borderRadius:6,cursor:'pointer',fontSize:12,color:'#dc2626',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* ── SINGLE TAB ── */}
        {tab==='single' && (
          <>
            <form onSubmit={handleSingleCheck} style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px',marginBottom:20}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 180px 130px',gap:10,alignItems:'end'}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Domain Name</label>
                  <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:14,color:'#111827',outline:'none',fontWeight:500}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>DKIM Selector</label>
                  <input value={selector} onChange={e=>setSelector(e.target.value)} placeholder="default" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:13,color:'#111827',outline:'none'}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />
                </div>
                <button type="submit" disabled={loading} style={{padding:'10px 20px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:9,fontSize:13.5,fontWeight:700,cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1}}>
                  {loading?'Checking…':'Check Domain'}
                </button>
              </div>
              {error && <div style={{marginTop:10,fontSize:12.5,color:'#dc2626',background:'#fef2f2',padding:'8px 12px',borderRadius:7,border:'1px solid #fca5a5'}}>{error}</div>}
              <div style={{marginTop:7,fontSize:11.5,color:'#9ca3af'}}>Common selectors: <span style={{fontFamily:'monospace'}}>default, google, selector1, selector2, mail</span></div>
            </form>
            {loading && <Spinner label={`Querying DNS for ${domain}…`}/>}
            {result && !loading && <SingleResult result={result} selector={selector}/>}
            {!result && !loading && <EmptyState icon="📧" title="Enter a domain to check" desc="We'll analyse DMARC, SPF and DKIM and give you a full security score with recommendations."/>}
          </>
        )}

        {/* ── BULK TAB ── */}
        {tab==='bulk' && (
          <>
            <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px',marginBottom:20}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 180px 130px',gap:10,alignItems:'end'}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Upload CSV file</label>
                  <div onClick={()=>fileRef.current.click()} style={{padding:'10px 14px',border:'1.5px dashed #d1d5db',borderRadius:9,fontSize:13,color:bulkFile?'#111827':'#9ca3af',cursor:'pointer',background:'#fafafa',display:'flex',alignItems:'center',gap:8}}>
                    📄 {bulkFile||'Click to choose file'}
                    {bulkDomains.length>0&&<span style={{marginLeft:'auto',fontSize:11,padding:'2px 8px',borderRadius:99,background:'#eef2ff',color:'#4f46e5',fontWeight:700}}>{bulkDomains.length} domains</span>}
                  </div>
                  <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={onBulkFile}/>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>DKIM Selector</label>
                  <input value={selector} onChange={e=>setSelector(e.target.value)} placeholder="default" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:13,color:'#111827',outline:'none'}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
                </div>
                <button onClick={runBulk} disabled={bulkRunning||!bulkDomains.length} style={{padding:'10px 20px',background:!bulkDomains.length?'#e5e7eb':'#4f46e5',color:!bulkDomains.length?'#9ca3af':'#fff',border:'none',borderRadius:9,fontSize:13.5,fontWeight:700,cursor:(!bulkDomains.length||bulkRunning)?'not-allowed':'pointer',opacity:bulkRunning?0.7:1}}>
                  {bulkRunning?'Checking…':'Run Bulk Check'}
                </button>
              </div>
              <div style={{marginTop:7,fontSize:11.5,color:'#9ca3af'}}>Domain column detected automatically. All domains checked in parallel. Results saved to history.</div>
            </div>
            {bulkRunning && <Spinner label={`Checking ${bulkDomains.length} domains in parallel…`}/>}
            {bulkDone && !bulkRunning && (
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10,marginBottom:16}}>
                  {[{label:'Total Checked',value:bulkResults.length,color:'#4f46e5',filt:'all'},{label:'Strong (80+)',value:bulkPass,color:'#059669',filt:'pass'},{label:'Moderate',value:bulkWarn,color:'#d97706',filt:'warn'},{label:'Weak / Failed',value:bulkFail,color:'#dc2626',filt:'fail'}].map(s=>(
                    <div key={s.label} onClick={()=>{setBulkFilter(f=>f===s.filt?'all':s.filt);setBulkPage(1)}} style={{background:'#fff',border:`1.5px solid ${bulkFilter===s.filt?s.color:'#e5e7eb'}`,borderRadius:12,padding:'14px 16px',cursor:'pointer',position:'relative',overflow:'hidden'}}>
                      <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:bulkFilter===s.filt?s.color:'transparent',borderRadius:'12px 12px 0 0'}}/>
                      <div style={{fontSize:10.5,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>{s.label}</div>
                      <div style={{fontSize:30,fontWeight:800,color:s.color,letterSpacing:'-0.04em',lineHeight:1}}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
                  <div style={{padding:'10px 14px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',gap:10,background:'#fafafa'}}>
                    <span style={{fontSize:12.5,fontWeight:600,color:'#374151',flex:1}}>{bulkFiltered.length} records</span>
                    {bulkFilter!=='all'&&<button onClick={()=>{setBulkFilter('all');setBulkPage(1)}} style={{fontSize:11,padding:'3px 9px',border:'1px solid #e5e7eb',borderRadius:99,background:'#fff',cursor:'pointer',color:'#6b7280'}}>Clear ✕</button>}
                    <input value={bulkSearch} onChange={e=>{setBulkSearch(e.target.value);setBulkPage(1)}} placeholder="Search domain…" style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:12,color:'#374151',outline:'none',width:200}}/>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 80px 70px 70px 70px 32px',padding:'8px 14px',background:'#f9fafb',borderBottom:'1px solid #f0f0f0'}}>
                    {['Domain','Score','DMARC','SPF','DKIM',''].map((h,i)=><span key={i} style={{fontSize:10,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.07em'}}>{h}</span>)}
                  </div>
                  {bulkPaged.map((r,i)=>(
                    <div key={r.domain}>
                      <div onClick={()=>setExpandedRow(expandedRow===r.domain?null:r.domain)}
                        style={{display:'grid',gridTemplateColumns:'1fr 80px 70px 70px 70px 32px',padding:'11px 14px',borderBottom:'1px solid #f5f5f5',alignItems:'center',cursor:'pointer',background:expandedRow===r.domain?'#f8f9ff':i%2===0?'#fff':'#fdfdfd',transition:'background 0.1s'}}>
                        <div style={{fontSize:13,fontWeight:600,color:'#111827',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.domain}</div>
                        <span style={{fontSize:12,fontWeight:700,color:scoreColor(r.score),padding:'3px 8px',borderRadius:99,background:scoreColor(r.score)+'18',textAlign:'center'}}>{r.score}/100</span>
                        {[r.dmarc,r.spf,r.dkim].map((x,j)=>{const c=statusCfg(x?.status);return<span key={j} style={{fontSize:10.5,padding:'2px 7px',borderRadius:99,background:c.bg,color:c.color,fontWeight:700,textAlign:'center'}}>{c.label}</span>})}
                        <span style={{fontSize:14,color:'#9ca3af',textAlign:'center'}}>{expandedRow===r.domain?'▲':'▼'}</span>
                      </div>
                      {expandedRow===r.domain&&(
                        <div style={{background:'#f8f9ff',borderBottom:'1px solid #e5e7eb',padding:'14px 20px'}}>
                          <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,marginBottom:10}}>
                            {[{title:'DMARC',data:r.dmarc,fields:[{label:'Policy',value:r.dmarc?.policy||'—'},{label:'RUA',value:r.dmarc?.rua||'Not set'}]},{title:'SPF',data:r.spf,fields:[{label:'All tag',value:r.spf?.all||'—'}]},{title:'DKIM',data:r.dkim,fields:[{label:'Key',value:r.dkim?.hasKey?'Present':'Missing'}]}].map(({title,data,fields})=>{
                              const sc=statusCfg(data?.status)
                              return <div key={title} style={{background:'#fff',border:`1px solid ${sc.border}`,borderRadius:9,padding:'12px 14px'}}>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                                  <span style={{fontSize:12.5,fontWeight:700,color:'#111827'}}>{title}</span>
                                  <span style={{fontSize:10.5,padding:'2px 8px',borderRadius:99,background:sc.bg,color:sc.color,fontWeight:700}}>{sc.label}</span>
                                </div>
                                {fields.map(f=><div key={f.label} style={{display:'flex',justifyContent:'space-between',fontSize:11.5,padding:'3px 0',borderBottom:'1px solid #f5f5f5'}}><span style={{color:'#9ca3af'}}>{f.label}</span><span style={{color:'#374151',fontWeight:600}}>{f.value}</span></div>)}
                              </div>
                            })}
                          </div>
                          <div style={{fontSize:12,color:'#6b7280'}}>
                            {r.recommendations?.slice(0,2).map((rec,j)=>{const c={error:'#dc2626',warn:'#d97706',info:'#2563eb',success:'#059669'}[rec.severity]||'#6b7280';return<div key={j} style={{marginBottom:4,color:c}}>● {rec.title}</div>})}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {bulkFiltered.length>PER&&(
                    <div style={{padding:'10px 14px',borderTop:'1px solid #f0f0f0',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#fafafa'}}>
                      <span style={{fontSize:11.5,color:'#9ca3af'}}>Page {bulkPage} of {bulkTotalPages}</span>
                      <div style={{display:'flex',gap:4}}>
                        <PBtn label="←" onClick={()=>setBulkPage(p=>Math.max(1,p-1))} disabled={bulkPage===1}/>
                        {[...Array(Math.min(bulkTotalPages,7))].map((_,i)=><PBtn key={i} label={i+1} active={bulkPage===i+1} onClick={()=>setBulkPage(i+1)}/>)}
                        <PBtn label="→" onClick={()=>setBulkPage(p=>Math.min(bulkTotalPages,p+1))} disabled={bulkPage===bulkTotalPages}/>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            {!bulkDomains.length&&!bulkRunning&&!bulkDone&&<EmptyState icon="📋" title="Upload a CSV to bulk check domains" desc="Domain column is detected automatically. All domains checked in parallel and results saved to history."/>}
          </>
        )}

        {/* ── SPF GENERATOR ── */}
        {tab==='spf-gen' && <SpfGenerator/>}

        {/* ── DKIM GENERATOR ── */}
        {tab==='dkim-gen' && <DkimGenerator/>}

        {/* ── BIMI CHECKER ── */}
        {tab==='bimi' && <BimiChecker/>}

        {/* ── EMAIL HEADERS ── */}
        {tab==='headers' && <HeaderAnalyzer/>}

        {/* ── PHISHING CHECKER ── */}
        {tab==='phishing' && <PhishingChecker/>}

      </div>
    </div>
  )
}

// ── SPF Generator ─────────────────────────────────────────────────────────
function SpfGenerator() {
  const [includes, setIncludes] = useState([''])
  const [ips,      setIps]      = useState([''])
  const [all,      setAll]      = useState('-all')
  const [copied,   setCopied]   = useState(false)

  const addInclude = () => setIncludes(p => [...p,''])
  const addIp      = () => setIps(p => [...p,''])
  const setInc = (i,v) => setIncludes(p => p.map((x,j)=>j===i?v:x))
  const setIp  = (i,v) => setIps(p => p.map((x,j)=>j===i?v:x))
  const remInc = i => setIncludes(p => p.filter((_,j)=>j!==i))
  const remIp  = i => setIps(p => p.filter((_,j)=>j!==i))

  const record = ['v=spf1', ...includes.filter(Boolean).map(i=>`include:${i}`), ...ips.filter(Boolean).map(ip=>`ip4:${ip}`), all].join(' ')

  function copy() {
    navigator.clipboard?.writeText(record)
    setCopied(true); setTimeout(()=>setCopied(false),2000)
  }

  const PRESETS = [
    { label:'Google Workspace', value:'_spf.google.com' },
    { label:'Microsoft 365',    value:'spf.protection.outlook.com' },
    { label:'Mailchimp',        value:'servers.mcsv.net' },
    { label:'Sendgrid',         value:'sendgrid.net' },
    { label:'Amazon SES',       value:'amazonses.com' },
    { label:'Zoho Mail',        value:'zohomail.com' },
  ]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:800}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:14}}>Quick add mail providers</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {PRESETS.map(p=>(
            <button key={p.value} onClick={()=>setIncludes(prev=>[...prev.filter(Boolean),p.value])} style={{padding:'6px 12px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:12,fontWeight:500,color:'#374151',background:'#f9fafb',cursor:'pointer'}}>{p.label}</button>
          ))}
        </div>
      </div>

      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:12}}>Include mechanisms</div>
        {includes.map((inc,i)=>(
          <div key={i} style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
            <input value={inc} onChange={e=>setInc(i,e.target.value)} placeholder="e.g. _spf.google.com" style={{flex:1,padding:'8px 12px',border:'1px solid #e5e7eb',borderRadius:8,fontSize:13,color:'#111827',outline:'none'}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
            {includes.length>1&&<button onClick={()=>remInc(i)} style={{width:30,height:30,border:'1px solid #fca5a5',background:'#fef2f2',borderRadius:7,cursor:'pointer',color:'#dc2626',fontSize:14}}>✕</button>}
          </div>
        ))}
        <button onClick={addInclude} style={{fontSize:12,padding:'6px 12px',border:'1px dashed #d1d5db',borderRadius:7,background:'transparent',cursor:'pointer',color:'#6b7280'}}>+ Add include</button>
      </div>

      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:12}}>IP addresses (optional)</div>
        {ips.map((ip,i)=>(
          <div key={i} style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
            <input value={ip} onChange={e=>setIp(i,e.target.value)} placeholder="e.g. 192.168.1.1 or 10.0.0.0/24" style={{flex:1,padding:'8px 12px',border:'1px solid #e5e7eb',borderRadius:8,fontSize:13,color:'#111827',outline:'none'}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
            {ips.length>1&&<button onClick={()=>remIp(i)} style={{width:30,height:30,border:'1px solid #fca5a5',background:'#fef2f2',borderRadius:7,cursor:'pointer',color:'#dc2626',fontSize:14}}>✕</button>}
          </div>
        ))}
        <button onClick={addIp} style={{fontSize:12,padding:'6px 12px',border:'1px dashed #d1d5db',borderRadius:7,background:'transparent',cursor:'pointer',color:'#6b7280'}}>+ Add IP</button>
      </div>

      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:12}}>All policy</div>
        <div style={{display:'flex',gap:10}}>
          {[{v:'-all',label:'-all (Reject)',desc:'Recommended — reject all other senders'},{v:'~all',label:'~all (Softfail)',desc:'Mark others as suspicious'},{v:'?all',label:'?all (Neutral)',desc:'No policy — not recommended'},{v:'+all',label:'+all (Pass)',desc:'Dangerous — allow all senders'}].map(opt=>(
            <div key={opt.v} onClick={()=>setAll(opt.v)} style={{flex:1,padding:'10px 12px',border:`1.5px solid ${all===opt.v?'#4f46e5':'#e5e7eb'}`,borderRadius:9,background:all===opt.v?'#eef2ff':'#fff',cursor:'pointer'}}>
              <div style={{fontSize:12.5,fontWeight:700,color:all===opt.v?'#4f46e5':'#374151'}}>{opt.label}</div>
              <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>{opt.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{background:'#f0fdf4',border:'1px solid #86efac',borderRadius:12,padding:'18px 20px'}}>
        <div style={{fontSize:12,fontWeight:700,color:'#059669',marginBottom:8}}>Generated SPF Record</div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <code style={{flex:1,background:'#fff',border:'1px solid #bbf7d0',borderRadius:8,padding:'12px 14px',fontSize:13,color:'#111827',fontFamily:'monospace',wordBreak:'break-all'}}>{record}</code>
          <button onClick={copy} style={{padding:'10px 16px',background:'#059669',color:'#fff',border:'none',borderRadius:8,fontSize:12.5,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>{copied?'Copied!':'Copy'}</button>
        </div>
        <div style={{fontSize:12,color:'#059669',marginTop:10}}>Add this as a TXT record at your root domain (e.g. yourdomain.com)</div>
      </div>
    </div>
  )
}

// ── DKIM Generator ────────────────────────────────────────────────────────
function DkimGenerator() {
  const [selector, setSelector] = useState('default')
  const [domain,   setDomain]   = useState('')
  const [keySize,  setKeySize]  = useState('2048')
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [copied,   setCopied]   = useState('')

  async function generate() {
    if (!domain.trim()) return
    setLoading(true); setResult(null)
    try {
      const keyPair = await window.crypto.subtle.generateKey({ name:'RSASSA-PKCS1-v1_5', modulusLength:parseInt(keySize), publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' }, true, ['sign','verify'])
      const privDer = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      const pubDer  = await window.crypto.subtle.exportKey('spki',  keyPair.publicKey)
      const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
      const chunk = s => s.match(/.{1,64}/g).join('\n')
      const privPem = `-----BEGIN PRIVATE KEY-----\n${chunk(toB64(privDer))}\n-----END PRIVATE KEY-----`
      const pubB64  = toB64(pubDer)
      const dnsRecord = `v=DKIM1; k=rsa; p=${pubB64}`
      const dnsName   = `${selector}._domainkey.${domain.trim()}`
      setResult({ privPem, pubB64, dnsRecord, dnsName })
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function copy(text, key) {
    navigator.clipboard?.writeText(text)
    setCopied(key); setTimeout(()=>setCopied(''),2000)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:800}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 160px 140px 130px',gap:10,alignItems:'end'}}>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Domain</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="yourdomain.com" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:13,color:'#111827',outline:'none'}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Selector</label>
            <input value={selector} onChange={e=>setSelector(e.target.value)} placeholder="default" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:13,color:'#111827',outline:'none'}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Key Size</label>
            <select value={keySize} onChange={e=>setKeySize(e.target.value)} style={{width:'100%',padding:'10px 12px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:13,color:'#111827',outline:'none',background:'#fff'}}>
              <option value="1024">1024-bit</option>
              <option value="2048">2048-bit</option>
              <option value="4096">4096-bit</option>
            </select>
          </div>
          <button onClick={generate} disabled={loading||!domain.trim()} style={{padding:'10px 20px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:9,fontSize:13,fontWeight:700,cursor:(!domain.trim()||loading)?'not-allowed':'pointer',opacity:(!domain.trim()||loading)?0.6:1}}>
            {loading?'Generating…':'Generate Keys'}
          </button>
        </div>
        <div style={{marginTop:7,fontSize:11.5,color:'#9ca3af'}}>Keys are generated locally in your browser — nothing is sent to any server.</div>
      </div>

      {result && (
        <>
          <InfoCard title="DNS TXT Record" subtitle={`Add this TXT record at: ${result.dnsName}`} color="#4f46e5">
            <CodeBlock content={result.dnsRecord} onCopy={()=>copy(result.dnsRecord,'dns')} copied={copied==='dns'}/>
          </InfoCard>
          <InfoCard title="Private Key (keep secret)" subtitle="Store this securely — never share or publish it" color="#dc2626">
            <CodeBlock content={result.privPem} onCopy={()=>copy(result.privPem,'priv')} copied={copied==='priv'}/>
          </InfoCard>
        </>
      )}

      {!result && (
        <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'28px 20px'}}>
          <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:16}}>How to use DKIM keys</div>
          {[
            {step:'1',text:'Generate your RSA key pair above'},
            {step:'2',text:'Add the DNS TXT record to your domain at the selector address shown'},
            {step:'3',text:'Upload the private key to your email server or provider'},
            {step:'4',text:'Verify with the DMARC Check tab after 24–48 hours for DNS propagation'},
          ].map(s=>(
            <div key={s.step} style={{display:'flex',gap:12,marginBottom:12,alignItems:'flex-start'}}>
              <div style={{width:24,height:24,borderRadius:7,background:'#eef2ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#4f46e5',flexShrink:0}}>{s.step}</div>
              <div style={{fontSize:13,color:'#374151',paddingTop:3}}>{s.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── BIMI Checker ──────────────────────────────────────────────────────────
function BimiChecker() {
  const [domain,  setDomain]  = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')

  async function check(e) {
    e.preventDefault()
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResult(null); setError('')
    try {
      const [bimiRecs, dmarcRecs] = await Promise.all([dnsLookup(`default._bimi.${d}`,'TXT'), dnsLookup(`_dmarc.${d}`,'TXT')])
      const bimiRec = bimiRecs.find(r => r.toLowerCase().startsWith('v=bimi1'))
      const dmarc = parseDmarc(dmarcRecs)
      if (!bimiRec) { setResult({ domain:d, found:false, dmarc, record:null, logoUrl:null, vmcUrl:null }); return }
      const tags = {}
      bimiRec.split(';').forEach(p=>{ const [k,v]=p.trim().split('='); if(k&&v) tags[k.trim().toLowerCase()]=v.trim() })
      setResult({ domain:d, found:true, record:bimiRec, logoUrl:tags.l||null, vmcUrl:tags.a||null, dmarc })
    } catch { setError('DNS lookup failed.') }
    finally { setLoading(false) }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:800}}>
      <form onSubmit={check} style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 130px',gap:10,alignItems:'end'}}>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Domain Name</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:14,color:'#111827',outline:'none',fontWeight:500}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={{padding:'10px 20px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:9,fontSize:13,fontWeight:700,cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1}}>{loading?'Checking…':'Check BIMI'}</button>
        </div>
        {error&&<div style={{marginTop:10,fontSize:12.5,color:'#dc2626',background:'#fef2f2',padding:'8px 12px',borderRadius:7,border:'1px solid #fca5a5'}}>{error}</div>}
      </form>

      {loading && <Spinner label={`Checking BIMI for ${domain}…`}/>}

      {result && !loading && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:'#111827'}}>BIMI Record — {result.domain}</div>
              <span style={{fontSize:11,padding:'3px 10px',borderRadius:99,...(result.found?{background:'#ecfdf5',color:'#059669',border:'1px solid #86efac'}:{background:'#fef2f2',color:'#dc2626',border:'1px solid #fca5a5'}),fontWeight:700}}>{result.found?'Found':'Not Found'}</span>
            </div>
            {result.found ? (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {[{label:'BIMI Record',value:result.record},{label:'Logo URL (SVG)',value:result.logoUrl||'Not set'},{label:'VMC URL',value:result.vmcUrl||'Not set'},{label:'DNS Lookup',value:`default._bimi.${result.domain}`}].map(f=>(
                  <div key={f.label} style={{display:'grid',gridTemplateColumns:'150px 1fr',padding:'8px 0',borderBottom:'1px solid #f5f5f5',fontSize:13}}>
                    <span style={{color:'#9ca3af',fontWeight:500}}>{f.label}</span>
                    <span style={{color:'#111827',fontWeight:500,wordBreak:'break-all'}}>{f.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:9,padding:'14px'}}>
                <div style={{fontSize:13,fontWeight:600,color:'#dc2626',marginBottom:6}}>No BIMI record found</div>
                <div style={{fontSize:12.5,color:'#374151',lineHeight:1.7}}>To set up BIMI:<br/>1. Ensure your DMARC policy is p=quarantine or p=reject<br/>2. Create an SVG logo (square, brand-compliant)<br/>3. Host the SVG at a public HTTPS URL<br/>4. Add TXT record at default._bimi.yourdomain.com: v=BIMI1; l=https://yourlogo.svg</div>
              </div>
            )}
          </div>
          <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'16px 20px'}}>
            <div style={{fontSize:12.5,fontWeight:700,color:'#374151',marginBottom:8}}>DMARC Prerequisite</div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:12,...statusCfg(result.dmarc.status),padding:'3px 10px',borderRadius:99,fontWeight:700,border:`1px solid ${statusCfg(result.dmarc.status).border}`}}>{statusCfg(result.dmarc.status).label}</span>
              <span style={{fontSize:12.5,color:'#374151'}}>DMARC policy: <b>{result.dmarc.policy||'Not set'}</b> — BIMI requires p=quarantine or p=reject</span>
            </div>
          </div>
        </div>
      )}

      {!result&&!loading&&<EmptyState icon="🏷" title="Check BIMI for any domain" desc="BIMI (Brand Indicators for Message Identification) lets you display your logo next to emails in supported clients like Gmail and Apple Mail."/>}
    </div>
  )
}

// ── Email Header Analyzer ─────────────────────────────────────────────────
function HeaderAnalyzer() {
  const [headers, setHeaders] = useState('')
  const [result,  setResult]  = useState(null)

  function analyze() {
    if (!headers.trim()) return
    const lines = headers.split(/\r?\n/)
    const get = (key) => {
      const line = lines.find(l => l.toLowerCase().startsWith(key.toLowerCase()+':'))
      return line ? line.split(':').slice(1).join(':').trim() : null
    }
    const getAll = (key) => lines.filter(l => l.toLowerCase().startsWith(key.toLowerCase()+':')).map(l => l.split(':').slice(1).join(':').trim())

    const from        = get('From')
    const to          = get('To')
    const subject     = get('Subject')
    const date        = get('Date')
    const messageId   = get('Message-ID')
    const replyTo     = get('Reply-To')
    const returnPath  = get('Return-Path')
    const received    = getAll('Received')
    const spfResult   = lines.find(l => l.toLowerCase().includes('spf='))?.match(/spf=(\w+)/i)?.[1] || null
    const dkimResult  = lines.find(l => l.toLowerCase().includes('dkim='))?.match(/dkim=(\w+)/i)?.[1] || null
    const dmarcResult = lines.find(l => l.toLowerCase().includes('dmarc='))?.match(/dmarc=(\w+)/i)?.[1] || null
    const xSpam       = get('X-Spam-Status') || get('X-Spam-Flag')
    const contentType = get('Content-Type')

    // Extract hops
    const hops = received.map((r,i) => {
      const byMatch = r.match(/by\s+([\w.-]+)/i)
      const fromMatch = r.match(/from\s+([\w.-]+)/i)
      const timeMatch = r.match(/;\s*(.+)$/)
      return { hop:i+1, from:fromMatch?.[1]||'—', by:byMatch?.[1]||'—', time:timeMatch?.[1]?.trim()||'—' }
    })

    // Suspicious signals
    const suspicious = []
    if (replyTo && from && !replyTo.includes(from.match(/@([\w.-]+)/)?.[1]||'')) suspicious.push('Reply-To domain differs from From domain — possible phishing')
    if (returnPath && from && !returnPath.includes(from.match(/@([\w.-]+)/)?.[1]||'')) suspicious.push('Return-Path domain differs from From domain')
    if (spfResult && !['pass','none'].includes(spfResult.toLowerCase())) suspicious.push(`SPF check: ${spfResult}`)
    if (dkimResult && dkimResult.toLowerCase()!=='pass') suspicious.push(`DKIM check: ${dkimResult}`)
    if (xSpam?.toLowerCase().includes('yes')) suspicious.push('Marked as spam by receiving server')

    setResult({ from, to, subject, date, messageId, replyTo, returnPath, spfResult, dkimResult, dmarcResult, xSpam, contentType, hops, suspicious })
  }

  const authColor = v => !v?'#9ca3af':v.toLowerCase()==='pass'?'#059669':'#dc2626'

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:900}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.05em'}}>Paste Email Headers</label>
        <textarea value={headers} onChange={e=>setHeaders(e.target.value)} placeholder="Paste full email headers here...&#10;&#10;To get headers:&#10;Gmail → More → Show original&#10;Outlook → File → Properties → Internet headers" rows={10} style={{width:'100%',padding:'12px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:12.5,color:'#111827',outline:'none',fontFamily:'monospace',resize:'vertical',lineHeight:1.6}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
        <div style={{marginTop:10,display:'flex',justifyContent:'flex-end'}}>
          <button onClick={analyze} disabled={!headers.trim()} style={{padding:'9px 22px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:9,fontSize:13,fontWeight:700,cursor:!headers.trim()?'not-allowed':'pointer',opacity:!headers.trim()?0.6:1}}>Analyse Headers</button>
        </div>
      </div>

      {result && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>

          {result.suspicious.length>0&&(
            <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderLeft:'4px solid #dc2626',borderRadius:10,padding:'14px 18px'}}>
              <div style={{fontSize:13,fontWeight:700,color:'#dc2626',marginBottom:8}}>⚠ Suspicious signals detected</div>
              {result.suspicious.map((s,i)=><div key={i} style={{fontSize:12.5,color:'#374151',marginBottom:4}}>● {s}</div>)}
            </div>
          )}

          <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fafafa',fontSize:12.5,fontWeight:700,color:'#374151'}}>Authentication Results</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:0}}>
              {[{label:'SPF',value:result.spfResult},{label:'DKIM',value:result.dkimResult},{label:'DMARC',value:result.dmarcResult}].map(({label,value})=>(
                <div key={label} style={{padding:'16px 20px',borderRight:'1px solid #f0f0f0',textAlign:'center'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>{label}</div>
                  <div style={{fontSize:18,fontWeight:800,color:authColor(value)}}>{value||'—'}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fafafa',fontSize:12.5,fontWeight:700,color:'#374151'}}>Email Details</div>
            {[{label:'From',value:result.from},{label:'To',value:result.to},{label:'Subject',value:result.subject},{label:'Date',value:result.date},{label:'Reply-To',value:result.replyTo},{label:'Return-Path',value:result.returnPath},{label:'Message-ID',value:result.messageId},{label:'Content-Type',value:result.contentType}].filter(f=>f.value).map(f=>(
              <div key={f.label} style={{display:'grid',gridTemplateColumns:'130px 1fr',padding:'10px 16px',borderBottom:'1px solid #f9fafb',fontSize:12.5}}>
                <span style={{color:'#9ca3af',fontWeight:500}}>{f.label}</span>
                <span style={{color:'#111827',fontWeight:500,wordBreak:'break-all'}}>{f.value}</span>
              </div>
            ))}
          </div>

          {result.hops.length>0&&(
            <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fafafa',fontSize:12.5,fontWeight:700,color:'#374151'}}>Routing Hops ({result.hops.length})</div>
              {result.hops.map(h=>(
                <div key={h.hop} style={{display:'grid',gridTemplateColumns:'40px 1fr 1fr',padding:'10px 16px',borderBottom:'1px solid #f9fafb',fontSize:12,alignItems:'center'}}>
                  <span style={{fontWeight:700,color:'#4f46e5'}}>#{h.hop}</span>
                  <div><span style={{color:'#9ca3af'}}>From: </span><span style={{color:'#111827',fontWeight:500}}>{h.from}</span><br/><span style={{color:'#9ca3af'}}>By: </span><span style={{color:'#111827',fontWeight:500}}>{h.by}</span></div>
                  <span style={{color:'#6b7280',fontSize:11}}>{h.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!result&&<EmptyState icon="📨" title="Paste email headers to analyse" desc="Get full headers from Gmail (More → Show original), Outlook (File → Properties), or Apple Mail (View → Message → All Headers)."/>}
    </div>
  )
}

// ── Phishing Checker ──────────────────────────────────────────────────────
function PhishingChecker() {
  const [domain,  setDomain]  = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')

  async function check(e) {
    e.preventDefault()
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) return
    setLoading(true); setResult(null); setError('')
    try {
      const [spfRecs, dmarcRecs, mxRecs, nsRecs] = await Promise.all([
        dnsLookup(d,'TXT'), dnsLookup(`_dmarc.${d}`,'TXT'),
        dnsLookup(d,'MX'), dnsLookup(d,'NS')
      ])
      const spf   = parseSpf(spfRecs)
      const dmarc = parseDmarc(dmarcRecs)
      const hasMx = mxRecs.length > 0
      const hasNs = nsRecs.length > 0

      const signals = []
      const risks   = []

      if (!hasMx)  { signals.push({type:'warn',text:'No MX records — domain may not send/receive email legitimately'}); risks.push(2) }
      if (!hasNs)  { signals.push({type:'error',text:'No NS records — domain may not be properly configured'}); risks.push(3) }
      if (spf.status==='missing') { signals.push({type:'warn',text:'No SPF record — anyone can spoof this domain'}); risks.push(2) }
      if (spf.all==='+all') { signals.push({type:'error',text:'SPF allows all senders (+all) — extremely permissive'}); risks.push(3) }
      if (dmarc.status==='missing') { signals.push({type:'warn',text:'No DMARC record — no email spoofing protection'}); risks.push(2) }
      if (dmarc.policy==='none') { signals.push({type:'warn',text:'DMARC policy is none — spoofed emails are not blocked'}); risks.push(1) }
      if (d.includes('-')) signals.push({type:'info',text:'Domain contains hyphens — sometimes used in typosquatting'})
      if (/\d{3,}/.test(d)) signals.push({type:'info',text:'Domain contains multiple numbers — unusual for legitimate brands'})
      if (d.split('.').some(p=>p.length>20)) signals.push({type:'warn',text:'Very long subdomain detected — common phishing technique'})

      if (signals.length===0) signals.push({type:'success',text:'No obvious phishing signals detected'})

      const riskScore = Math.min(100, risks.reduce((a,b)=>a+b,0)*15)
      const riskLevel = riskScore>=60?'High Risk':riskScore>=30?'Moderate Risk':'Low Risk'
      const riskColor = riskScore>=60?'#dc2626':riskScore>=30?'#d97706':'#059669'

      setResult({ domain:d, spf, dmarc, hasMx, hasNs, signals, riskScore, riskLevel, riskColor, mxRecs, nsRecs })
    } catch { setError('DNS lookup failed.') }
    finally { setLoading(false) }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:800}}>
      <form onSubmit={check} style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'18px 20px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 140px',gap:10,alignItems:'end'}}>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Domain to Check</label>
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="suspicious-domain.com" style={{width:'100%',padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:9,fontSize:14,color:'#111827',outline:'none',fontWeight:500}} onFocus={e=>e.target.style.borderColor='#4f46e5'} onBlur={e=>e.target.style.borderColor='#e5e7eb'}/>
          </div>
          <button type="submit" disabled={loading} style={{padding:'10px 20px',background:'#dc2626',color:'#fff',border:'none',borderRadius:9,fontSize:13,fontWeight:700,cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1}}>{loading?'Checking…':'Check Domain'}</button>
        </div>
        {error&&<div style={{marginTop:10,fontSize:12.5,color:'#dc2626',background:'#fef2f2',padding:'8px 12px',borderRadius:7,border:'1px solid #fca5a5'}}>{error}</div>}
        <div style={{marginTop:7,fontSize:11.5,color:'#9ca3af'}}>Checks SPF, DMARC, MX, NS records and domain patterns for phishing indicators.</div>
      </form>

      {loading && <Spinner label={`Analysing ${domain} for phishing signals…`}/>}

      {result && !loading && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{background:'#fff',border:`1px solid ${result.riskColor}44`,borderRadius:12,padding:'20px 24px',display:'flex',alignItems:'center',gap:20}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:44,fontWeight:800,color:result.riskColor,lineHeight:1}}>{result.riskScore}</div>
              <div style={{fontSize:11,color:'#9ca3af',marginTop:4}}>risk score</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:800,color:result.riskColor,marginBottom:8}}>{result.riskLevel}</div>
              <div style={{height:8,background:'#f3f4f6',borderRadius:99,overflow:'hidden',maxWidth:320}}>
                <div style={{height:'100%',width:`${result.riskScore}%`,background:result.riskColor,borderRadius:99}}/>
              </div>
              <div style={{fontSize:12,color:'#9ca3af',marginTop:6}}>{result.domain}</div>
            </div>
            <div style={{display:'flex',gap:10}}>
              {[{label:'SPF',st:result.spf.status},{label:'DMARC',st:result.dmarc.status},{label:'MX',st:result.hasMx?'great':'missing'},{label:'NS',st:result.hasNs?'great':'missing'}].map(({label,st})=>{
                const c=statusCfg(st)
                return <div key={label} style={{textAlign:'center',padding:'8px 12px',background:c.bg,border:`1px solid ${c.border}`,borderRadius:9}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.color,textTransform:'uppercase'}}>{label}</div>
                  <div style={{fontSize:12,fontWeight:700,color:c.color,marginTop:3}}>{c.label}</div>
                </div>
              })}
            </div>
          </div>

          <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fafafa',fontSize:12.5,fontWeight:700,color:'#374151'}}>Risk Signals</div>
            <div style={{padding:'8px 0'}}>
              {result.signals.map((s,i)=>{
                const cfg={error:{bg:'#fef2f2',border:'#fca5a5',color:'#dc2626',icon:'✕',iconBg:'#fee2e2'},warn:{bg:'#fffbeb',border:'#fde68a',color:'#d97706',icon:'!',iconBg:'#fef9c3'},info:{bg:'#eff6ff',border:'#bfdbfe',color:'#2563eb',icon:'i',iconBg:'#dbeafe'},success:{bg:'#f0fdf4',border:'#bbf7d0',color:'#059669',icon:'✓',iconBg:'#dcfce7'}}[s.type]||{}
                return <div key={i} style={{margin:'6px 12px',background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:9,padding:'10px 14px',display:'flex',gap:10,alignItems:'center'}}>
                  <div style={{width:22,height:22,borderRadius:6,background:cfg.iconBg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:cfg.color,flexShrink:0}}>{cfg.icon}</div>
                  <div style={{fontSize:12.5,color:'#374151'}}>{s.text}</div>
                </div>
              })}
            </div>
          </div>

          {result.mxRecs.length>0&&(
            <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'16px 20px'}}>
              <div style={{fontSize:12.5,fontWeight:700,color:'#374151',marginBottom:8}}>MX Records ({result.mxRecs.length})</div>
              {result.mxRecs.map((r,i)=><div key={i} style={{fontSize:12,color:'#374151',padding:'4px 0',borderBottom:'1px solid #f5f5f5',fontFamily:'monospace'}}>{r}</div>)}
            </div>
          )}
        </div>
      )}

      {!result&&!loading&&<EmptyState icon="🎣" title="Check any domain for phishing indicators" desc="Analyses SPF, DMARC, MX, NS records and domain naming patterns to identify potential phishing or spoofing risks."/>}
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────
function SingleResult({ result, selector }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:14,padding:'24px 28px',display:'grid',gridTemplateColumns:'auto 1fr auto',gap:24,alignItems:'center'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:48,fontWeight:800,color:scoreColor(result.score),letterSpacing:'-0.04em',lineHeight:1}}>{result.score}</div>
          <div style={{fontSize:12,color:'#9ca3af',marginTop:4}}>out of 100</div>
        </div>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
            <div style={{fontSize:20,fontWeight:800,color:scoreColor(result.score)}}>{scoreLabel(result.score)} Protection</div>
            <span style={{fontSize:11,padding:'3px 10px',borderRadius:99,background:scoreColor(result.score)+'22',color:scoreColor(result.score),fontWeight:700}}>{result.domain}</span>
          </div>
          <div style={{height:10,background:'#f3f4f6',borderRadius:99,overflow:'hidden',maxWidth:400}}>
            <div style={{height:'100%',width:`${result.score}%`,background:scoreColor(result.score),borderRadius:99,transition:'width 0.8s ease'}}/>
          </div>
          <div style={{fontSize:12,color:'#9ca3af',marginTop:6}}>Checked {fmtDT(result.checkedAt)}</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {[{label:'DMARC',st:result.dmarc.status},{label:'SPF',st:result.spf.status},{label:'DKIM',st:result.dkim.status}].map(({label,st})=>{const c=statusCfg(st);return<div key={label} style={{textAlign:'center',padding:'10px 14px',background:c.bg,border:`1px solid ${c.border}`,borderRadius:10}}><div style={{fontSize:10,fontWeight:700,color:c.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div><div style={{fontSize:13,fontWeight:700,color:c.color,marginTop:4}}>{c.label}</div></div>})}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:14}}>
        <RecordPanel title="DMARC" emoji="🛡" data={result.dmarc} fields={[{label:'Policy',value:result.dmarc.policy||'—'},{label:'Percent',value:result.dmarc.pct?result.dmarc.pct+'%':'—'},{label:'RUA',value:result.dmarc.rua||'Not set'},{label:'ASPF',value:result.dmarc.aspf==='s'?'Strict':'Relaxed'},{label:'ADKIM',value:result.dmarc.adkim==='s'?'Strict':'Relaxed'}]} lookup={`_dmarc.${result.domain}`}/>
        <RecordPanel title="SPF" emoji="📮" data={result.spf} fields={[{label:'All tag',value:result.spf.all||'—'},{label:'Mechanisms',value:result.spf.mechanisms?.length?result.spf.mechanisms.join(', '):'—'}]} lookup={result.domain}/>
        <RecordPanel title="DKIM" emoji="🔑" data={result.dkim} fields={[{label:'Selector',value:selector},{label:'Key type',value:result.dkim.keyType||'—'},{label:'Key present',value:result.dkim.hasKey?'Yes':'No'}]} lookup={`${selector}._domainkey.${result.domain}`}/>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:14,overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #f0f0f0',background:'#fafafa'}}><div style={{fontSize:13,fontWeight:700,color:'#374151'}}>Recommendations</div></div>
        <div style={{padding:'8px 0'}}>
          {result.recommendations.map((r,i)=>{const cfg={error:{bg:'#fef2f2',border:'#fca5a5',color:'#dc2626',icon:'✕',iconBg:'#fee2e2'},warn:{bg:'#fffbeb',border:'#fde68a',color:'#d97706',icon:'!',iconBg:'#fef9c3'},info:{bg:'#eff6ff',border:'#bfdbfe',color:'#2563eb',icon:'i',iconBg:'#dbeafe'},success:{bg:'#f0fdf4',border:'#bbf7d0',color:'#059669',icon:'✓',iconBg:'#dcfce7'}}[r.severity]||{};return<div key={i} style={{margin:'8px 16px',background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:10,padding:'12px 14px',display:'flex',gap:12,alignItems:'flex-start'}}><div style={{width:24,height:24,borderRadius:7,background:cfg.iconBg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:cfg.color,flexShrink:0}}>{cfg.icon}</div><div><div style={{fontSize:13,fontWeight:700,color:cfg.color,marginBottom:3}}>{r.title}</div><div style={{fontSize:12.5,color:'#374151',lineHeight:1.6}}>{r.detail}</div></div></div>})}
        </div>
      </div>
    </div>
  )
}

function RecordPanel({ title, emoji, data, fields, lookup }) {
  const [showRaw, setShowRaw] = useState(false)
  const sc = statusCfg(data.status)
  return (
    <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:16}}>{emoji}</span><span style={{fontSize:13,fontWeight:700,color:'#111827'}}>{title}</span></div>
        <span style={{fontSize:11,padding:'3px 9px',borderRadius:99,background:sc.bg,color:sc.color,fontWeight:700,border:`1px solid ${sc.border}`}}>{sc.label}</span>
      </div>
      <div style={{padding:'12px 16px'}}>
        {fields.map(f=><div key={f.label} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #f9fafb',fontSize:12}}><span style={{color:'#9ca3af',fontWeight:500}}>{f.label}</span><span style={{color:'#111827',fontWeight:600,textAlign:'right',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.value}</span></div>)}
        <div style={{marginTop:10}}>
          <div style={{fontSize:10.5,color:'#9ca3af',marginBottom:4,fontFamily:'monospace'}}>Lookup: {lookup}</div>
          <button onClick={()=>setShowRaw(s=>!s)} style={{fontSize:11,padding:'3px 9px',border:'1px solid #e5e7eb',borderRadius:6,background:'#f9fafb',cursor:'pointer',color:'#6b7280'}}>{showRaw?'Hide':'Show'} raw record</button>
          {showRaw&&<pre style={{marginTop:8,background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,padding:'10px',fontSize:10.5,fontFamily:'monospace',color:'#374151',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-all',maxHeight:120,overflowY:'auto'}}>{data.record||'No record found'}</pre>}
        </div>
      </div>
    </div>
  )
}

function InfoCard({ title, subtitle, color, children }) {
  return (
    <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fafafa'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#111827'}}>{title}</div>
        <div style={{fontSize:11.5,color:'#9ca3af',marginTop:2}}>{subtitle}</div>
      </div>
      <div style={{padding:'14px 16px'}}>{children}</div>
    </div>
  )
}

function CodeBlock({ content, onCopy, copied }) {
  return (
    <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
      <pre style={{flex:1,background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,padding:'12px',fontSize:11.5,fontFamily:'monospace',color:'#111827',lineHeight:1.7,whiteSpace:'pre-wrap',wordBreak:'break-all',maxHeight:160,overflowY:'auto',margin:0}}>{content}</pre>
      <button onClick={onCopy} style={{padding:'8px 14px',background:copied?'#059669':'#4f46e5',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>{copied?'Copied!':'Copy'}</button>
    </div>
  )
}

function Spinner({ label }) {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'50px 0',flexDirection:'column',gap:14}}>
      <div style={{width:38,height:38,border:'3px solid #e5e7eb',borderTopColor:'#4f46e5',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <div style={{fontSize:13,color:'#6b7280'}}>{label}</div>
    </div>
  )
}

function EmptyState({ icon, title, desc }) {
  return (
    <div style={{textAlign:'center',padding:'50px 20px'}}>
      <div style={{fontSize:44,marginBottom:12}}>{icon}</div>
      <div style={{fontSize:15,fontWeight:600,color:'#374151',marginBottom:6}}>{title}</div>
      <div style={{fontSize:13,color:'#9ca3af',maxWidth:400,margin:'0 auto',lineHeight:1.7}}>{desc}</div>
    </div>
  )
}

function PBtn({ label, active, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{minWidth:28,height:28,borderRadius:6,border:'1px solid #e5e7eb',background:active?'#4f46e5':disabled?'#f9fafb':'#fff',color:active?'#fff':disabled?'#d1d5db':'#374151',fontSize:12,fontWeight:500,cursor:disabled?'not-allowed':'pointer',padding:'0 5px'}}>{label}</button>
}
