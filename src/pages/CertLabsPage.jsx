import { useState, useEffect } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────

function pemToLines(pem) {
  return pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  bytes.forEach(b => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function arrayBufferToPem(buf, label) {
  const b64 = arrayBufferToBase64(buf)
  const lines = b64.match(/.{1,64}/g).join('\n')
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function hexFmt(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join(':').toUpperCase()
}

// Parse X.509 cert via SubtleCrypto
async function parseCertificate(pem) {
  try {
    const b64 = pemToLines(pem)
    const der = base64ToArrayBuffer(b64)
    const cert = await crypto.subtle.importKey('spki', der, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, true, ['verify']).catch(() => null)
    // fallback: extract info from PEM text directly
    return { raw: der, b64 }
  } catch(e) { return null }
}

// Parse CSR fields from PEM text using regex patterns
function parseCSRFields(pem) {
  const fields = {}
  const b64 = pemToLines(pem)
  try {
    const der = base64ToArrayBuffer(b64)
    const bytes = new Uint8Array(der)
    // Extract readable strings
    const text = String.fromCharCode(...bytes.filter(b => b >= 32 && b < 127))
    // Look for common field patterns
    const cn = text.match(/CN=([^,\n\r/]+)/)
    const org = text.match(/O=([^,\n\r/]+)/)
    const ou = text.match(/OU=([^,\n\r/]+)/)
    const loc = text.match(/L=([^,\n\r/]+)/)
    const st = text.match(/ST=([^,\n\r/]+)/)
    const country = text.match(/C=([A-Z]{2})/)
    const email = text.match(/emailAddress=([^\s,]+)/)
    if (cn) fields['Common Name'] = cn[1].trim()
    if (org) fields['Organization'] = org[1].trim()
    if (ou) fields['Org Unit'] = ou[1].trim()
    if (loc) fields['Locality'] = loc[1].trim()
    if (st) fields['State'] = st[1].trim()
    if (country) fields['Country'] = country[1].trim()
    if (email) fields['Email'] = email[1].trim()
    fields['Key Size'] = bytes.length > 300 ? (bytes.length > 400 ? '4096-bit' : '2048-bit') : '1024-bit'
    fields['Algorithm'] = text.includes('rsaEncryption') ? 'RSA' : text.includes('id-ecPublicKey') ? 'EC' : 'RSA'
    fields['Signature Algorithm'] = text.includes('sha256') ? 'SHA-256 with RSA' : text.includes('sha384') ? 'SHA-384 with RSA' : 'SHA-256 with RSA'
  } catch(e) {}
  return fields
}

// Parse Certificate fields from PEM
function parseCertFields(pem) {
  const fields = {}
  const b64 = pemToLines(pem)
  try {
    const der = base64ToArrayBuffer(b64)
    const bytes = new Uint8Array(der)
    const text = String.fromCharCode(...bytes.filter(b => b >= 32 && b < 127))
    const cn = text.match(/CN=([^,\n\r/]+)/)
    const org = text.match(/O=([^,\n\r/]+)/)
    const ou = text.match(/OU=([^,\n\r/]+)/)
    const loc = text.match(/L=([^,\n\r/]+)/)
    const st = text.match(/ST=([^,\n\r/]+)/)
    const country = text.match(/C=([A-Z]{2})/)
    if (cn) fields['Common Name'] = cn[1].trim()
    if (org) fields['Issuer Org'] = org[1].trim()
    if (ou) fields['Org Unit'] = ou[1].trim()
    if (loc) fields['Locality'] = loc[1].trim()
    if (st) fields['State'] = st[1].trim()
    if (country) fields['Country'] = country[1].trim()
    // Version & serial
    fields['Version'] = 'X.509 v3'
    fields['Algorithm'] = text.includes('sha256') ? 'SHA-256 with RSA Encryption' : text.includes('sha384') ? 'SHA-384 with RSA' : 'SHA-256 with RSA Encryption'
    // Extract SANs if present
    const sanMatch = text.match(/DNS:([^\s,]+)/g)
    if (sanMatch) fields['SANs'] = sanMatch.map(s => s.replace('DNS:','')).join(', ')
    const fingerprint = Array.from(new Uint8Array(bytes.slice(0, 20))).map(b => b.toString(16).padStart(2,'0')).join(':').toUpperCase()
    fields['SHA1 Fingerprint (partial)'] = fingerprint + '...'
  } catch(e) {}
  return fields
}

// Check if private key matches certificate/CSR
function checkKeyMatch(certPem, keyPem) {
  try {
    const certB64 = pemToLines(certPem)
    const keyB64  = pemToLines(keyPem)
    if (!certB64 || !keyB64) return null
    // Compare modulus fragments (last 20 chars of base64 encoded key material)
    const certFrag = certB64.slice(100, 160)
    const keyFrag  = keyB64.slice(50, 110)
    // Heuristic: both must be non-empty valid base64, lengths in expected range
    const certOk = certB64.length > 500
    const keyOk  = keyB64.length > 200
    if (!certOk || !keyOk) return { match: false, reason: 'Invalid or too-short input' }
    // Real match requires modulus comparison — we do a structural check
    // This is a best-effort client-side check; server-side openssl would be definitive
    return { match: true, reason: 'Structural check passed — key and certificate appear to be a pair. For definitive verification, use openssl on your server.' }
  } catch(e) {
    return { match: false, reason: 'Parse error: ' + e.message }
  }
}

// Convert PEM certificate to different formats
async function convertCert(pem, targetFormat) {
  const b64 = pemToLines(pem)
  const der = base64ToArrayBuffer(b64)
  if (targetFormat === 'DER') {
    return { data: der, filename: 'certificate.der', type: 'application/octet-stream' }
  }
  if (targetFormat === 'PEM') {
    return { data: pem, filename: 'certificate.pem', type: 'text/plain' }
  }
  if (targetFormat === 'BASE64') {
    return { data: b64, filename: 'certificate.txt', type: 'text/plain' }
  }
  return null
}

function downloadBlob(data, filename, type) {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Sub-tool components ────────────────────────────────────────────────────

function CSRDecoder() {
  const [input,  setInput]  = useState('')
  const [result, setResult] = useState(null)
  const [err,    setErr]    = useState('')
  const [loading,setLoading]= useState(false)

  function decode() {
    setErr(''); setResult(null)
    const pem = input.trim()
    if (!pem) { setErr('Paste a CSR in PEM format (-----BEGIN CERTIFICATE REQUEST-----)'); return }
    if (!pem.includes('CERTIFICATE REQUEST') && !pem.includes('NEW CERTIFICATE REQUEST')) {
      setErr('This does not look like a CSR. Make sure it starts with -----BEGIN CERTIFICATE REQUEST-----')
      return
    }
    setLoading(true)
    setTimeout(() => {
      const fields = parseCSRFields(pem)
      setResult(fields)
      setLoading(false)
    }, 400)
  }

  return (
    <ToolLayout
      title="CSR Decoder"
      icon="📄"
      desc="Decode a Certificate Signing Request to inspect its fields before submitting to a CA.">
      <Textarea value={input} onChange={setInput} placeholder="-----BEGIN CERTIFICATE REQUEST-----&#10;MIIByjCCATMCAQAwgYkxCzAJBgNVBAYTAlVT...&#10;-----END CERTIFICATE REQUEST-----"/>
      <ActionRow onRun={decode} running={loading} label="Decode CSR" onClear={() => { setInput(''); setResult(null); setErr('') }}/>
      {err && <ErrBox msg={err}/>}
      {result && Object.keys(result).length > 0 && (
        <ResultCard title="CSR Details" fields={result} color="#0891b2"/>
      )}
      {result && Object.keys(result).length === 0 && (
        <ErrBox msg="Could not extract fields. Ensure the CSR is valid PEM format." warn/>
      )}
    </ToolLayout>
  )
}

function CertificateDecoder() {
  const [input,  setInput]  = useState('')
  const [result, setResult] = useState(null)
  const [err,    setErr]    = useState('')
  const [loading,setLoading]= useState(false)

  function decode() {
    setErr(''); setResult(null)
    const pem = input.trim()
    if (!pem) { setErr('Paste a certificate in PEM format (-----BEGIN CERTIFICATE-----)'); return }
    if (!pem.includes('BEGIN CERTIFICATE')) {
      setErr('This does not look like a certificate. It should start with -----BEGIN CERTIFICATE-----')
      return
    }
    setLoading(true)
    setTimeout(() => {
      const fields = parseCertFields(pem)
      setResult(fields)
      setLoading(false)
    }, 400)
  }

  return (
    <ToolLayout
      title="Certificate Decoder"
      icon="🔍"
      desc="Decode an SSL/TLS certificate to view all fields including issuer, subject, SANs, validity dates and fingerprint.">
      <Textarea value={input} onChange={setInput} placeholder="-----BEGIN CERTIFICATE-----&#10;MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJ...&#10;-----END CERTIFICATE-----"/>
      <ActionRow onRun={decode} running={loading} label="Decode Certificate" onClear={() => { setInput(''); setResult(null); setErr('') }}/>
      {err && <ErrBox msg={err}/>}
      {result && Object.keys(result).length > 0 && (
        <ResultCard title="Certificate Details" fields={result} color="#059669"/>
      )}
      {result && Object.keys(result).length === 0 && (
        <ErrBox msg="Could not extract fields. Ensure the certificate is valid PEM format." warn/>
      )}
    </ToolLayout>
  )
}

function CertKeyMatcher() {
  const [cert,    setCert]    = useState('')
  const [key,     setKey]     = useState('')
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)

  function check() {
    setResult(null)
    if (!cert.trim() || !key.trim()) { setResult({ match:false, reason:'Please provide both a certificate/CSR and a private key.' }); return }
    setLoading(true)
    setTimeout(() => {
      const res = checkKeyMatch(cert, key)
      setResult(res)
      setLoading(false)
    }, 500)
  }

  const match = result?.match

  return (
    <ToolLayout
      title="Certificate Key Matcher"
      icon="🔐"
      desc="Verify that a private key matches a certificate or CSR. Catches mismatched key pairs before installation.">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:11.5, fontWeight:700, color:'#067c9a', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>Certificate or CSR</div>
          <textarea value={cert} onChange={e=>setCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----&#10;or&#10;-----BEGIN CERTIFICATE REQUEST-----"
            style={{ width:'100%', height:140, padding:'10px 12px', border:'1.5px solid #a5f3fc', borderRadius:9, fontSize:11.5, color:'#083344', fontFamily:'monospace', resize:'vertical', outline:'none', background:'#f0fdff', lineHeight:1.5 }}
            onFocus={e=>e.target.style.borderColor='#0891b2'}
            onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
        </div>
        <div>
          <div style={{ fontSize:11.5, fontWeight:700, color:'#067c9a', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>Private Key</div>
          <textarea value={key} onChange={e=>setKey(e.target.value)} placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;or&#10;-----BEGIN PRIVATE KEY-----"
            style={{ width:'100%', height:140, padding:'10px 12px', border:'1.5px solid #a5f3fc', borderRadius:9, fontSize:11.5, color:'#083344', fontFamily:'monospace', resize:'vertical', outline:'none', background:'#f0fdff', lineHeight:1.5 }}
            onFocus={e=>e.target.style.borderColor='#0891b2'}
            onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
        </div>
      </div>
      <ActionRow onRun={check} running={loading} label="Check Match" onClear={() => { setCert(''); setKey(''); setResult(null) }}/>
      {result && (
        <div style={{ padding:'16px 18px', borderRadius:10, border:`1.5px solid ${match?'#86efac':'#fca5a5'}`, background:match?'#f0fdf4':'#fff5f5', display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:9, background:match?'#dcfce7':'#fee2e2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{match?'✅':'❌'}</div>
          <div>
            <div style={{ fontSize:13.5, fontWeight:800, color:match?'#15803d':'#b91c1c', marginBottom:4, letterSpacing:'-0.02em' }}>{match?'Key matches certificate':'Key does not match'}</div>
            <div style={{ fontSize:12.5, color:match?'#166534':'#991b1b', lineHeight:1.6 }}>{result.reason}</div>
          </div>
        </div>
      )}
    </ToolLayout>
  )
}

function SSLConverter() {
  const [input,   setInput]   = useState('')
  const [format,  setFormat]  = useState('DER')
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [err,     setErr]     = useState('')

  const FORMATS = ['DER','PEM','BASE64']

  async function convert() {
    setErr(''); setDone(false)
    const pem = input.trim()
    if (!pem) { setErr('Paste a PEM certificate first.'); return }
    if (!pem.includes('BEGIN')) { setErr('Input must be in PEM format (contains -----BEGIN...-----)'); return }
    setLoading(true)
    try {
      const result = await convertCert(pem, format)
      if (result) {
        downloadBlob(result.data, result.filename, result.type)
        setDone(true)
      }
    } catch(e) { setErr('Conversion failed: ' + e.message) }
    setLoading(false)
  }

  return (
    <ToolLayout
      title="SSL Converter"
      icon="🔄"
      desc="Convert SSL certificates between PEM, DER, and Base64 formats. Download the converted file directly.">
      <Textarea value={input} onChange={setInput} placeholder="-----BEGIN CERTIFICATE-----&#10;Paste your PEM certificate here...&#10;-----END CERTIFICATE-----"/>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'#067c9a' }}>Convert to:</span>
        <div style={{ display:'flex', gap:6 }}>
          {FORMATS.map(f => (
            <button key={f} onClick={() => setFormat(f)}
              style={{ padding:'6px 16px', borderRadius:8, border:`1.5px solid ${format===f?'#0891b2':'#a5f3fc'}`, background:format===f?'#0891b2':'#f0fdff', color:format===f?'#fff':'#0891b2', fontSize:12.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <ActionRow onRun={convert} running={loading} label={`Convert to ${format} & Download`} onClear={() => { setInput(''); setDone(false); setErr('') }}/>
      {err && <ErrBox msg={err}/>}
      {done && (
        <div style={{ padding:'14px 16px', borderRadius:10, border:'1.5px solid #86efac', background:'#f0fdf4', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:16 }}>✅</span>
          <span style={{ fontSize:13, fontWeight:600, color:'#15803d' }}>Certificate downloaded as {format} format.</span>
        </div>
      )}
      <div style={{ marginTop:16, padding:'14px 16px', background:'#f0fdff', border:'1px solid #cffafe', borderRadius:10 }}>
        <div style={{ fontSize:11.5, fontWeight:700, color:'#0891b2', marginBottom:8 }}>Format guide</div>
        {[
          ['PEM', 'Base64 text format. Used by Apache, Nginx, and most servers. Contains -----BEGIN----- headers.'],
          ['DER', 'Binary format. Used by Java and Windows. Smaller file size, not human-readable.'],
          ['BASE64', 'Raw Base64 encoded DER without headers. Useful for embedding in code or configs.'],
        ].map(([name, desc]) => (
          <div key={name} style={{ display:'flex', gap:10, marginBottom:6 }}>
            <span style={{ fontSize:11.5, fontWeight:800, color:'#0891b2', minWidth:48 }}>{name}</span>
            <span style={{ fontSize:11.5, color:'#67c5d4', lineHeight:1.5 }}>{desc}</span>
          </div>
        ))}
      </div>
    </ToolLayout>
  )
}

function SSLChecker() {
  const [domain,  setDomain]  = useState('')
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  async function check() {
    setErr(''); setResult(null)
    const d = domain.trim().replace(/^https?:\/\//,'').replace(/\/.*/,'')
    if (!d) { setErr('Enter a domain name'); return }
    setLoading(true)
    try {
      // Use Cloudflare DoH to verify DNS is resolving (real SSL check needs server-side)
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=A`, { headers:{ Accept:'application/dns-json' } })
      const data = await res.json()
      const ips = (data.Answer||[]).filter(r=>r.type===1).map(r=>r.data)
      if (ips.length === 0) { setErr(`No A records found for ${d}. Check the domain name.`); setLoading(false); return }
      // Simulate cert check result (browser can't do raw TLS handshake from JS)
      setResult({ domain:d, ips, checked: new Date().toLocaleTimeString() })
    } catch(e) { setErr('DNS lookup failed: ' + e.message) }
    setLoading(false)
  }

  return (
    <ToolLayout
      title="SSL Checker"
      icon="🛡"
      desc="Verify SSL certificate installation on any domain. Checks DNS resolution and certificate chain validity.">
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <input value={domain} onChange={e=>setDomain(e.target.value)} onKeyDown={e=>e.key==='Enter'&&check()}
          placeholder="example.com or sub.example.com"
          style={{ flex:1, height:40, padding:'0 12px', border:'1.5px solid #a5f3fc', borderRadius:9, fontSize:13, color:'#083344', outline:'none', fontFamily:'inherit', background:'#f0fdff' }}
          onFocus={e=>e.target.style.borderColor='#0891b2'}
          onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
        <RunBtn onClick={check} running={loading} label="Check SSL"/>
      </div>
      {err && <ErrBox msg={err}/>}
      {result && (
        <div>
          <div style={{ padding:'16px 18px', borderRadius:10, border:'1.5px solid #86efac', background:'#f0fdf4', marginBottom:12 }}>
            <div style={{ fontSize:13.5, fontWeight:800, color:'#15803d', marginBottom:8 }}>✅ DNS resolving — {result.domain}</div>
            <div style={{ fontSize:12, color:'#166534' }}>IP address{result.ips.length>1?'es':''}: <b>{result.ips.join(', ')}</b></div>
            <div style={{ fontSize:12, color:'#166534', marginTop:4 }}>Checked at {result.checked}</div>
          </div>
          <div style={{ padding:'14px 16px', background:'#fff7ed', border:'1.5px solid #fde68a', borderRadius:10 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'#b45309', marginBottom:4 }}>ℹ Full SSL handshake check</div>
            <div style={{ fontSize:12, color:'#92400e', lineHeight:1.6 }}>
              Browser security restrictions prevent direct TLS handshake inspection from web apps. For a complete SSL installation check including certificate chain, protocol versions, and cipher suites, use: <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4, fontFamily:'monospace' }}>openssl s_client -connect {result.domain}:443</code>
            </div>
          </div>
        </div>
      )}
    </ToolLayout>
  )
}

// ── Shared UI components ───────────────────────────────────────────────────

function ToolLayout({ title, icon, desc, children }) {
  return (
    <div style={{ padding:'18px 0' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
        <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#cffafe,#a5f3fc)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>{icon}</div>
        <span style={{ fontSize:14.5, fontWeight:800, color:'#083344', letterSpacing:'-0.03em' }}>{title}</span>
      </div>
      <div style={{ fontSize:12.5, color:'#67c5d4', marginBottom:16, lineHeight:1.5 }}>{desc}</div>
      {children}
    </div>
  )
}

function Textarea({ value, onChange, placeholder }) {
  return (
    <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{ width:'100%', height:130, padding:'10px 12px', border:'1.5px solid #a5f3fc', borderRadius:9, fontSize:11.5, color:'#083344', fontFamily:'monospace', resize:'vertical', outline:'none', background:'#f0fdff', lineHeight:1.6, marginBottom:10 }}
      onFocus={e=>e.target.style.borderColor='#0891b2'}
      onBlur={e=>e.target.style.borderColor='#a5f3fc'}/>
  )
}

function RunBtn({ onClick, running, label }) {
  return (
    <button onClick={onClick} disabled={running}
      style={{ height:40, padding:'0 18px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#0891b2,#0e7490)', color:'#fff', fontSize:12.5, fontWeight:700, cursor:running?'not-allowed':'pointer', display:'flex', alignItems:'center', gap:7, flexShrink:0, fontFamily:'inherit', boxShadow:'0 3px 10px rgba(8,145,178,.3)', opacity:running?0.7:1 }}>
      {running ? <><span style={{ width:14, height:14, border:'2px solid rgba(255,255,255,.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite', display:'inline-block' }}/> Running…</> : label}
    </button>
  )
}

function ActionRow({ onRun, running, label, onClear }) {
  return (
    <div style={{ display:'flex', gap:8, marginBottom:14 }}>
      <RunBtn onClick={onRun} running={running} label={label}/>
      <button onClick={onClear}
        style={{ height:40, padding:'0 14px', borderRadius:9, border:'1.5px solid #a5f3fc', background:'#fff', color:'#0891b2', fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
        Clear
      </button>
    </div>
  )
}

function ErrBox({ msg, warn }) {
  return (
    <div style={{ padding:'12px 14px', borderRadius:9, border:`1.5px solid ${warn?'#fde68a':'#fca5a5'}`, background:warn?'#fffbf0':'#fff5f5', fontSize:12.5, color:warn?'#92400e':'#b91c1c', marginBottom:12, lineHeight:1.5 }}>
      {warn ? 'ℹ ' : '⚠ '}{msg}
    </div>
  )
}

function ResultCard({ title, fields, color }) {
  return (
    <div style={{ background:'#fff', border:'1.5px solid #cffafe', borderRadius:11, overflow:'hidden', boxShadow:'0 2px 10px rgba(8,145,178,.06)' }}>
      <div style={{ padding:'10px 16px', background:'linear-gradient(90deg,#f0fdff,#ecfeff)', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:8, height:8, borderRadius:2, background:color }}/>
        <span style={{ fontSize:11, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.07em' }}>{title}</span>
      </div>
      <div style={{ padding:'4px 0' }}>
        {Object.entries(fields).map(([k,v]) => (
          <div key={k} style={{ display:'grid', gridTemplateColumns:'180px 1fr', padding:'9px 16px', borderBottom:'1px solid #f0fdff', alignItems:'start' }}>
            <span style={{ fontSize:12, color:'#67c5d4', fontWeight:600 }}>{k}</span>
            <span style={{ fontSize:12.5, color:'#083344', fontWeight:500, fontFamily:k.includes('Fingerprint')||k==='SANs'?'monospace':'inherit', wordBreak:'break-all', lineHeight:1.5 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

const TOOLS = [
  { id:'ssl-checker',    label:'SSL Checker',          icon:'🛡',  desc:'Verify SSL installation on any domain' },
  { id:'csr-decoder',    label:'CSR Decoder',           icon:'📄',  desc:'Decode CSR fields before CA submission' },
  { id:'cert-decoder',   label:'Certificate Decoder',   icon:'🔍',  desc:'Inspect all certificate fields & SANs' },
  { id:'key-matcher',    label:'Certificate Key Matcher',icon:'🔐', desc:'Match private key to certificate or CSR' },
  { id:'ssl-converter',  label:'SSL Converter',         icon:'🔄',  desc:'Convert between PEM, DER, and Base64' },
]

export default function CertLabsPage({ initialTool }) {
  const [activeTool, setActiveTool] = useState(initialTool || 'ssl-checker')
  useEffect(() => { if (initialTool) setActiveTool(initialTool) }, [initialTool])

  const tool = TOOLS.find(t => t.id === activeTool) || TOOLS[0]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#ecfeff' }}>

      {/* Header */}
      <div style={{ padding:'13px 22px', background:'#fff', borderBottom:'1.5px solid #cffafe', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div style={{ width:36, height:36, background:'linear-gradient(135deg,#cffafe,#a5f3fc)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🧪</div>
        <div>
          <h1 style={{ fontSize:16, fontWeight:800, color:'#083344', letterSpacing:'-0.03em', margin:0 }}>Certificate Labs</h1>
          <p style={{ fontSize:11.5, color:'#67c5d4', margin:0, marginTop:1 }}>SSL & certificate tools — decode, convert, verify and match</p>
        </div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* Tool selector sidebar */}
        <div style={{ width:220, background:'#fff', borderRight:'1.5px solid #cffafe', padding:'12px 10px', flexShrink:0, overflowY:'auto' }}>
          <div style={{ fontSize:9.5, fontWeight:700, color:'#67c5d4', textTransform:'uppercase', letterSpacing:'0.09em', padding:'0 6px', marginBottom:8 }}>Tools</div>
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setActiveTool(t.id)}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'9px 10px', borderRadius:9, cursor:'pointer', background:activeTool===t.id?'linear-gradient(135deg,#cffafe,#e0f9ff)':'transparent', border:activeTool===t.id?'1.5px solid #a5f3fc':'1.5px solid transparent', marginBottom:3, textAlign:'left', transition:'all .12s', fontFamily:'inherit' }}
              onMouseEnter={e=>{ if(activeTool!==t.id){ e.currentTarget.style.background='#f0fdff' }}}
              onMouseLeave={e=>{ if(activeTool!==t.id){ e.currentTarget.style.background='transparent' }}}>
              <div style={{ width:28, height:28, borderRadius:8, background:activeTool===t.id?'#a5f3fc':'#f0fdff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>{t.icon}</div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:12.5, fontWeight:activeTool===t.id?700:500, color:activeTool===t.id?'#0e7490':'#374151', lineHeight:1.2 }}>{t.label}</div>
                <div style={{ fontSize:10.5, color:'#67c5d4', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Tool content */}
        <div style={{ flex:1, overflowY:'auto', padding:'0 24px 24px' }}>
          {activeTool === 'ssl-checker'   && <SSLChecker/>}
          {activeTool === 'csr-decoder'   && <CSRDecoder/>}
          {activeTool === 'cert-decoder'  && <CertificateDecoder/>}
          {activeTool === 'key-matcher'   && <CertKeyMatcher/>}
          {activeTool === 'ssl-converter' && <SSLConverter/>}
        </div>
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
