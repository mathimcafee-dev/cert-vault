import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function parseDate(str) {
  if (!str || typeof str !== 'string') return null
  const match = str.trim().match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (!match) return null
  const [, dd, mm, yyyy] = match
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`)
}
function fmtD(str) {
  const d = parseDate(str)
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
}
function daysUntil(str) {
  const d = parseDate(str)
  if (!d || isNaN(d)) return null
  const today = new Date(); today.setHours(0,0,0,0)
  return Math.ceil((d - today) / 86400000)
}
function isSameDay(a, b) {
  const da = parseDate(a), db = parseDate(b)
  if (!da || !db) return false
  return da.toDateString() === db.toDateString()
}
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const vals = line.split(','), row = {}
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim() })
    return row
  })
}
function getAlert(row) {
  const status = (row['Order Status'] || '').toLowerCase()
  if (['expired','cancelled','pending'].includes(status)) return null
  const certExp = parseDate(row['CertificateExpiresOn'])
  const orderExp = parseDate(row['Order Expiration Date'])
  if (!certExp || isNaN(certExp)) return null
  const today = new Date(); today.setHours(0,0,0,0)
  if (certExp < today) return null
  if (!orderExp || isNaN(orderExp)) return 'none'
  if (isSameDay(row['CertificateExpiresOn'], row['Order Expiration Date'])) return 'renew'
  if (certExp < orderExp) return 'reissue'
  return 'none'
}
function sortRecords(arr, sv) {
  const a = [...arr]
  const dateOf = r => parseDate(r.cert_expiry)
  if (sv==='expiry_asc')  return a.sort((x,y)=>{const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy})
  if (sv==='expiry_desc') return a.sort((x,y)=>{const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dy-dx})
  if (sv==='reissue_asc') return a.sort((x,y)=>{const xr=x.alert_type==='reissue',yr=y.alert_type==='reissue';if(xr&&!yr)return -1;if(!xr&&yr)return 1;const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy})
  if (sv==='renew_asc')   return a.sort((x,y)=>{const xr=x.alert_type==='renew',yr=y.alert_type==='renew';if(xr&&!yr)return -1;if(!xr&&yr)return 1;const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy})
  if (sv==='domain_asc')  return a.sort((x,y)=>(x.domain_name||'').localeCompare(y.domain_name||''))
  return a
}
const PER = 15
const SORTS = [
  {value:'expiry_asc',  label:'Expiring soonest'},
  {value:'expiry_desc', label:'Expiring latest'},
  {value:'reissue_asc', label:'Reissue — urgent first'},
  {value:'renew_asc',   label:'Renew — urgent first'},
  {value:'domain_asc',  label:'Domain A to Z'},
]

export default function InventoryPage({ user }) {
  const [records,   setRecords]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [fileName,  setFileName]  = useState('')
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [sort,      setSort]      = useState('expiry_asc')
  const [page,      setPage]      = useState(1)
  const [dragOver,  setDragOver]  = useState(false)
  const [selected,  setSelected]  = useState(null)
  const fileRef = useRef()

  useEffect(() => { if (user?.id) loadFromDb() }, [user])

  async function loadFromDb() {
    setLoading(true)
    const { data, error } = await supabase.from('certificate_inventory').select('*').eq('user_id', user.id).order('cert_expiry', { ascending: true })
    if (!error && data) { setRecords(data); if (data.length > 0) setFileName(data[0].file_name || '') }
    setLoading(false)
  }

  async function processFile(file) {
    if (!file) return
    setUploading(true)
    const text = await file.text()
    const rows = parseCsv(text)
    const processed = rows.map(r => ({ ...r, _alert: getAlert(r) })).filter(r => r._alert !== null && r['DomainName']?.trim())
    await supabase.from('certificate_inventory').delete().eq('user_id', user.id)
    const ins = processed.map(r => ({
      user_id:      user.id,
      file_name:    file.name,
      order_id:     r['Order ID']||'',
      domain_name:  r['DomainName']||'',
      product_name: r['ProductName']||r['Product']||r['Product Name']||r['Certificate Type']||'',
      order_status: r['Order Status']||'',
      order_date:   r['OrderDate']||'',
      cert_expiry:  r['CertificateExpiresOn']||'',
      order_expiry: r['Order Expiration Date']||'',
      alert_type:   r._alert||'none',
    }))
    for (let i = 0; i < ins.length; i += 50) await supabase.from('certificate_inventory').insert(ins.slice(i, i+50))
    await loadFromDb()
    setFileName(file.name); setPage(1); setFilter('all'); setSearch('')
    setUploading(false)
  }

  function onFileInput(e) { processFile(e.target.files[0]) }
  function onDrop(e) { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]) }
  async function clearData() {
    await supabase.from('certificate_inventory').delete().eq('user_id', user.id)
    setRecords([]); setFileName(''); setFilter('all'); setSearch(''); setPage(1)
  }

  const reissueCount = records.filter(r => r.alert_type==='reissue').length
  const renewCount   = records.filter(r => r.alert_type==='renew').length
  const activeCount  = records.filter(r => r.alert_type==='none').length

  const urgentReissue = [...records]
    .filter(r => r.alert_type==='reissue')
    .sort((a,b)=>{ const da=parseDate(a.cert_expiry),db=parseDate(b.cert_expiry); return(!da||!db)?0:da-db })
    .slice(0,3)

  const filtered = sortRecords(records.filter(r => {
    const q = search.toLowerCase()
    const mQ = !q || r.domain_name?.toLowerCase().includes(q) || r.order_id?.includes(q) || r.product_name?.toLowerCase().includes(q)
    const mF = filter==='all'?true:filter==='reissue'?r.alert_type==='reissue':filter==='renew'?r.alert_type==='renew':filter==='active'?r.alert_type==='none':true
    return mQ && mF
  }), sort)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const paged = filtered.slice((page-1)*PER, page*PER)

  // Ocean Fresh colors
  const OC = { primary:'#0891b2', light:'#ecfeff', border:'#cffafe', accent:'#67e8f9', dark:'#083344', muted:'#67c5d4' }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#ecfeff' }}>

      {/* Header */}
      <div style={{ padding:'14px 22px', background:'#fff', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, background:'linear-gradient(135deg,#cffafe,#a5f3fc)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🔒</div>
          <div>
            <h1 style={{ fontSize:16, fontWeight:800, color:'#083344', letterSpacing:'-0.03em', margin:0 }}>Certificate Inventory</h1>
            <p style={{ fontSize:11.5, color:'#67c5d4', margin:0, marginTop:1 }}>{fileName ? `${fileName} · ${records.length} active records` : 'Upload your order CSV to track SSL expiry'}</p>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {records.length > 0 && (
            <button onClick={clearData}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              ✕ Clear Data
            </button>
          )}
          <button onClick={() => fileRef.current.click()} disabled={uploading}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:uploading?'not-allowed':'pointer', opacity:uploading?0.7:1, fontFamily:'inherit', boxShadow:'0 2px 8px rgba(8,145,178,.3)' }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 9V2M4 4l3-3 3 3M2 12h10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {uploading ? 'Uploading…' : records.length > 0 ? 'Upload New CSV' : 'Upload CSV'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }} onChange={onFileInput} />
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'16px 22px' }}>

        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 0', flexDirection:'column', gap:14 }}>
            <div style={{ width:36, height:36, border:'3px solid #cffafe', borderTopColor:'#0891b2', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
            <div style={{ fontSize:13, color:'#67c5d4' }}>Loading inventory…</div>
          </div>
        )}

        {!loading && records.length === 0 && (
          <div onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}
            style={{ border:`2px dashed ${dragOver?'#0891b2':'#a5f3fc'}`, borderRadius:16, padding:'60px 40px', textAlign:'center', cursor:'pointer', background:dragOver?'#f0fdff':'#fff', transition:'all 0.2s', maxWidth:520, margin:'40px auto' }}>
            <div style={{ fontSize:40, marginBottom:14 }}>📋</div>
            <div style={{ fontSize:15, fontWeight:700, color:'#083344', marginBottom:6 }}>Drop your OrderDetail CSV here</div>
            <div style={{ fontSize:13, color:'#67c5d4', marginBottom:20 }}>Expired, Cancelled and Pending orders are automatically excluded</div>
            <div style={{ display:'inline-flex', gap:6, padding:'10px 24px', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', borderRadius:9, fontSize:13, fontWeight:700, boxShadow:'0 4px 12px rgba(8,145,178,.3)' }}>↑ Choose File</div>
          </div>
        )}

        {!loading && records.length > 0 && (
          <>
            {/* Stat cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:14 }}>
              {[
                {label:'Total Active',  value:records.length,  color:'#0891b2', light:'#cffafe', topBar:'linear-gradient(90deg,#0891b2,#06b6d4)', filt:'all',     icon:'◉'},
                {label:'Reissue Alert', value:reissueCount,    color:'#dc2626', light:'#fef2f2', topBar:'linear-gradient(90deg,#dc2626,#ef4444)',  filt:'reissue', icon:'⚠'},
                {label:'Renew Alert',   value:renewCount,      color:'#d97706', light:'#fff7ed', topBar:'linear-gradient(90deg,#f59e0b,#fbbf24)',  filt:'renew',   icon:'↻'},
                {label:'No Action',     value:activeCount,     color:'#059669', light:'#ecfdf5', topBar:'linear-gradient(90deg,#10b981,#34d399)',  filt:'active',  icon:'✓'},
              ].map(s => (
                <div key={s.label} onClick={()=>{setFilter(f=>f===s.filt?'all':s.filt);setPage(1)}}
                  style={{ background: filter===s.filt&&s.filt==='all'?'linear-gradient(135deg,#cffafe,#e0f9ff)':'#fff', border:`1.5px solid ${filter===s.filt?s.color:'#cffafe'}`, borderRadius:12, padding:'14px 16px', cursor:'pointer', transition:'all 0.15s', position:'relative', overflow:'hidden', boxShadow:filter===s.filt?`0 4px 16px ${s.color}22`:'none' }}>
                  <div style={{ position:'absolute', top:0, left:0, right:0, height:3.5, background:filter===s.filt?s.topBar:'transparent', borderRadius:'12px 12px 0 0' }} />
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <span style={{ fontSize:10.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.06em' }}>{s.label}</span>
                    <div style={{ width:26, height:26, background:s.light, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:s.color }}>{s.icon}</div>
                  </div>
                  <div style={{ fontSize:30, fontWeight:900, color:s.color, letterSpacing:'-0.04em', lineHeight:1 }}>{s.value}</div>
                  {filter===s.filt && <div style={{ fontSize:10, color:s.color, marginTop:5, fontWeight:700 }}>● Filtered</div>}
                </div>
              ))}
            </div>

            {/* Urgent banner */}
            {urgentReissue.length > 0 && filter === 'all' && !search && (
              <div style={{ background:'#fff', border:'1px solid #fca5a5', borderLeft:'4px solid #dc2626', borderRadius:10, padding:'11px 16px', marginBottom:12, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#dc2626', whiteSpace:'nowrap' }}>⚠ Urgent Reissue</div>
                <div style={{ display:'flex', gap:8, flex:1, flexWrap:'wrap' }}>
                  {urgentReissue.map((r,i) => {
                    const days = daysUntil(r.cert_expiry)
                    return (
                      <div key={i} onClick={()=>setSelected(r)}
                        style={{ display:'flex', alignItems:'center', gap:7, background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:7, padding:'5px 11px', cursor:'pointer' }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', background:'#dc2626', flexShrink:0 }}/>
                        <span style={{ fontSize:12, fontWeight:600, color:'#083344' }}>{r.domain_name}</span>
                        <span style={{ fontSize:11, color:'#dc2626', fontWeight:700 }}>{days}d</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Table */}
            <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, overflow:'hidden', boxShadow:'0 2px 12px rgba(8,145,178,.06)' }}>

              {/* Toolbar */}
              <div style={{ padding:'10px 16px', borderBottom:'1.5px solid #f0fdff', display:'flex', alignItems:'center', gap:10, background:'linear-gradient(90deg,#f0fdff,#ecfeff)' }}>
                <span style={{ fontSize:12.5, fontWeight:700, color:'#083344', flex:1 }}>{filtered.length} records</span>
                {filter !== 'all' && (
                  <button onClick={()=>{setFilter('all');setPage(1)}}
                    style={{ fontSize:11, padding:'3px 9px', border:'1px solid #a5f3fc', borderRadius:99, background:'#fff', cursor:'pointer', color:'#0891b2', fontFamily:'inherit', fontWeight:600 }}>
                    Clear ✕
                  </button>
                )}
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:11.5, color:'#67c5d4', fontWeight:500 }}>Sort</span>
                  <select value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}
                    style={{ padding:'5px 9px', border:'1.5px solid #a5f3fc', borderRadius:7, fontSize:12, color:'#083344', outline:'none', background:'#fff', cursor:'pointer', fontFamily:'inherit' }}>
                    {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search domain, product, order ID…"
                  style={{ padding:'6px 11px', border:'1.5px solid #a5f3fc', borderRadius:7, fontSize:12, color:'#083344', outline:'none', width:230, background:'#fff', fontFamily:'inherit', transition:'border-color .15s' }}
                  onFocus={e=>e.target.style.borderColor='#0891b2'}
                  onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
              </div>

              {/* Column headers — 6 columns filling full width */}
              <div style={{ display:'grid', gridTemplateColumns:'110px minmax(0,2fr) 90px 110px 130px 90px', padding:'9px 16px', background:'#f0fdff', borderBottom:'1.5px solid #cffafe', gap:8 }}>
                {['Order ID','Domain','Status','Order Date','Cert Expiry','Alert'].map((h,i) => (
                  <span key={i} style={{ fontSize:10, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</span>
                ))}
              </div>

              {filtered.length === 0 && (
                <div style={{ padding:'36px 0', textAlign:'center', fontSize:13, color:'#67c5d4' }}>No records match your search.</div>
              )}

              {paged.map((row, i) => <CertRow key={row.id||i} row={row} idx={i} total={paged.length} onSelect={setSelected}/>)}

              {filtered.length > PER && (
                <div style={{ padding:'10px 16px', borderTop:'1.5px solid #f0fdff', display:'flex', alignItems:'center', justifyContent:'space-between', background:'linear-gradient(90deg,#f0fdff,#ecfeff)' }}>
                  <span style={{ fontSize:11.5, color:'#67c5d4' }}>Page {page} of {totalPages} · {filtered.length} records</span>
                  <div style={{ display:'flex', gap:4 }}>
                    <PBtn label="←" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}/>
                    {[...Array(Math.min(totalPages,7))].map((_,i) => <PBtn key={i} label={i+1} active={page===i+1} onClick={()=>setPage(i+1)}/>)}
                    {totalPages > 7 && <span style={{ fontSize:12, color:'#67c5d4', lineHeight:'28px', padding:'0 4px' }}>…{totalPages}</span>}
                    <PBtn label="→" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}/>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal row={selected} onClose={()=>setSelected(null)}/>}
    </div>
  )
}

function CertRow({ row, idx, total, onSelect }) {
  const [hov, setHov] = useState(false)
  const days    = daysUntil(row.cert_expiry)
  const isHot   = days !== null && days < 30
  const isWarm  = days !== null && days >= 30 && days < 90
  const daysColor = isHot ? '#dc2626' : isWarm ? '#b45309' : '#059669'
  const alert   = row.alert_type
  const isActive = (row.order_status||'').toLowerCase() === 'active'

  const alertCfg = {
    reissue: { bg:'#fef2f2', color:'#b91c1c', label:'Reissue', dot:'#dc2626' },
    renew:   { bg:'#fff7ed', color:'#92400e', label:'Renew',   dot:'#f59e0b' },
    none:    { bg:'#f0fdf4', color:'#166534', label:'OK',      dot:'#22c55e' },
  }[alert] || { bg:'#f0f9ff', color:'#0891b2', label:'—', dot:'#67c5d4' }

  return (
    <div
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={()=>onSelect(row)}
      style={{ display:'grid', gridTemplateColumns:'110px minmax(0,2fr) 90px 110px 130px 90px', padding:'10px 16px', borderBottom:idx<total-1?'1px solid #f0fdff':'none', alignItems:'center', background:hov?'#f0fdff':idx%2===0?'#fff':'#fafeff', transition:'background 0.1s', cursor:'pointer', gap:8 }}>

      <span style={{ fontFamily:'monospace', fontSize:11, color:'#0891b2', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.order_id||'—'}</span>

      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-0.01em' }}>{row.domain_name||'—'}</div>
      </div>

      <div>
        <span style={{ fontSize:10.5, padding:'2px 8px', borderRadius:99, background:isActive?'#ecfdf5':'#f3f4f6', color:isActive?'#059669':'#6b7280', fontWeight:700 }}>
          {row.order_status||'—'}
        </span>
      </div>

      <span style={{ fontSize:11.5, color:'#9ca3af', whiteSpace:'nowrap' }}>{fmtD(row.order_date)}</span>

      <div>
        <div style={{ fontSize:12, color:daysColor, fontWeight:700, whiteSpace:'nowrap' }}>{fmtD(row.cert_expiry)}</div>
        {days !== null && (
          <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:2 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:daysColor, display:'inline-block', flexShrink:0 }}/>
            <span style={{ fontSize:10.5, color:daysColor, fontWeight:600 }}>{days>0?`${days}d left`:'Expired'}</span>
          </div>
        )}
      </div>

      <div>
        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 9px', borderRadius:99, background:alertCfg.bg, color:alertCfg.color, fontWeight:700 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:alertCfg.dot, display:'inline-block', flexShrink:0 }}/>
          {alertCfg.label}
        </span>
      </div>
    </div>
  )
}

function DetailModal({ row, onClose }) {
  const days      = daysUntil(row.cert_expiry)
  const orderDays = daysUntil(row.order_expiry)
  const daysColor = days===null?'#083344':days<30?'#dc2626':days<90?'#b45309':'#059669'
  const alert     = row.alert_type

  const alertCfg = {
    reissue: { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'⚠ Reissue Required', msg:'Certificate expires before order expiry — a reissue is needed.' },
    renew:   { bg:'#fffbeb', border:'#fde68a', color:'#d97706', label:'↻ Renewal Required',  msg:'Certificate and order expire on the same date — renewal is due.' },
    none:    { bg:'#ecfdf5', border:'#86efac', color:'#059669', label:'✓ Active',             msg:null },
  }[alert] || {}

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(8,51,68,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(3px)' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:560, maxWidth:'95vw', overflow:'hidden', boxShadow:'0 24px 64px rgba(8,145,178,.25)' }}>

        <div style={{ padding:'18px 22px', background:alertCfg.bg||'#f0fdff', borderBottom:`1px solid ${alertCfg.border||'#cffafe'}`, display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:'#083344', marginBottom:4, letterSpacing:'-0.02em' }}>{row.domain_name}</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'monospace', fontSize:11.5, color:'#0891b2', fontWeight:600 }}>#{row.order_id||'—'}</span>
              {alertCfg.label && <span style={{ fontSize:11, padding:'2px 9px', borderRadius:99, background:'#fff', color:alertCfg.color, fontWeight:700, border:`1px solid ${alertCfg.border}` }}>{alertCfg.label}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ width:30, height:30, border:'1.5px solid #cffafe', borderRadius:8, background:'rgba(255,255,255,0.8)', cursor:'pointer', fontSize:14, color:'#0891b2', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
        </div>

        {alertCfg.msg && (
          <div style={{ padding:'10px 22px', background:'#fffbf0', borderBottom:'1px solid #fde68a' }}>
            <div style={{ fontSize:12.5, color:alertCfg.color, lineHeight:1.6, fontWeight:500 }}>{alertCfg.msg}</div>
          </div>
        )}

        <div style={{ padding:'4px 0' }}>
          {[
            {label:'Order ID',           value:row.order_id,          mono:true,  highlight:false},
            {label:'Domain Name',        value:row.domain_name,       mono:false, highlight:false},
            {label:'Product',            value:row.product_name,      mono:false, highlight:false},
            {label:'Order Status',       value:row.order_status,      mono:false, highlight:false},
            {label:'Order Date',         value:fmtD(row.order_date),  mono:false, highlight:false},
            {label:'Certificate Expiry', value:fmtD(row.cert_expiry), mono:false, highlight:true,  days:days},
            {label:'Order Expiry',       value:fmtD(row.order_expiry),mono:false, highlight:false, days:orderDays},
          ].map(({label,value,mono,highlight,days:d}) => (
            <div key={label} style={{ display:'grid', gridTemplateColumns:'160px 1fr', padding:'10px 22px', borderBottom:'1px solid #f0fdff', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#67c5d4', fontWeight:600 }}>{label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:13, fontWeight:highlight?700:500, color:highlight?daysColor:'#083344', fontFamily:mono?'monospace':'inherit' }}>{value||'—'}</span>
                {d!==null&&d!==undefined&&<span style={{ fontSize:11, padding:'2px 7px', borderRadius:99, background:d<30?'#fef2f2':d<90?'#fffbeb':'#ecfdf5', color:d<30?'#dc2626':d<90?'#b45309':'#059669', fontWeight:700 }}>{d>0?`${d}d left`:'Expired'}</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1.5px solid #cffafe', display:'flex', justifyContent:'flex-end', background:'#f0fdff' }}>
          <button onClick={onClose} style={{ padding:'9px 24px', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 4px 12px rgba(8,145,178,.3)' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function PBtn({ label, active, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ minWidth:28, height:28, borderRadius:6, border:`1.5px solid ${active?'#0891b2':'#cffafe'}`, background:active?'#0891b2':disabled?'#f0fdff':'#fff', color:active?'#fff':disabled?'#a5f3fc':'#0891b2', fontSize:12, fontWeight:600, cursor:disabled?'not-allowed':'pointer', padding:'0 5px', fontFamily:'inherit' }}>
      {label}
    </button>
  )
}
