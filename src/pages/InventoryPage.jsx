import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

// ── Date helpers ──────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()
  if (!s || s === '—') return null
  const M = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }

  // DD-MM-YYYY  or  DD/MM/YYYY
  let m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (m) return new Date(+m[3], +m[2]-1, +m[1])

  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(+m[1], +m[2]-1, +m[3])

  // DD Mon YYYY  e.g. "03 Mar 2025"  or  "03-Mar-2025"
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/)
  if (m) { const mo = M[m[2].toLowerCase()]; if (mo !== undefined) return new Date(+m[3], mo, +m[1]) }

  // Mon DD YYYY  e.g. "Mar 03 2025"
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/)
  if (m) { const mo = M[m[1].toLowerCase()]; if (mo !== undefined) return new Date(+m[3], mo, +m[2]) }

  // MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(+m[3], +m[1]-1, +m[2])

  const d = new Date(s)
  return isNaN(d) ? null : d
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

// ── CSV parser — handles quoted fields with commas inside ─────────────────
function parseCsvLine(line) {
  const result = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      result.push(cur.trim()); cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur.trim())
  return result
}

function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = clean.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"+|"+$/g, '').trim())
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = (vals[i] || '').replace(/^"+|"+$/g, '').trim() })
    return row
  }).filter(r => Object.values(r).some(v => v))
}

// ── Column detection — handles any TSS/reseller CSV header variant ────────
function detectColumns(keys) {
  const lc = keys.map(k => k.toLowerCase().trim())
  const find = (...candidates) => {
    for (const c of candidates) {
      const idx = lc.indexOf(c.toLowerCase())
      if (idx !== -1) return keys[idx]
    }
    // partial match fallback
    for (const c of candidates) {
      const idx = lc.findIndex(k => k.includes(c.toLowerCase()))
      if (idx !== -1) return keys[idx]
    }
    return ''
  }
  return {
    orderId:     find('Order ID', 'OrderID', 'Order Id', 'order_id'),
    domain:      find('DomainName', 'Domain Name', 'Domain', 'CommonName', 'Common Name', 'cn'),
    product:     find('ProductName', 'Product Name', 'Product', 'Certificate Type', 'CertType', 'cert type'),
    status:      find('Order Status', 'OrderStatus', 'Status', 'order status'),
    orderDate:   find('OrderDate', 'Order Date', 'Purchase Date', 'Created Date', 'order date'),
    certExpiry:  find('CertificateExpiresOn', 'Certificate Expiry Date', 'Cert Expiry', 'CertExpiry',
                      'Certificate Expires', 'Expiry Date', 'ValidTo', 'Valid To', 'ExpiryDate',
                      'Certificate Expiration', 'cert expiry', 'expiry', 'expires'),
    orderExpiry: find('Order Expiration Date', 'OrderExpirationDate', 'Order Expiry',
                      'Expiration Date', 'order expiry', 'expiration'),
  }
}

// ── Alert logic ───────────────────────────────────────────────────────────
function getAlert(certExpiry, orderExpiry, status) {
  const s = (status || '').toLowerCase()
  if (['expired','cancelled','revoked'].includes(s)) return null
  const certExp  = parseDate(certExpiry)
  const orderExp = parseDate(orderExpiry)
  if (!certExp || isNaN(certExp)) return null
  const today = new Date(); today.setHours(0,0,0,0)
  // Grace: skip only if expired more than 7 days ago
  if (certExp < new Date(today.getTime() - 7 * 86400000)) return null
  if (!orderExp || isNaN(orderExp)) return 'renew'
  if (isSameDay(certExpiry, orderExpiry)) return 'renew'
  if (certExp < orderExp) return 'reissue'
  return 'none'
}

// ── Sort ──────────────────────────────────────────────────────────────────
function sortRecords(arr, sv) {
  const a = [...arr]
  const d = r => parseDate(r.cert_expiry)
  if (sv === 'expiry_asc')  return a.sort((x,y) => { const dx=d(x),dy=d(y); return !dx&&!dy?0:!dx?1:!dy?-1:dx-dy })
  if (sv === 'expiry_desc') return a.sort((x,y) => { const dx=d(x),dy=d(y); return !dx&&!dy?0:!dx?1:!dy?-1:dy-dx })
  if (sv === 'reissue_asc') return a.sort((x,y) => {
    const xr=x.alert_type==='reissue', yr=y.alert_type==='reissue'
    if (xr&&!yr) return -1; if (!xr&&yr) return 1
    const dx=d(x),dy=d(y); return !dx&&!dy?0:!dx?1:!dy?-1:dx-dy
  })
  if (sv === 'renew_asc') return a.sort((x,y) => {
    const xr=x.alert_type==='renew', yr=y.alert_type==='renew'
    if (xr&&!yr) return -1; if (!xr&&yr) return 1
    const dx=d(x),dy=d(y); return !dx&&!dy?0:!dx?1:!dy?-1:dx-dy
  })
  if (sv === 'domain_asc') return a.sort((x,y) => (x.domain_name||'').localeCompare(y.domain_name||''))
  return a
}

const PER = 15
const SORTS = [
  { value:'expiry_asc',  label:'Expiring soonest'     },
  { value:'expiry_desc', label:'Expiring latest'       },
  { value:'reissue_asc', label:'Reissue — urgent first'},
  { value:'renew_asc',   label:'Renew — urgent first'  },
  { value:'domain_asc',  label:'Domain A → Z'          },
]

// ── Main component ────────────────────────────────────────────────────────
export default function InventoryPage({ user }) {
  const [records,   setRecords]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
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
    const { data, error } = await supabase
      .from('certificate_inventory')
      .select('*')
      .eq('user_id', user.id)
    if (error) { console.error('Load error:', error); setLoading(false); return }
    if (data && data.length > 0) {
      // Sort client-side by parsed date — avoids string sort issues
      const sorted = [...data].sort((a,b) => {
        const da = parseDate(a.cert_expiry), db = parseDate(b.cert_expiry)
        return !da&&!db?0:!da?1:!db?-1:da-db
      })
      setRecords(sorted)
      setFileName(data[0].file_name || '')
    } else {
      setRecords([])
    }
    setLoading(false)
  }

  async function processFile(file) {
    if (!file) return
    setUploading(true)
    setUploadMsg('Reading file…')
    try {
      const text = await file.text()
      setUploadMsg('Parsing CSV…')
      const rows = parseCsv(text)

      if (rows.length === 0) {
        alert('No data found in file.\n\nMake sure you are uploading a CSV file (not Excel .xlsx).\nIf you have an Excel file, open it and Save As → CSV.')
        setUploading(false); setUploadMsg(''); return
      }

      const keys = Object.keys(rows[0])
      const COL  = detectColumns(keys)
      console.log('File columns:', keys)
      console.log('Detected mapping:', COL)

      if (!COL.domain) {
        alert(`Could not find a Domain column.\n\nColumns found in your file:\n${keys.join(', ')}\n\nExpected something like: DomainName, Domain Name, CommonName`)
        setUploading(false); setUploadMsg(''); return
      }

      if (!COL.certExpiry) {
        alert(`Could not find a Certificate Expiry column.\n\nColumns found in your file:\n${keys.join(', ')}\n\nExpected something like: CertificateExpiresOn, Certificate Expiry Date, ExpiryDate, ValidTo`)
        setUploading(false); setUploadMsg(''); return
      }

      setUploadMsg(`Processing ${rows.length} rows…`)

      const toInsert = []
      for (const r of rows) {
        const certExpiry  = r[COL.certExpiry]  || ''
        const orderExpiry = r[COL.orderExpiry] || ''
        const status      = r[COL.status]      || 'Active'
        const domain      = r[COL.domain]      || ''
        if (!domain.trim()) continue
        const alert = getAlert(certExpiry, orderExpiry, status)
        if (alert === null) continue
        toInsert.push({
          user_id:      user.id,
          file_name:    file.name,
          order_id:     r[COL.orderId]    || '',
          domain_name:  domain,
          order_status: status,
          order_date:   r[COL.orderDate]  || '',
          cert_expiry:  certExpiry,
          order_expiry: orderExpiry,
          alert_type:   alert,
        })
      }

      if (toInsert.length === 0) {
        const sample = rows[0]
        const sampleCert = sample[COL.certExpiry] || 'empty'
        const sampleStatus = sample[COL.status] || 'empty'
        alert(`Found ${rows.length} rows but all were filtered out.\n\nSample row check:\n- Cert expiry value: "${sampleCert}"\n- Status value: "${sampleStatus}"\n\nCommon fixes:\n1. All certs may be expired (skipped automatically)\n2. Status may be "Cancelled" or "Expired" for all rows\n3. The expiry date format may not be recognised\n\nCheck the browser console (F12) for the detected column mapping.`)
        setUploading(false); setUploadMsg(''); return
      }

      setUploadMsg('Saving to database…')
      // Delete existing records first
      const { error: delErr } = await supabase
        .from('certificate_inventory')
        .delete()
        .eq('user_id', user.id)
      if (delErr) console.warn('Delete warning:', delErr)

      // Insert in batches of 50
      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50)
        const { error: insErr } = await supabase
          .from('certificate_inventory')
          .insert(batch)
        if (insErr) {
          console.error('Insert error on batch', i, insErr)
          alert(`Insert failed: ${insErr.message}\n\nThis usually means a column in your Supabase table is missing.\n\nRun this SQL in Supabase → SQL Editor:\nALTER TABLE certificate_inventory ADD COLUMN IF NOT EXISTS order_expiry TEXT DEFAULT '';`)
          setUploading(false); setUploadMsg(''); return
        }
      }

      setUploadMsg('Loading results…')
      await loadFromDb()
      setFileName(file.name)
      setPage(1); setFilter('all'); setSearch('')
      setUploadMsg(`✓ Uploaded ${toInsert.length} records`)
      setTimeout(() => setUploadMsg(''), 3000)

    } catch (e) {
      console.error('Upload error:', e)
      alert(`Upload failed: ${e.message}`)
    }
    setUploading(false)
  }

  function onFileInput(e) { if (e.target.files[0]) processFile(e.target.files[0]); e.target.value = '' }
  function onDrop(e) { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]) }

  async function clearData() {
    if (!window.confirm('Clear all certificate records?')) return
    await supabase.from('certificate_inventory').delete().eq('user_id', user.id)
    setRecords([]); setFileName(''); setFilter('all'); setSearch(''); setPage(1)
  }

  const reissueCount = records.filter(r => r.alert_type === 'reissue').length
  const renewCount   = records.filter(r => r.alert_type === 'renew').length
  const okCount      = records.filter(r => r.alert_type === 'none').length

  const urgentReissue = [...records]
    .filter(r => r.alert_type === 'reissue')
    .sort((a,b) => { const da=parseDate(a.cert_expiry),db=parseDate(b.cert_expiry); return !da||!db?0:da-db })
    .slice(0, 3)

  const filtered = sortRecords(records.filter(r => {
    const q  = search.toLowerCase()
    const mQ = !q || (r.domain_name||'').toLowerCase().includes(q) || (r.order_id||'').includes(q)
    const mF = filter==='all' ? true
             : filter==='reissue' ? r.alert_type==='reissue'
             : filter==='renew'   ? r.alert_type==='renew'
             : filter==='ok'      ? r.alert_type==='none'
             : true
    return mQ && mF
  }), sort)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const paged      = filtered.slice((page-1)*PER, page*PER)

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#ecfeff' }}>

      {/* Header bar */}
      <div style={{ padding:'13px 22px', background:'#fff', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
          <div style={{ width:36, height:36, background:'linear-gradient(135deg,#cffafe,#a5f3fc)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🔒</div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:'#083344', letterSpacing:'-0.03em' }}>Certificate Inventory</div>
            <div style={{ fontSize:11.5, color:'#67c5d4', marginTop:1 }}>
              {uploadMsg || (fileName ? `${fileName} · ${records.length} records loaded` : 'Upload your TSS order CSV to begin')}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          {records.length > 0 && (
            <button onClick={clearData} style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 13px', background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              ✕ Clear
            </button>
          )}
          <button onClick={() => fileRef.current.click()} disabled={uploading}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:uploading?'not-allowed':'pointer', opacity:uploading?0.7:1, fontFamily:'inherit', boxShadow:'0 2px 8px rgba(8,145,178,.3)', whiteSpace:'nowrap' }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 9V2M4 4l3-3 3 3M2 12h10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {uploading ? 'Uploading…' : records.length > 0 ? 'Re-upload CSV' : 'Upload CSV'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.CSV" style={{ display:'none' }} onChange={onFileInput}/>
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'14px 22px' }}>

        {/* Loading */}
        {loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 0', flexDirection:'column', gap:14 }}>
            <div style={{ width:36, height:36, border:'3px solid #cffafe', borderTopColor:'#0891b2', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
            <div style={{ fontSize:13, color:'#67c5d4' }}>Loading inventory…</div>
          </div>
        )}

        {/* Empty state / drop zone */}
        {!loading && records.length === 0 && (
          <div onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}
            onClick={() => fileRef.current.click()}
            style={{ border:`2px dashed ${dragOver?'#0891b2':'#a5f3fc'}`, borderRadius:16, padding:'56px 40px', textAlign:'center', cursor:'pointer', background:dragOver?'#f0fdff':'#fff', transition:'all .2s', maxWidth:520, margin:'32px auto' }}>
            <div style={{ fontSize:44, marginBottom:14 }}>📋</div>
            <div style={{ fontSize:15, fontWeight:700, color:'#083344', marginBottom:6 }}>Drop your TSS Order CSV here</div>
            <div style={{ fontSize:13, color:'#67c5d4', marginBottom:6 }}>or click to browse</div>
            <div style={{ fontSize:12, color:'#a5f3fc', marginBottom:20 }}>Expired, Cancelled and Revoked orders are automatically excluded</div>
            <div style={{ display:'inline-flex', padding:'10px 28px', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', borderRadius:9, fontSize:13, fontWeight:700, boxShadow:'0 4px 12px rgba(8,145,178,.3)' }}>↑ Choose CSV File</div>
          </div>
        )}

        {/* Data */}
        {!loading && records.length > 0 && (
          <>
            {/* Stat cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, marginBottom:14 }}>
              {[
                { label:'Total Active',  value:records.length, color:'#0891b2', light:'#cffafe', bar:'linear-gradient(90deg,#0891b2,#06b6d4)', filt:'all',     icon:'◉' },
                { label:'Reissue Alert', value:reissueCount,   color:'#dc2626', light:'#fef2f2', bar:'linear-gradient(90deg,#dc2626,#ef4444)', filt:'reissue', icon:'⚠' },
                { label:'Renew Alert',   value:renewCount,     color:'#d97706', light:'#fff7ed', bar:'linear-gradient(90deg,#f59e0b,#fbbf24)', filt:'renew',   icon:'↻' },
                { label:'No Action',     value:okCount,        color:'#059669', light:'#ecfdf5', bar:'linear-gradient(90deg,#10b981,#34d399)', filt:'ok',      icon:'✓' },
              ].map(s => (
                <div key={s.label} onClick={() => { setFilter(f => f===s.filt?'all':s.filt); setPage(1) }}
                  style={{ background: filter===s.filt&&s.filt==='all'?'linear-gradient(135deg,#cffafe,#e0f9ff)':'#fff', border:`1.5px solid ${filter===s.filt?s.color:'#cffafe'}`, borderRadius:12, padding:'14px 16px', cursor:'pointer', transition:'all .15s', position:'relative', overflow:'hidden', boxShadow: filter===s.filt?`0 4px 16px ${s.color}22`:'none' }}>
                  <div style={{ position:'absolute', top:0, left:0, right:0, height:3.5, background:filter===s.filt?s.bar:'transparent', borderRadius:'12px 12px 0 0' }}/>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <span style={{ fontSize:10.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'.06em' }}>{s.label}</span>
                    <div style={{ width:26, height:26, background:s.light, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:s.color }}>{s.icon}</div>
                  </div>
                  <div style={{ fontSize:30, fontWeight:900, color:s.color, letterSpacing:'-.04em', lineHeight:1 }}>{s.value}</div>
                  {filter===s.filt && <div style={{ fontSize:10, color:s.color, marginTop:5, fontWeight:700 }}>● Filtered</div>}
                </div>
              ))}
            </div>

            {/* Urgent banner */}
            {urgentReissue.length > 0 && filter==='all' && !search && (
              <div style={{ background:'#fff', border:'1px solid #fca5a5', borderLeft:'4px solid #dc2626', borderRadius:10, padding:'11px 16px', marginBottom:12, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#dc2626', whiteSpace:'nowrap' }}>⚠ Urgent Reissue</span>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {urgentReissue.map((r,i) => (
                    <div key={i} onClick={() => setSelected(r)}
                      style={{ display:'flex', alignItems:'center', gap:7, background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:7, padding:'5px 11px', cursor:'pointer' }}>
                      <div style={{ width:6, height:6, borderRadius:'50%', background:'#dc2626' }}/>
                      <span style={{ fontSize:12, fontWeight:600, color:'#083344' }}>{r.domain_name}</span>
                      <span style={{ fontSize:11, color:'#dc2626', fontWeight:700 }}>{daysUntil(r.cert_expiry)}d</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Table */}
            <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:12, overflow:'hidden', boxShadow:'0 2px 12px rgba(8,145,178,.06)' }}>

              {/* Toolbar */}
              <div style={{ padding:'10px 16px', borderBottom:'1.5px solid #f0fdff', display:'flex', alignItems:'center', gap:10, background:'linear-gradient(90deg,#f0fdff,#ecfeff)', flexWrap:'wrap' }}>
                <span style={{ fontSize:12.5, fontWeight:700, color:'#083344', flex:1, whiteSpace:'nowrap' }}>{filtered.length} records</span>
                {filter !== 'all' && (
                  <button onClick={() => { setFilter('all'); setPage(1) }}
                    style={{ fontSize:11, padding:'3px 9px', border:'1px solid #a5f3fc', borderRadius:99, background:'#fff', cursor:'pointer', color:'#0891b2', fontFamily:'inherit', fontWeight:600 }}>
                    Clear filter ✕
                  </button>
                )}
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:11.5, color:'#67c5d4' }}>Sort</span>
                  <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
                    style={{ padding:'5px 9px', border:'1.5px solid #a5f3fc', borderRadius:7, fontSize:12, color:'#083344', outline:'none', background:'#fff', cursor:'pointer', fontFamily:'inherit' }}>
                    {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Search domain or order ID…"
                  style={{ padding:'6px 11px', border:'1.5px solid #a5f3fc', borderRadius:7, fontSize:12, color:'#083344', outline:'none', width:220, background:'#fff', fontFamily:'inherit' }}
                  onFocus={e => e.target.style.borderColor='#0891b2'}
                  onBlur={e  => e.target.style.borderColor='#a5f3fc'}/>
              </div>

              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'120px minmax(0,2fr) 80px 105px 125px 82px', padding:'9px 16px', background:'#f0fdff', borderBottom:'1.5px solid #cffafe', gap:8 }}>
                {['Order ID','Domain','Status','Order Date','Cert Expiry','Alert'].map(h => (
                  <span key={h} style={{ fontSize:10, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'.07em', whiteSpace:'nowrap' }}>{h}</span>
                ))}
              </div>

              {filtered.length === 0 && (
                <div style={{ padding:'36px 0', textAlign:'center', fontSize:13, color:'#67c5d4' }}>No records match.</div>
              )}

              {paged.map((row, i) => <CertRow key={row.id||i} row={row} idx={i} total={paged.length} onSelect={setSelected}/>)}

              {/* Pagination */}
              {filtered.length > PER && (
                <div style={{ padding:'10px 16px', borderTop:'1.5px solid #f0fdff', display:'flex', alignItems:'center', justifyContent:'space-between', background:'linear-gradient(90deg,#f0fdff,#ecfeff)' }}>
                  <span style={{ fontSize:11.5, color:'#67c5d4' }}>Page {page} of {totalPages} · {filtered.length} total</span>
                  <div style={{ display:'flex', gap:4 }}>
                    <PBtn label="←" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}/>
                    {[...Array(Math.min(totalPages,7))].map((_,i) => (
                      <PBtn key={i} label={i+1} active={page===i+1} onClick={() => setPage(i+1)}/>
                    ))}
                    {totalPages > 7 && <span style={{ fontSize:12, color:'#67c5d4', lineHeight:'28px', padding:'0 4px' }}>…{totalPages}</span>}
                    <PBtn label="→" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}/>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal row={selected} onClose={() => setSelected(null)}/>}
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Table row ─────────────────────────────────────────────────────────────
function CertRow({ row, idx, total, onSelect }) {
  const [hov, setHov] = useState(false)
  const days     = daysUntil(row.cert_expiry)
  const isHot    = days !== null && days <= 30
  const isWarm   = days !== null && days > 30 && days <= 90
  const dc       = isHot ? '#dc2626' : isWarm ? '#b45309' : '#059669'
  const isActive = (row.order_status||'').toLowerCase() === 'active'

  const ACfg = {
    reissue: { bg:'#fef2f2', color:'#b91c1c', label:'Reissue', dot:'#dc2626' },
    renew:   { bg:'#fff7ed', color:'#92400e', label:'Renew',   dot:'#f59e0b' },
    none:    { bg:'#f0fdf4', color:'#166534', label:'OK',      dot:'#22c55e' },
  }[row.alert_type] || { bg:'#f0f9ff', color:'#0891b2', label:'—', dot:'#67c5d4' }

  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => onSelect(row)}
      style={{ display:'grid', gridTemplateColumns:'120px minmax(0,2fr) 80px 105px 125px 82px', padding:'10px 16px', borderBottom: idx<total-1?'1px solid #f0fdff':'none', alignItems:'center', background: hov?'#f0fdff':idx%2===0?'#fff':'#fafeff', cursor:'pointer', gap:8, transition:'background .08s' }}>

      <span style={{ fontFamily:'monospace', fontSize:11, color:'#0891b2', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.order_id||'—'}</span>

      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'#083344', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-.01em' }}>{row.domain_name||'—'}</div>
        {row.product_name && <div style={{ fontSize:10.5, color:'#67c5d4', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.product_name}</div>}
      </div>

      <div>
        <span style={{ fontSize:10.5, padding:'2px 8px', borderRadius:99, background:isActive?'#ecfdf5':'#f3f4f6', color:isActive?'#059669':'#6b7280', fontWeight:700 }}>
          {row.order_status||'—'}
        </span>
      </div>

      <span style={{ fontSize:11.5, color:'#9ca3af', whiteSpace:'nowrap' }}>{fmtD(row.order_date)}</span>

      <div>
        <div style={{ fontSize:12, color:dc, fontWeight:700, whiteSpace:'nowrap' }}>{fmtD(row.cert_expiry)}</div>
        {days !== null && (
          <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:2 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:dc, display:'inline-block', flexShrink:0 }}/>
            <span style={{ fontSize:10.5, color:dc, fontWeight:600 }}>{days > 0 ? `${days}d left` : 'Expired'}</span>
          </div>
        )}
      </div>

      <div>
        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 9px', borderRadius:99, background:ACfg.bg, color:ACfg.color, fontWeight:700 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:ACfg.dot, flexShrink:0 }}/>
          {ACfg.label}
        </span>
      </div>
    </div>
  )
}

// ── Detail modal ──────────────────────────────────────────────────────────
function DetailModal({ row, onClose }) {
  const days      = daysUntil(row.cert_expiry)
  const orderDays = daysUntil(row.order_expiry)
  const dc        = days===null?'#083344':days<30?'#dc2626':days<90?'#b45309':'#059669'

  const ACfg = {
    reissue: { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'⚠ Reissue Required', msg:'Certificate expires before order expiry — a reissue is needed.' },
    renew:   { bg:'#fffbeb', border:'#fde68a', color:'#d97706', label:'↻ Renewal Required',  msg:'Certificate and order expire on the same date — renewal is due.'  },
    none:    { bg:'#ecfdf5', border:'#86efac', color:'#059669', label:'✓ Active',             msg:null },
  }[row.alert_type] || {}

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(8,51,68,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:560, maxWidth:'95vw', overflow:'hidden', boxShadow:'0 24px 64px rgba(8,145,178,.25)' }}>

        <div style={{ padding:'18px 22px', background:ACfg.bg||'#f0fdff', borderBottom:`1px solid ${ACfg.border||'#cffafe'}`, display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:'#083344', marginBottom:4 }}>{row.domain_name}</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'monospace', fontSize:11.5, color:'#0891b2', fontWeight:600 }}>#{row.order_id||'—'}</span>
              {ACfg.label && <span style={{ fontSize:11, padding:'2px 9px', borderRadius:99, background:'#fff', color:ACfg.color, fontWeight:700, border:`1px solid ${ACfg.border}` }}>{ACfg.label}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ width:30, height:30, border:'1.5px solid #cffafe', borderRadius:8, background:'rgba(255,255,255,.8)', cursor:'pointer', fontSize:14, color:'#0891b2', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
        </div>

        {ACfg.msg && (
          <div style={{ padding:'10px 22px', background:'#fffbf0', borderBottom:'1px solid #fde68a' }}>
            <div style={{ fontSize:12.5, color:ACfg.color, lineHeight:1.6, fontWeight:500 }}>{ACfg.msg}</div>
          </div>
        )}

        <div style={{ padding:'4px 0', maxHeight:'60vh', overflowY:'auto' }}>
          {[
            { label:'Order ID',           value:row.order_id,           mono:true  },
            { label:'Domain Name',        value:row.domain_name,        mono:false },
            { label:'Order Status',       value:row.order_status,       mono:false },
            { label:'Order Date',         value:fmtD(row.order_date),   mono:false },
            { label:'Certificate Expiry', value:fmtD(row.cert_expiry),  mono:false, days, highlight:true },
            { label:'Order Expiry',       value:fmtD(row.order_expiry), mono:false, days:orderDays },
          ].map(({ label, value, mono, days:d, highlight }) => (
            <div key={label} style={{ display:'grid', gridTemplateColumns:'160px 1fr', padding:'10px 22px', borderBottom:'1px solid #f0fdff', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#67c5d4', fontWeight:600 }}>{label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:13, fontWeight:highlight?700:500, color:highlight?dc:'#083344', fontFamily:mono?'monospace':'inherit' }}>{value||'—'}</span>
                {d !== null && d !== undefined && (
                  <span style={{ fontSize:11, padding:'2px 7px', borderRadius:99, background:d<30?'#fef2f2':d<90?'#fffbeb':'#ecfdf5', color:d<30?'#dc2626':d<90?'#b45309':'#059669', fontWeight:700 }}>
                    {d > 0 ? `${d}d left` : 'Expired'}
                  </span>
                )}
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

// ── Pagination button ─────────────────────────────────────────────────────
function PBtn({ label, active, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ minWidth:28, height:28, borderRadius:6, border:`1.5px solid ${active?'#0891b2':'#cffafe'}`, background:active?'#0891b2':disabled?'#f0fdff':'#fff', color:active?'#fff':disabled?'#a5f3fc':'#0891b2', fontSize:12, fontWeight:600, cursor:disabled?'not-allowed':'pointer', padding:'0 5px', fontFamily:'inherit' }}>
      {label}
    </button>
  )
}
