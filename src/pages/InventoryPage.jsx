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
  if (sv === 'expiry_asc')  return a.sort((x,y) => { const dx=dateOf(x),dy=dateOf(y); return (!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy })
  if (sv === 'expiry_desc') return a.sort((x,y) => { const dx=dateOf(x),dy=dateOf(y); return (!dx&&!dy)?0:!dx?1:!dy?-1:dy-dx })
  if (sv === 'reissue_asc') return a.sort((x,y) => {
    const xr=x._alert==='reissue', yr=y._alert==='reissue'
    if (xr&&!yr) return -1; if (!xr&&yr) return 1
    const dx=dateOf(x),dy=dateOf(y); return (!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy
  })
  if (sv === 'renew_asc') return a.sort((x,y) => {
    const xr=x._alert==='renew', yr=y._alert==='renew'
    if (xr&&!yr) return -1; if (!xr&&yr) return 1
    const dx=dateOf(x),dy=dateOf(y); return (!dx&&!dy)?0:!dx?1:!dy?-1:dx-dy
  })
  if (sv === 'domain_asc') return a.sort((x,y) => (x['DomainName']||'').localeCompare(y['DomainName']||''))
  return a
}
const PER = 12
const SORTS = [
  { value:'expiry_asc',  label:'Expiring soonest'       },
  { value:'expiry_desc', label:'Expiring latest'         },
  { value:'reissue_asc', label:'Reissue — urgent first'  },
  { value:'renew_asc',   label:'Renew — urgent first'    },
  { value:'domain_asc',  label:'Domain A to Z'           },
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

  const display = records.map(r => ({ 'Order ID':r.order_id, 'DomainName':r.domain_name, 'Order Status':r.order_status, 'OrderDate':r.order_date, 'CertificateExpiresOn':r.cert_expiry, 'Order Expiration Date':r.order_expiry, '_alert':r.alert_type }))
  const reissueCount = display.filter(r => r._alert==='reissue').length
  const renewCount   = display.filter(r => r._alert==='renew').length
  const activeCount  = display.filter(r => r._alert==='none').length

  const urgentReissue = [...display].filter(r => r._alert==='reissue').sort((a,b) => {
    const da=parseDate(a['CertificateExpiresOn']),db=parseDate(b['CertificateExpiresOn'])
    return (!da||!db)?0:da-db
  }).slice(0,3)

  const filtered = sortRecords(display.filter(r => {
    const q = search.toLowerCase()
    const mQ = !q || r['DomainName']?.toLowerCase().includes(q) || r['Order ID']?.toLowerCase().includes(q)
    const mF = filter==='all'?true:filter==='reissue'?r._alert==='reissue':filter==='renew'?r._alert==='renew':filter==='active'?r._alert==='none':true
    return mQ && mF
  }), sort)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const paged = filtered.slice((page-1)*PER, page*PER)

  const stats = [
    { label:'Total Active',  value:display.length,  color:'#4f46e5', bg:'#eef2ff', icon:'◉', filt:'all',     sub:'All records'             },
    { label:'Reissue Alert', value:reissueCount,    color:'#dc2626', bg:'#fef2f2', icon:'⚠', filt:'reissue', sub:'Cert expires before order' },
    { label:'Renew Alert',   value:renewCount,      color:'#d97706', bg:'#fffbeb', icon:'↻', filt:'renew',   sub:'Same expiry date'          },
    { label:'No Action',     value:activeCount,     color:'#059669', bg:'#ecfdf5', icon:'✓', filt:'active',  sub:'Healthy'                   },
  ]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      <div style={{ padding:'16px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h1 style={{ fontSize:17, fontWeight:600, color:'#111827', letterSpacing:'-0.02em' }}>Certificate Inventory</h1>
          <p style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{fileName ? `${fileName} · ${display.length} active records` : 'Upload your order CSV to track SSL certificate expiry'}</p>
        </div>
        <button onClick={() => fileRef.current.click()} disabled={uploading}
          style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:600, cursor:uploading?'not-allowed':'pointer', opacity:uploading?0.7:1 }}>
          ↑ {uploading ? 'Uploading…' : display.length>0 ? 'Upload New CSV' : 'Upload CSV'}
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }} onChange={onFileInput} />
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'20px 28px' }}>

        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 0', flexDirection:'column', gap:14 }}>
            <div style={{ width:36, height:36, border:'3px solid #e5e7eb', borderTopColor:'#4f46e5', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
            <div style={{ fontSize:13, color:'#6b7280' }}>Loading inventory…</div>
          </div>
        )}

        {!loading && display.length===0 && (
          <div onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}
            style={{ border:`2px dashed ${dragOver?'#4f46e5':'#d1d5db'}`, borderRadius:16, padding:'64px 40px', textAlign:'center', cursor:'pointer', background:dragOver?'#f0f1ff':'#fff', transition:'all 0.2s', maxWidth:560, margin:'40px auto' }}>
            <div style={{ width:60, height:60, background:'#eef2ff', borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px', fontSize:26 }}>📄</div>
            <div style={{ fontSize:16, fontWeight:600, color:'#111827', marginBottom:6 }}>Drop your OrderDetail CSV here</div>
            <div style={{ fontSize:13, color:'#6b7280', marginBottom:20, lineHeight:1.6 }}>Expired, Cancelled and Pending orders are automatically excluded</div>
            <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'10px 24px', background:'#4f46e5', color:'#fff', borderRadius:9, fontSize:13, fontWeight:600 }}>↑ Choose File</div>
          </div>
        )}

        {!loading && display.length>0 && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:12, marginBottom:20 }}>
              {stats.map(s => (
                <div key={s.label} onClick={() => { setFilter(f => f===s.filt?'all':s.filt); setPage(1) }}
                  style={{ background:'#fff', border:`1.5px solid ${filter===s.filt?s.color:'#e5e7eb'}`, borderRadius:14, padding:'16px 18px', cursor:'pointer', transition:'all 0.15s', boxShadow:filter===s.filt?`0 0 0 3px ${s.color}22`:'none' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
                    <div style={{ width:30, height:30, borderRadius:8, background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, color:s.color }}>{s.icon}</div>
                  </div>
                  <div style={{ fontSize:32, fontWeight:700, color:s.color, letterSpacing:'-0.04em', lineHeight:1 }}>{s.value}</div>
                  <div style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {urgentReissue.length>0 && filter==='all' && !search && (
              <div style={{ background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:12, padding:'14px 18px', marginBottom:16 }}>
                <div style={{ fontSize:12.5, fontWeight:600, color:'#dc2626', marginBottom:10 }}>⚠ Urgent Reissue Required</div>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  {urgentReissue.map((r,i) => {
                    const days = daysUntil(r['CertificateExpiresOn'])
                    return (
                      <div key={i} onClick={() => setSelected(r)}
                        style={{ background:'#fff', border:'1px solid #fca5a5', borderRadius:9, padding:'10px 14px', cursor:'pointer', flex:'1', minWidth:160, transition:'all 0.1s' }}>
                        <div style={{ fontSize:12.5, fontWeight:600, color:'#111827', marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r['DomainName']}</div>
                        <div style={{ fontSize:11.5, color:'#dc2626', fontWeight:500 }}>{fmtD(r['CertificateExpiresOn'])} · {days}d left</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}>
                  <span style={{ fontSize:13, fontWeight:500, color:'#374151' }}>{filtered.length} records</span>
                  {filter!=='all' && <button onClick={()=>{setFilter('all');setPage(1)}} style={{ fontSize:11, padding:'3px 9px', border:'1px solid #e5e7eb', borderRadius:99, background:'#f3f4f6', cursor:'pointer', color:'#374151' }}>Clear ✕</button>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:12, color:'#6b7280' }}>Sort</span>
                  <select value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}
                    style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12.5, color:'#374151', outline:'none', background:'#fff', cursor:'pointer' }}>
                    {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search domain or order ID…"
                  style={{ padding:'7px 11px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12.5, color:'#374151', outline:'none', width:240 }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'120px 1fr 95px 115px 140px 110px', padding:'9px 16px', background:'#f9fafb', borderBottom:'1px solid #f0f0f0' }}>
                {['Order ID','Domain Name','Status','Order Date','Cert Expiry','Alert'].map((h,i) => (
                  <span key={i} style={{ fontSize:10.5, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</span>
                ))}
              </div>

              {filtered.length===0 && <div style={{ padding:'40px 0', textAlign:'center', fontSize:13, color:'#9ca3af' }}>No records match your search.</div>}

              {paged.map((row, i) => <CertRow key={i} row={row} idx={i} total={paged.length} onSelect={setSelected} />)}

              {filtered.length>PER && (
                <div style={{ padding:'12px 16px', borderTop:'1px solid #f3f4f6', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:12, color:'#6b7280' }}>Page {page} of {totalPages} · {filtered.length} records</span>
                  <div style={{ display:'flex', gap:4 }}>
                    <PBtn label="←" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} />
                    {[...Array(Math.min(totalPages,7))].map((_,i) => <PBtn key={i} label={i+1} active={page===i+1} onClick={()=>setPage(i+1)} />)}
                    {totalPages>7 && <span style={{ fontSize:12, color:'#9ca3af', lineHeight:'30px', padding:'0 4px' }}>…{totalPages}</span>}
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
  const daysColor = days===null?'#9ca3af':days<30?'#dc2626':days<90?'#d97706':'#059669'

  const alertCfg = {
    reissue: { bg:'#fef2f2', color:'#dc2626', label:'⚠ Reissue' },
    renew:   { bg:'#fffbeb', color:'#d97706', label:'↻ Renew'   },
    none:    { bg:'#ecfdf5', color:'#059669', label:'✓ OK'       },
  }[alert] || { bg:'#f3f4f6', color:'#6b7280', label:'—' }

  const statusColor = (row['Order Status']||'').toLowerCase()==='active'

  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} onClick={()=>onSelect(row)}
      style={{ display:'grid', gridTemplateColumns:'120px 1fr 95px 115px 140px 110px', padding:'12px 16px', borderBottom:idx<total-1?'1px solid #f9fafb':'none', alignItems:'center', background:hov?'#f8f9ff':idx%2===0?'#fff':'#fafafa', transition:'background 0.1s', cursor:'pointer' }}>
      <span style={{ fontFamily:'monospace', fontSize:11.5, color:'#4f46e5', fontWeight:500 }}>{row['Order ID']||'—'}</span>
      <div style={{ paddingRight:12 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row['DomainName']||'—'}</div>
      </div>
      <div>
        <span style={{ fontSize:11, padding:'3px 8px', borderRadius:99, background:statusColor?'#ecfdf5':'#f3f4f6', color:statusColor?'#059669':'#6b7280', fontWeight:600 }}>{row['Order Status']||'—'}</span>
      </div>
      <span style={{ fontSize:12, color:'#6b7280' }}>{fmtD(row['OrderDate'])}</span>
      <div>
        <div style={{ fontSize:12.5, color:daysColor, fontWeight:600 }}>{fmtD(row['CertificateExpiresOn'])}</div>
        {days!==null && (
          <div style={{ fontSize:10.5, color:daysColor, marginTop:2, display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:daysColor, display:'inline-block' }} />
            {days>0?`${days} days left`:'Expired'}
          </div>
        )}
      </div>
      <div>
        <span style={{ fontSize:11, padding:'4px 10px', borderRadius:99, background:alertCfg.bg, color:alertCfg.color, fontWeight:700 }}>{alertCfg.label}</span>
      </div>
    </div>
  )
}

function DetailModal({ row, onClose }) {
  const alert    = row._alert
  const days     = daysUntil(row['CertificateExpiresOn'])
  const orderDays= daysUntil(row['Order Expiration Date'])
  const alertCfg = {
    reissue: { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'⚠ Reissue Required', msg:'Certificate expires before order expiry — a reissue is needed to cover the full order period.' },
    renew:   { bg:'#fffbeb', border:'#fde68a', color:'#d97706', label:'↻ Renewal Required',  msg:'Certificate and order expire on the same date — renewal is due.'                              },
    none:    { bg:'#ecfdf5', border:'#86efac', color:'#059669', label:'✓ Active',             msg:null },
  }[alert] || {}

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:540, maxWidth:'95vw', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.18)' }}>

        <div style={{ padding:'18px 22px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:600, color:'#111827', marginBottom:3 }}>{row['DomainName']}</div>
            <div style={{ fontSize:12, color:'#6b7280' }}>Order ID: <span style={{ fontFamily:'monospace', color:'#4f46e5' }}>{row['Order ID']||'—'}</span></div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {alertCfg.label && <span style={{ fontSize:12, padding:'5px 13px', borderRadius:99, background:alertCfg.bg, color:alertCfg.color, fontWeight:700 }}>{alertCfg.label}</span>}
            <button onClick={onClose} style={{ width:30, height:30, border:'1px solid #e5e7eb', borderRadius:8, background:'#fff', cursor:'pointer', fontSize:15, color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
          </div>
        </div>

        {alertCfg.msg && (
          <div style={{ padding:'12px 22px', background:alertCfg.bg, borderBottom:`1px solid ${alertCfg.border}` }}>
            <div style={{ fontSize:13, color:alertCfg.color, lineHeight:1.6 }}>{alertCfg.msg}</div>
          </div>
        )}

        <div>
          {[
            ['Order ID',           row['Order ID'],           false],
            ['Domain Name',        row['DomainName'],         false],
            ['Order Status',       row['Order Status'],       false],
            ['Order Date',         fmtD(row['OrderDate']),    false],
            ['Certificate Expiry', fmtD(row['CertificateExpiresOn']) + (days!==null?` · ${days>0?days+'d left':'Expired'}`:''), true],
            ['Order Expiry',       fmtD(row['Order Expiration Date']) + (orderDays!==null?` · ${orderDays>0?orderDays+'d left':'Expired'}`:''), false],
          ].map(([label, value, highlight]) => (
            <div key={label} style={{ display:'grid', gridTemplateColumns:'160px 1fr', padding:'11px 22px', borderBottom:'1px solid #f5f5f5', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#6b7280', fontWeight:500 }}>{label}</span>
              <span style={{ fontSize:13, fontWeight:highlight?700:500, color:highlight&&days!==null&&days<90?'#dc2626':'#111827' }}>{value||'—'}</span>
            </div>
          ))}
        </div>

        <div style={{ padding:'16px 22px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'9px 24px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:600, cursor:'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function PBtn({ label, active, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ minWidth:30, height:30, borderRadius:6, border:'1px solid #e5e7eb', background:active?'#4f46e5':disabled?'#f9fafb':'#fff', color:active?'#fff':disabled?'#d1d5db':'#374151', fontSize:12.5, fontWeight:500, cursor:disabled?'not-allowed':'pointer', padding:'0 6px' }}>{label}</button>
}
