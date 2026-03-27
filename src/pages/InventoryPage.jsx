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
  const dateOf = r => parseDate(r['CertificateExpiresOn'])
  if (sv==='expiry_asc')  return a.sort((x,y)=>{const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy})
  if (sv==='expiry_desc') return a.sort((x,y)=>{const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dy-dx})
  if (sv==='reissue_asc') return a.sort((x,y)=>{const xr=x._alert==='reissue',yr=y._alert==='reissue';if(xr&&!yr)return -1;if(!xr&&yr)return 1;const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy})
  if (sv==='renew_asc')   return a.sort((x,y)=>{const xr=x._alert==='renew',yr=y._alert==='renew';if(xr&&!yr)return -1;if(!xr&&yr)return 1;const dx=dateOf(x),dy=dateOf(y);return(!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy})
  if (sv==='domain_asc')  return a.sort((x,y)=>(x['DomainName']||'').localeCompare(y['DomainName']||''))
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
    const ins = processed.map(r => ({ user_id:user.id, file_name:file.name, order_id:r['Order ID']||'', domain_name:r['DomainName']||'', order_status:r['Order Status']||'', order_date:r['OrderDate']||'', cert_expiry:r['CertificateExpiresOn']||'', order_expiry:r['Order Expiration Date']||'', alert_type:r._alert||'none' }))
    for (let i = 0; i < ins.length; i += 50) await supabase.from('certificate_inventory').insert(ins.slice(i, i+50))
    await loadFromDb()
    setFileName(file.name); setPage(1); setFilter('all'); setSearch('')
    setUploading(false)
  }

  function onFileInput(e) { processFile(e.target.files[0]) }
  function onDrop(e) { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]) }

  const display = records.map(r => ({'Order ID':r.order_id,'DomainName':r.domain_name,'Order Status':r.order_status,'OrderDate':r.order_date,'CertificateExpiresOn':r.cert_expiry,'Order Expiration Date':r.order_expiry,'_alert':r.alert_type}))
  const reissueCount = display.filter(r => r._alert==='reissue').length
  const renewCount   = display.filter(r => r._alert==='renew').length
  const activeCount  = display.filter(r => r._alert==='none').length

  const urgentReissue = [...display].filter(r => r._alert==='reissue').sort((a,b)=>{const da=parseDate(a['CertificateExpiresOn']),db=parseDate(b['CertificateExpiresOn']);return(!da||!db)?0:da-db}).slice(0,3)

  const filtered = sortRecords(display.filter(r => {
    const q = search.toLowerCase()
    const mQ = !q || r['DomainName']?.toLowerCase().includes(q) || r['Order ID']?.toLowerCase().includes(q)
    const mF = filter==='all'?true:filter==='reissue'?r._alert==='reissue':filter==='renew'?r._alert==='renew':filter==='active'?r._alert==='none':true
    return mQ && mF
  }), sort)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const paged = filtered.slice((page-1)*PER, page*PER)

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#f5f6fa' }}>

      {/* Top bar */}
      <div style={{ padding:'14px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, background:'#eef2ff', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🔒</div>
          <div>
            <h1 style={{ fontSize:16, fontWeight:700, color:'#111827', letterSpacing:'-0.02em', margin:0 }}>Certificate Inventory</h1>
            <p style={{ fontSize:11.5, color:'#9ca3af', margin:0, marginTop:1 }}>{fileName ? `${fileName} · ${display.length} active records` : 'Upload your order CSV to track SSL expiry'}</p>
          </div>
        </div>
        <button onClick={() => fileRef.current.click()} disabled={uploading}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:uploading?'not-allowed':'pointer', opacity:uploading?0.7:1, letterSpacing:'-0.01em' }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 9V2M4 4l3-3 3 3M2 12h10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {uploading ? 'Uploading…' : display.length>0 ? 'Upload New CSV' : 'Upload CSV'}
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }} onChange={onFileInput} />
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'18px 28px' }}>

        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 0', flexDirection:'column', gap:14 }}>
            <div style={{ width:36, height:36, border:'3px solid #e5e7eb', borderTopColor:'#4f46e5', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
            <div style={{ fontSize:13, color:'#6b7280' }}>Loading inventory…</div>
          </div>
        )}

        {!loading && display.length===0 && (
          <div onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}
            style={{ border:`2px dashed ${dragOver?'#4f46e5':'#d1d5db'}`, borderRadius:16, padding:'60px 40px', textAlign:'center', cursor:'pointer', background:dragOver?'#f0f1ff':'#fff', transition:'all 0.2s', maxWidth:520, margin:'40px auto' }}>
            <div style={{ fontSize:40, marginBottom:14 }}>📋</div>
            <div style={{ fontSize:15, fontWeight:600, color:'#111827', marginBottom:6 }}>Drop your OrderDetail CSV here</div>
            <div style={{ fontSize:13, color:'#9ca3af', marginBottom:20 }}>Expired, Cancelled and Pending orders are automatically excluded</div>
            <div style={{ display:'inline-flex', gap:6, padding:'9px 22px', background:'#4f46e5', color:'#fff', borderRadius:8, fontSize:13, fontWeight:600 }}>↑ Choose File</div>
          </div>
        )}

        {!loading && display.length>0 && (
          <>
            {/* Stat cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:16 }}>
              {[
                {label:'Total Active',  value:display.length,  color:'#4f46e5', light:'#eef2ff', filt:'all',     icon:'◉'},
                {label:'Reissue Alert', value:reissueCount,    color:'#dc2626', light:'#fef2f2', filt:'reissue', icon:'⚠'},
                {label:'Renew Alert',   value:renewCount,      color:'#d97706', light:'#fffbeb', filt:'renew',   icon:'↻'},
                {label:'No Action',     value:activeCount,     color:'#059669', light:'#ecfdf5', filt:'active',  icon:'✓'},
              ].map(s => (
                <div key={s.label} onClick={()=>{setFilter(f=>f===s.filt?'all':s.filt);setPage(1)}}
                  style={{ background:'#fff', border:`1.5px solid ${filter===s.filt?s.color:'#e8eaed'}`, borderRadius:12, padding:'14px 16px', cursor:'pointer', transition:'all 0.15s', position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:filter===s.filt?s.color:'transparent', borderRadius:'12px 12px 0 0', transition:'all 0.15s' }} />
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                    <span style={{ fontSize:10.5, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>{s.label}</span>
                    <span style={{ fontSize:14, width:26, height:26, background:s.light, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', color:s.color }}>{s.icon}</span>
                  </div>
                  <div style={{ fontSize:30, fontWeight:800, color:s.color, letterSpacing:'-0.04em', lineHeight:1 }}>{s.value}</div>
                  {filter===s.filt && <div style={{ fontSize:10, color:s.color, marginTop:4, fontWeight:600 }}>● Filtered</div>}
                </div>
              ))}
            </div>

            {/* Urgent banner */}
            {urgentReissue.length>0 && filter==='all' && !search && (
              <div style={{ background:'#fff', border:'1px solid #fca5a5', borderLeft:'4px solid #dc2626', borderRadius:10, padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#dc2626', whiteSpace:'nowrap' }}>⚠ Urgent Reissue</div>
                <div style={{ display:'flex', gap:8, flex:1, flexWrap:'wrap' }}>
                  {urgentReissue.map((r,i) => {
                    const days = daysUntil(r['CertificateExpiresOn'])
                    return (
                      <div key={i} onClick={()=>setSelected(r)}
                        style={{ display:'flex', alignItems:'center', gap:8, background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:7, padding:'5px 12px', cursor:'pointer' }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', background:'#dc2626', flexShrink:0 }} />
                        <span style={{ fontSize:12, fontWeight:600, color:'#111827' }}>{r['DomainName']}</span>
                        <span style={{ fontSize:11, color:'#dc2626', fontWeight:500 }}>{days}d</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Table */}
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>

              {/* Toolbar */}
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f0f0', display:'flex', alignItems:'center', gap:10, background:'#fafafa' }}>
                <span style={{ fontSize:12.5, fontWeight:600, color:'#374151', flex:1 }}>{filtered.length} records</span>
                {filter!=='all' && <button onClick={()=>{setFilter('all');setPage(1)}} style={{ fontSize:11, padding:'3px 9px', border:'1px solid #e5e7eb', borderRadius:99, background:'#fff', cursor:'pointer', color:'#6b7280' }}>Clear ✕</button>}
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:11.5, color:'#9ca3af' }}>Sort</span>
                  <select value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}
                    style={{ padding:'5px 8px', border:'1px solid #e5e7eb', borderRadius:7, fontSize:12, color:'#374151', outline:'none', background:'#fff', cursor:'pointer' }}>
                    {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search domain or order ID…"
                  style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:7, fontSize:12, color:'#374151', outline:'none', width:220, background:'#fff' }} />
              </div>

              {/* Column header */}
              <div style={{ display:'grid', gridTemplateColumns:'110px minmax(0,1fr) 90px 100px 130px 90px', padding:'8px 14px', background:'#f9fafb', borderBottom:'1px solid #f0f0f0' }}>
                {['Order ID','Domain','Status','Order Date','Cert Expiry','Alert'].map((h,i) => (
                  <span key={i} style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</span>
                ))}
              </div>

              {filtered.length===0 && <div style={{ padding:'36px 0', textAlign:'center', fontSize:13, color:'#9ca3af' }}>No records match.</div>}

              {paged.map((row, i) => <CertRow key={i} row={row} idx={i} total={paged.length} onSelect={setSelected} />)}

              {filtered.length>PER && (
                <div style={{ padding:'10px 14px', borderTop:'1px solid #f0f0f0', display:'flex', alignItems:'center', justifyContent:'space-between', background:'#fafafa' }}>
                  <span style={{ fontSize:11.5, color:'#9ca3af' }}>Page {page} of {totalPages} · {filtered.length} total</span>
                  <div style={{ display:'flex', gap:4 }}>
                    <PBtn label="←" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} />
                    {[...Array(Math.min(totalPages,7))].map((_,i) => <PBtn key={i} label={i+1} active={page===i+1} onClick={()=>setPage(i+1)} />)}
                    {totalPages>7 && <span style={{ fontSize:12, color:'#9ca3af', lineHeight:'28px', padding:'0 4px' }}>…{totalPages}</span>}
                    <PBtn label="→" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal row={selected} onClose={()=>setSelected(null)} />}
    </div>
  )
}

function CertRow({ row, idx, total, onSelect }) {
  const [hov, setHov] = useState(false)
  const alert = row._alert
  const days  = daysUntil(row['CertificateExpiresOn'])
  const urgent = days !== null && days < 30
  const warning = days !== null && days >= 30 && days < 90
  const daysColor = urgent ? '#dc2626' : warning ? '#d97706' : '#059669'

  const alertCfg = {
    reissue: { bg:'#fef2f2', color:'#dc2626', label:'Reissue', dot:'#dc2626' },
    renew:   { bg:'#fffbeb', color:'#d97706', label:'Renew',   dot:'#d97706' },
    none:    { bg:'#ecfdf5', color:'#059669', label:'OK',      dot:'#059669' },
  }[alert] || { bg:'#f3f4f6', color:'#6b7280', label:'—', dot:'#9ca3af' }

  const isActive = (row['Order Status']||'').toLowerCase()==='active'

  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} onClick={()=>onSelect(row)}
      style={{ display:'grid', gridTemplateColumns:'110px minmax(0,1fr) 90px 100px 130px 90px', padding:'10px 14px', borderBottom:idx<total-1?'1px solid #f5f5f5':'none', alignItems:'center', background:hov?'#f8f9ff':idx%2===0?'#fff':'#fdfdfd', transition:'background 0.1s', cursor:'pointer' }}>

      <span style={{ fontFamily:'monospace', fontSize:11, color:'#6366f1', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row['Order ID']||'—'}</span>

      <div style={{ paddingRight:8, overflow:'hidden' }}>
        <div style={{ fontSize:12.5, fontWeight:600, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row['DomainName']||'—'}</div>
      </div>

      <div>
        <span style={{ fontSize:10.5, padding:'2px 7px', borderRadius:99, background:isActive?'#ecfdf5':'#f3f4f6', color:isActive?'#059669':'#6b7280', fontWeight:700, letterSpacing:'0.02em' }}>
          {row['Order Status']||'—'}
        </span>
      </div>

      <span style={{ fontSize:11.5, color:'#9ca3af' }}>{fmtD(row['OrderDate'])}</span>

      <div>
        <div style={{ fontSize:12, color:daysColor, fontWeight:700 }}>{fmtD(row['CertificateExpiresOn'])}</div>
        {days!==null && (
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:daysColor, display:'inline-block', flexShrink:0 }} />
            <span style={{ fontSize:10.5, color:daysColor, fontWeight:600 }}>{days>0?`${days}d left`:'Expired'}</span>
          </div>
        )}
      </div>

      <div>
        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 9px', borderRadius:99, background:alertCfg.bg, color:alertCfg.color, fontWeight:700 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:alertCfg.dot, display:'inline-block' }} />
          {alertCfg.label}
        </span>
      </div>
    </div>
  )
}

function DetailModal({ row, onClose }) {
  const alert     = row._alert
  const days      = daysUntil(row['CertificateExpiresOn'])
  const orderDays = daysUntil(row['Order Expiration Date'])
  const daysColor = days===null?'#374151':days<30?'#dc2626':days<90?'#d97706':'#059669'

  const alertCfg = {
    reissue: { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'⚠ Reissue Required', msg:'Certificate expires before order expiry — a reissue is needed.' },
    renew:   { bg:'#fffbeb', border:'#fde68a', color:'#d97706', label:'↻ Renewal Required',  msg:'Certificate and order expire on the same date — renewal is due.' },
    none:    { bg:'#ecfdf5', border:'#86efac', color:'#059669', label:'✓ Active',             msg:null },
  }[alert] || {}

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(17,24,39,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(2px)' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:520, maxWidth:'95vw', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.18)' }}>

        <div style={{ padding:'18px 22px', background: alertCfg.bg||'#fff', borderBottom:`1px solid ${alertCfg.border||'#e5e7eb'}`, display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#111827', marginBottom:4 }}>{row['DomainName']}</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'monospace', fontSize:11.5, color:'#6366f1', fontWeight:600 }}>{row['Order ID']||'—'}</span>
              {alertCfg.label && <span style={{ fontSize:11, padding:'2px 9px', borderRadius:99, background:'#fff', color:alertCfg.color, fontWeight:700, border:`1px solid ${alertCfg.border}` }}>{alertCfg.label}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ width:30, height:30, border:'1px solid rgba(0,0,0,0.1)', borderRadius:8, background:'rgba(255,255,255,0.8)', cursor:'pointer', fontSize:14, color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
        </div>

        {alertCfg.msg && (
          <div style={{ padding:'10px 22px', background:'#fffbf0', borderBottom:'1px solid #fde68a' }}>
            <div style={{ fontSize:12.5, color:alertCfg.color, lineHeight:1.6, fontWeight:500 }}>{alertCfg.msg}</div>
          </div>
        )}

        <div style={{ padding:'6px 0' }}>
          {[
            ['Order Status',       row['Order Status']],
            ['Order Date',         fmtD(row['OrderDate'])],
            ['Certificate Expiry', null],
            ['Order Expiry',       null],
          ].map(([label]) => null)}

          {[
            {label:'Order Status',       value:row['Order Status'],          highlight:false, mono:false},
            {label:'Order Date',         value:fmtD(row['OrderDate']),       highlight:false, mono:false},
            {label:'Certificate Expiry', value:fmtD(row['CertificateExpiresOn']), highlight:true, days:days},
            {label:'Order Expiry',       value:fmtD(row['Order Expiration Date']), highlight:false, days:orderDays},
            {label:'Order ID',           value:row['Order ID'],              highlight:false, mono:true},
          ].map(({label, value, highlight, mono, days:d}) => (
            <div key={label} style={{ display:'grid', gridTemplateColumns:'150px 1fr', padding:'10px 22px', borderBottom:'1px solid #f5f5f5', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#9ca3af', fontWeight:500 }}>{label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:13, fontWeight:highlight?700:500, color:highlight?daysColor:'#111827', fontFamily:mono?'monospace':'inherit' }}>{value||'—'}</span>
                {d!==null && d!==undefined && <span style={{ fontSize:11, padding:'2px 7px', borderRadius:99, background:d<30?'#fef2f2':d<90?'#fffbeb':'#ecfdf5', color:d<30?'#dc2626':d<90?'#d97706':'#059669', fontWeight:600 }}>{d>0?`${d}d left`:'Expired'}</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'9px 24px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:600, cursor:'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function PBtn({ label, active, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ minWidth:28, height:28, borderRadius:6, border:'1px solid #e5e7eb', background:active?'#4f46e5':disabled?'#f9fafb':'#fff', color:active?'#fff':disabled?'#d1d5db':'#374151', fontSize:12, fontWeight:500, cursor:disabled?'not-allowed':'pointer', padding:'0 5px' }}>{label}</button>
}
