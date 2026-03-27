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
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysUntil(str) {
  const d = parseDate(str)
  if (!d || isNaN(d)) return null
  const today = new Date(); today.setHours(0,0,0,0)
  return Math.ceil((d - today) / (1000 * 60 * 60 * 24))
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
    const vals = line.split(',')
    const row = {}
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim() })
    return row
  })
}

function getAlert(row) {
  const status = (row['Order Status'] || '').toLowerCase()
  if (['expired', 'cancelled', 'pending'].includes(status)) return null
  const certExp  = parseDate(row['CertificateExpiresOn'])
  const orderExp = parseDate(row['Order Expiration Date'])
  if (!certExp || isNaN(certExp)) return null
  const today = new Date(); today.setHours(0,0,0,0)
  if (certExp < today) return null
  if (!orderExp || isNaN(orderExp)) return 'none'
  if (isSameDay(row['CertificateExpiresOn'], row['Order Expiration Date'])) return 'renew'
  if (certExp < orderExp) return 'reissue'
  return 'none'
}

const PER_PAGE = 15

export default function InventoryPage({ user }) {
  const [records,    setRecords]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [uploading,  setUploading]  = useState(false)
  const [fileName,   setFileName]   = useState('')
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState('all')
  const [page,       setPage]       = useState(1)
  const [dragOver,   setDragOver]   = useState(false)
  const [selected,   setSelected]   = useState(null)
  const fileRef = useRef()

  // Load from Supabase on mount
  useEffect(() => {
    if (!user?.id) return
    loadFromDb()
  }, [user])

  async function loadFromDb() {
    setLoading(true)
    const { data, error } = await supabase
      .from('certificate_inventory')
      .select('*')
      .eq('user_id', user.id)
      .order('cert_expiry', { ascending: true })
    if (!error && data) {
      setRecords(data)
      if (data.length > 0) setFileName(data[0].file_name || '')
    }
    setLoading(false)
  }

  async function processFile(file) {
    if (!file) return
    setUploading(true)
    const text = await file.text()
    const rows = parseCsv(text)
    const processed = rows
      .map(r => ({ ...r, _alert: getAlert(r) }))
      .filter(r => r._alert !== null && r['DomainName']?.trim())

    // Delete all existing records for this user
    await supabase.from('certificate_inventory').delete().eq('user_id', user.id)

    // Insert new records in batches of 50
    const toInsert = processed.map(r => ({
      user_id:      user.id,
      file_name:    file.name,
      order_id:     r['Order ID'] || '',
      domain_name:  r['DomainName'] || '',
      order_status: r['Order Status'] || '',
      order_date:   r['OrderDate'] || '',
      cert_expiry:  r['CertificateExpiresOn'] || '',
      order_expiry: r['Order Expiration Date'] || '',
      alert_type:   r._alert || 'none',
    }))

    // Insert in chunks
    const chunkSize = 50
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      await supabase.from('certificate_inventory').insert(toInsert.slice(i, i + chunkSize))
    }

    await loadFromDb()
    setFileName(file.name)
    setPage(1); setFilter('all'); setSearch('')
    setUploading(false)
  }

  function onFileInput(e) { processFile(e.target.files[0]) }
  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    processFile(e.dataTransfer.files[0])
  }

  // Map DB rows back to display format
  const display = records.map(r => ({
    'Order ID':              r.order_id,
    'DomainName':            r.domain_name,
    'Order Status':          r.order_status,
    'OrderDate':             r.order_date,
    'CertificateExpiresOn':  r.cert_expiry,
    'Order Expiration Date': r.order_expiry,
    '_alert':                r.alert_type,
  }))

  const filtered = display.filter(r => {
    const q = search.toLowerCase()
    const matchQ = !q ||
      r['DomainName']?.toLowerCase().includes(q) ||
      r['Order ID']?.toLowerCase().includes(q)
    const matchF = filter === 'all' ? true :
      filter === 'reissue' ? r._alert === 'reissue' :
      filter === 'renew'   ? r._alert === 'renew'   :
      filter === 'active'  ? r._alert === 'none'    : true
    return matchQ && matchF
  })

  const totalPages   = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const paged        = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE)
  const reissueCount = display.filter(r => r._alert === 'reissue').length
  const renewCount   = display.filter(r => r._alert === 'renew').length
  const activeCount  = display.filter(r => r._alert === 'none').length

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'18px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h1 style={{ fontSize:17, fontWeight:600, color:'#111827', letterSpacing:'-0.02em' }}>Certificate Inventory</h1>
          <p style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
            {fileName ? `Loaded from: ${fileName} · ${display.length} records` : 'Upload your order CSV to view expiry status and alerts'}
          </p>
        </div>
        <button onClick={() => fileRef.current.click()} disabled={uploading} style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 16px', background: display.length > 0 ? '#fff' : '#4f46e5', color: display.length > 0 ? '#374151' : '#fff', border: display.length > 0 ? '1px solid #e5e7eb' : 'none', borderRadius:9, fontSize:13, fontWeight:600, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
          {uploading ? 'Uploading…' : display.length > 0 ? '↑ Upload New File' : '↑ Upload CSV'}
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }} onChange={onFileInput} />
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'20px 28px' }}>

        {/* Loading state */}
        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 0', flexDirection:'column', gap:14 }}>
            <div style={{ width:36, height:36, border:'3px solid #e5e7eb', borderTopColor:'#4f46e5', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
            <div style={{ fontSize:13, color:'#6b7280' }}>Loading inventory…</div>
          </div>
        )}

        {/* Upload area */}
        {!loading && display.length === 0 && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current.click()}
            style={{ border:`2px dashed ${dragOver ? '#4f46e5' : '#d1d5db'}`, borderRadius:16, padding:'60px 40px', textAlign:'center', cursor:'pointer', background: dragOver ? '#f0f1ff' : '#fff', transition:'all 0.15s', maxWidth:600, margin:'0 auto' }}
          >
            <div style={{ width:56, height:56, background:'#f3f4f6', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="#9ca3af" strokeWidth="1.5" strokeLinejoin="round"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ fontSize:15, fontWeight:500, color:'#374151', marginBottom:6 }}>Drop your CSV file here</div>
            <div style={{ fontSize:13, color:'#9ca3af', marginBottom:16 }}>or click to browse</div>
            <div style={{ display:'inline-flex', padding:'8px 20px', background:'#4f46e5', color:'#fff', borderRadius:8, fontSize:13, fontWeight:600 }}>Choose File</div>
            <div style={{ fontSize:11.5, color:'#9ca3af', marginTop:14 }}>Supports OrderDetail.csv · Expired / Cancelled / Pending rows are automatically excluded</div>
          </div>
        )}

        {/* Records view */}
        {!loading && display.length > 0 && (
          <>
            {/* Stat cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12, marginBottom:20 }}>
              {[
                { label:'Total Active',  value:display.length,  color:'#4f46e5', sub:'Click to show all',           filt:'all'     },
                { label:'Reissue Alert', value:reissueCount,    color:'#dc2626', sub:'Cert expiry before order',     filt:'reissue' },
                { label:'Renew Alert',   value:renewCount,      color:'#f59e0b', sub:'Cert & order same date',       filt:'renew'   },
                { label:'No Action',     value:activeCount,     color:'#10b981', sub:'All good',                     filt:'active'  },
              ].map(s => (
                <div key={s.label} onClick={() => { setFilter(f => f === s.filt ? 'all' : s.filt); setPage(1) }}
                  style={{ background:'#fff', border:`1.5px solid ${filter === s.filt ? s.color : '#e5e7eb'}`, borderRadius:12, padding:'14px 16px', cursor:'pointer', transition:'all 0.15s' }}>
                  <div style={{ fontSize:11, color:'#6b7280', fontWeight:500 }}>{s.label}</div>
                  <div style={{ fontSize:28, fontWeight:600, color:s.color, marginTop:4, letterSpacing:'-0.03em' }}>{s.value}</div>
                  <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', gap:10, justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:13, fontWeight:500, color:'#374151' }}>{filtered.length} records</span>
                  {filter !== 'all' && (
                    <button onClick={() => { setFilter('all'); setPage(1) }} style={{ fontSize:11, padding:'3px 8px', border:'1px solid #e5e7eb', borderRadius:99, background:'#f3f4f6', cursor:'pointer', color:'#374151' }}>Clear ✕</button>
                  )}
                </div>
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Search domain or order ID…"
                  style={{ padding:'7px 11px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12.5, color:'#374151', outline:'none', width:260 }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'130px 1fr 110px 130px 130px 120px', padding:'9px 16px', background:'#f9fafb', borderBottom:'1px solid #f3f4f6' }}>
                {['Order ID','Domain Name','Status','Order Date','Cert Expiry','Alert'].map((h,i) => (
                  <span key={i} style={{ fontSize:10.5, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</span>
                ))}
              </div>

              {filtered.length === 0 && (
                <div style={{ padding:'40px 0', textAlign:'center', fontSize:13, color:'#9ca3af' }}>No records match your search.</div>
              )}

              {paged.map((row, i) => <CertRow key={i} row={row} idx={i} total={paged.length} onSelect={setSelected} />)}

              {filtered.length > PER_PAGE && (
                <div style={{ padding:'10px 16px', borderTop:'1px solid #f3f4f6', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:12, color:'#6b7280' }}>Page {page} of {totalPages} · {filtered.length} records</span>
                  <div style={{ display:'flex', gap:5 }}>
                    <PBtn label="←" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} />
                    {[...Array(Math.min(totalPages,7))].map((_,i) => (
                      <PBtn key={i} label={i+1} active={page===i+1} onClick={() => setPage(i+1)} />
                    ))}
                    {totalPages > 7 && <span style={{ fontSize:12, color:'#9ca3af', padding:'0 4px', lineHeight:'30px' }}>…{totalPages}</span>}
                    <PBtn label="→" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function CertRow({ row, idx, total, onSelect }) {
  const [hov, setHov] = useState(false)
  const alert = row._alert
  const days  = daysUntil(row['CertificateExpiresOn'])
  const daysColor = days === null ? '#9ca3af' : days < 30 ? '#dc2626' : days < 90 ? '#f59e0b' : '#10b981'

  const alertBadge = alert === 'reissue'
    ? <span style={{ fontSize:10.5, padding:'3px 9px', borderRadius:99, background:'#fef2f2', color:'#dc2626', fontWeight:600 }}>⚠ Reissue</span>
    : alert === 'renew'
    ? <span style={{ fontSize:10.5, padding:'3px 9px', borderRadius:99, background:'#fffbeb', color:'#92400e', fontWeight:600 }}>↻ Renew</span>
    : <span style={{ fontSize:10.5, padding:'3px 9px', borderRadius:99, background:'#ecfdf5', color:'#065f46', fontWeight:600 }}>✓ OK</span>

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={() => onSelect(row)}
      style={{ display:'grid', gridTemplateColumns:'130px 1fr 110px 130px 130px 120px', padding:'11px 16px', borderBottom: idx<total-1?'1px solid #f9fafb':'none', alignItems:'center', background: hov?'#f8f9ff':idx%2===0?'#fff':'#fafafa', transition:'background 0.1s', cursor:'pointer' }}>
      <span style={{ fontFamily:'monospace', fontSize:11.5, color:'#4f46e5', fontWeight:500 }}>{row['Order ID']||'—'}</span>
      <div style={{ fontSize:12.5, fontWeight:500, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingRight:12 }}>{row['DomainName']||'—'}</div>
      <span style={{ fontSize:11.5, padding:'2px 8px', borderRadius:99, background: row['Order Status']==='Active'?'#ecfdf5':'#f3f4f6', color: row['Order Status']==='Active'?'#065f46':'#6b7280', fontWeight:500, display:'inline-block' }}>{row['Order Status']||'—'}</span>
      <span style={{ fontSize:12, color:'#6b7280' }}>{fmtD(row['OrderDate'])}</span>
      <div>
        <div style={{ fontSize:12, color:daysColor, fontWeight:500 }}>{fmtD(row['CertificateExpiresOn'])}</div>
        {days !== null && <div style={{ fontSize:10.5, color:daysColor, marginTop:1 }}>{days > 0 ? `${days}d left` : 'Expired'}</div>}
      </div>
      {alertBadge}
    </div>
  )
}

function DetailModal({ row, onClose }) {
  const alert    = row._alert
  const days     = daysUntil(row['CertificateExpiresOn'])
  const orderDays= daysUntil(row['Order Expiration Date'])

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:520, maxWidth:'95vw', overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:'#111827' }}>{row['DomainName']}</div>
            <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>Order ID: {row['Order ID']||'—'}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {alert==='reissue' && <span style={{ fontSize:12, padding:'4px 12px', borderRadius:99, background:'#fef2f2', color:'#dc2626', fontWeight:600 }}>⚠ Reissue Required</span>}
            {alert==='renew'   && <span style={{ fontSize:12, padding:'4px 12px', borderRadius:99, background:'#fffbeb', color:'#92400e', fontWeight:600 }}>↻ Renewal Required</span>}
            {alert==='none'    && <span style={{ fontSize:12, padding:'4px 12px', borderRadius:99, background:'#ecfdf5', color:'#065f46', fontWeight:600 }}>✓ Active</span>}
            <button onClick={onClose} style={{ width:28, height:28, border:'1px solid #e5e7eb', borderRadius:7, background:'#fff', cursor:'pointer', fontSize:14, color:'#6b7280' }}>✕</button>
          </div>
        </div>
        {alert==='reissue' && <div style={{ padding:'10px 20px', background:'#fef2f2', borderBottom:'1px solid #fee2e2' }}><div style={{ fontSize:12.5, color:'#dc2626', fontWeight:500 }}>Certificate expires before order expiry — a reissue is needed.</div></div>}
        {alert==='renew'   && <div style={{ padding:'10px 20px', background:'#fffbeb', borderBottom:'1px solid #fde68a' }}><div style={{ fontSize:12.5, color:'#92400e', fontWeight:500 }}>Certificate and order expire on the same date — renewal is due.</div></div>}
        <div style={{ padding:'4px 0' }}>
          {[
            ['Order ID',           row['Order ID']],
            ['Domain Name',        row['DomainName']],
            ['Order Status',       row['Order Status']],
            ['Order Date',         fmtD(row['OrderDate'])],
            ['Certificate Expiry', fmtD(row['CertificateExpiresOn']) + (days!==null ? ` (${days>0?days+'d left':'expired'})` : '')],
            ['Order Expiry',       fmtD(row['Order Expiration Date']) + (orderDays!==null ? ` (${orderDays>0?orderDays+'d left':'expired'})` : '')],
          ].map(([label, value]) => (
            <div key={label} style={{ display:'grid', gridTemplateColumns:'160px 1fr', padding:'10px 20px', borderBottom:'1px solid #f9fafb', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#6b7280' }}>{label}</span>
              <span style={{ fontSize:13, fontWeight:500, color:'#111827' }}>{value||'—'}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:'14px 20px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'8px 20px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function PBtn({ label, active, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ minWidth:30, height:30, borderRadius:6, border:'1px solid #e5e7eb', background: active?'#4f46e5':disabled?'#f9fafb':'#fff', color: active?'#fff':disabled?'#d1d5db':'#374151', fontSize:12.5, fontWeight:500, cursor: disabled?'not-allowed':'pointer', padding:'0 6px' }}>{label}</button>
}
