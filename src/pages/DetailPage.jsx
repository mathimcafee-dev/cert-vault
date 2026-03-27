import { useState } from 'react'
import { fmtDateTime, copyToClipboard, downloadTextFile } from '../lib/utils.js'

export default function DetailPage({ csr, onDelete, onBack, push }) {
  const [tab, setTab]             = useState('details')
  const [showKey, setShowKey]     = useState(false)
  const [confirm, setConfirm]     = useState(false)
  const [deleting, setDeleting]   = useState(false)

  async function cp(text, label) {
    const ok = await copyToClipboard(text)
    push(ok ? `${label} copied!` : 'Copy failed — select and copy manually.', ok ? 'ok' : 'warn')
  }
  function dl(content, name) { downloadTextFile(name, content); push(`${name} downloaded.`) }
  function dlBoth() {
    downloadTextFile(`${csr.csr_number}.csr`, csr.csr_content || '')
    setTimeout(() => downloadTextFile(`${csr.csr_number}.key`, csr.private_key || ''), 400)
    push('Both files downloaded.')
  }
  async function handleDelete() {
    setDeleting(true); await onDelete(); setDeleting(false)
  }

  const TABS = [['details','CSR Details'],['csr','CSR Content'],['key','Private Key']]
  const fields = [
    ['CSR Number',       csr.csr_number,   true ],
    ['Common Name',      csr.domain,       false],
    ['Organization',     csr.organization||'—', false],
    ['Org Unit',         csr.org_unit||'—',     false],
    ['City',             csr.city||'—',         false],
    ['State',            csr.state||'—',        false],
    ['Country',          csr.country||'—',      false],
    ['Email',            csr.email||'—',        false],
    ['Key Algorithm',    csr.algorithm||'RSA',  false],
    ['Key Size',         `${csr.key_size}${csr.algorithm==='RSA'?'-bit':''}`, false],
    ['Signature Hash',   'SHA-256',         false],
    ['Status',           'Active',          false],
    ['Created On',       fmtDateTime(csr.created_at), false],
  ]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'14px 28px', background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', gap:14 }}>
        <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', border:'1px solid #e5e7eb', background:'#fff', borderRadius:7, fontSize:12, color:'#6b7280', cursor:'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Registry
        </button>
        <div style={{ width:1, height:22, background:'#e5e7eb' }} />
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:500, color:'#4f46e5' }}>{csr.csr_number}</span>
            <span style={{ color:'#d1d5db' }}>·</span>
            <span style={{ fontSize:14, fontWeight:500, color:'#111827' }}>{csr.domain}</span>
            <span style={{ fontSize:11, padding:'2px 9px', borderRadius:99, background:'#ecfdf5', color:'#065f46', fontWeight:600 }}>Active</span>
          </div>
          <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>Created {fmtDateTime(csr.created_at)}</div>
        </div>
        <div style={{ display:'flex', gap:7 }}>
          <Btn onClick={() => dl(csr.csr_content, `${csr.csr_number}.csr`)}>↓ CSR</Btn>
          <Btn onClick={() => dl(csr.private_key, `${csr.csr_number}.key`)}>↓ Key</Btn>
          <button onClick={dlBoth} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer' }}>↓ Download Both</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflow:'auto', padding:'20px 28px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:18, alignItems:'start' }}>

          {/* Main panel */}
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'flex', borderBottom:'1px solid #e5e7eb' }}>
              {TABS.map(([id,label]) => (
                <button key={id} onClick={() => setTab(id)} style={{ padding:'12px 20px', border:'none', background:'transparent', fontSize:13, fontWeight:tab===id?600:400, color:tab===id?'#4f46e5':'#6b7280', borderBottom:`2px solid ${tab===id?'#4f46e5':'transparent'}`, cursor:'pointer' }}>{label}</button>
              ))}
            </div>

            {tab === 'details' && (
              <div>
                {fields.map(([label, value, mono]) => (
                  <div key={label} style={{ display:'grid', gridTemplateColumns:'175px 1fr', padding:'11px 20px', borderBottom:'1px solid #f9fafb', alignItems:'center' }}>
                    <span style={{ fontSize:12, color:'#6b7280' }}>{label}</span>
                    <span style={{ fontSize:13, fontWeight:500, color:mono?'#4f46e5':label==='Status'?'#065f46':'#111827', fontFamily:mono?'var(--font-mono)':'inherit' }}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'csr' && (
              <div style={{ padding:'18px 20px' }}>
                <div style={{ display:'flex', justifyContent:'flex-end', gap:7, marginBottom:12 }}>
                  <Btn onClick={() => cp(csr.csr_content||'','CSR')}>Copy</Btn>
                  <PBtn onClick={() => dl(csr.csr_content, `${csr.csr_number}.csr`)}>Download .csr</PBtn>
                </div>
                <Code content={csr.csr_content || 'CSR content not available.'} />
              </div>
            )}

            {tab === 'key' && (
              <div style={{ padding:'18px 20px' }}>
                <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:9, padding:'12px 14px', marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'#92400e', marginBottom:3 }}>⚠ Private Key — Handle with Care</div>
                  <div style={{ fontSize:11.5, color:'#92400e', lineHeight:1.65 }}>Never share this key. Store it in a secure password manager or HSM.</div>
                </div>
                <div style={{ display:'flex', justifyContent:'flex-end', gap:7, marginBottom:12 }}>
                  <Btn onClick={() => setShowKey(p => !p)}>{showKey ? 'Hide Key' : 'Reveal Key'}</Btn>
                  {showKey && <Btn onClick={() => cp(csr.private_key||'','Private key')}>Copy</Btn>}
                  <PBtn onClick={() => dl(csr.private_key, `${csr.csr_number}.key`)}>Download .key</PBtn>
                </div>
                {showKey
                  ? <Code content={csr.private_key || 'Private key not available.'} />
                  : <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:10, padding:'40px 20px', textAlign:'center' }}>
                      <div style={{ fontSize:32, marginBottom:10 }}>🔒</div>
                      <div style={{ fontSize:13.5, fontWeight:500, color:'#374151' }}>Private key is hidden</div>
                      <div style={{ fontSize:12, color:'#9ca3af', marginTop:5 }}>Click "Reveal Key" to display temporarily</div>
                    </div>
                }
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <Panel title="Quick Actions">
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {[
                  ['Copy CSR to clipboard',  () => cp(csr.csr_content||'','CSR')],
                  ['Copy private key',        () => cp(csr.private_key||'','Private key')],
                  ['Download .csr file',      () => dl(csr.csr_content, `${csr.csr_number}.csr`)],
                  ['Download .key file',      () => dl(csr.private_key, `${csr.csr_number}.key`)],
                  ['Download both files',     dlBoth],
                ].map(([label, action]) => (
                  <button key={label} onClick={action} style={{ width:'100%', padding:'9px 12px', border:'1px solid #e5e7eb', background:'#fff', borderRadius:8, fontSize:12.5, color:'#374151', textAlign:'left', fontWeight:500, cursor:'pointer' }}>{label}</button>
                ))}
                <div style={{ height:1, background:'#f3f4f6', margin:'4px 0' }} />
                {!confirm
                  ? <button onClick={() => setConfirm(true)} style={{ width:'100%', padding:'9px 12px', border:'1px solid #fca5a5', background:'#fef2f2', borderRadius:8, fontSize:12.5, color:'#dc2626', textAlign:'left', fontWeight:500, cursor:'pointer' }}>Delete this CSR</button>
                  : <div style={{ border:'1px solid #fca5a5', borderRadius:8, padding:'10px 12px', background:'#fef2f2' }}>
                      <div style={{ fontSize:12, color:'#dc2626', fontWeight:600, marginBottom:8 }}>Permanently delete?</div>
                      <div style={{ display:'flex', gap:7 }}>
                        <button onClick={handleDelete} disabled={deleting} style={{ flex:1, padding:'7px', background:'#dc2626', color:'#fff', border:'none', borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer', opacity:deleting?0.7:1 }}>{deleting?'Deleting…':'Delete'}</button>
                        <button onClick={() => setConfirm(false)} style={{ flex:1, padding:'7px', background:'#fff', color:'#374151', border:'1px solid #e5e7eb', borderRadius:7, fontSize:12.5, cursor:'pointer' }}>Cancel</button>
                      </div>
                    </div>
                }
              </div>
            </Panel>

            <Panel title="Certificate Summary">
              {[
                ['Domain',    csr.domain],
                ['Algorithm', `${csr.algorithm||'RSA'} ${csr.key_size}${csr.algorithm==='RSA'?'-bit':''}`],
                ['Hash',      'SHA-256'],
                ['Created',   fmtDateTime(csr.created_at)],
                ['Reference', csr.csr_number],
              ].map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #f9fafb', fontSize:12 }}>
                  <span style={{ color:'#6b7280' }}>{k}</span>
                  <span style={{ color:'#111827', fontWeight:500, textAlign:'right', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:k==='Reference'?'var(--font-mono)':'inherit' }}>{v}</span>
                </div>
              ))}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'16px 18px' }}>
      <div style={{ fontSize:10.5, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>{title}</div>
      {children}
    </div>
  )
}
function Code({ content }) {
  return <pre style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:10, padding:'14px 16px', fontFamily:'var(--font-mono)', fontSize:11.5, color:'#1e293b', lineHeight:1.7, overflowX:'auto', whiteSpace:'pre-wrap', wordBreak:'break-all', maxHeight:400, overflowY:'auto' }}>{content}</pre>
}
function Btn({ onClick, children }) {
  return <button onClick={onClick} style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 13px', border:'1px solid #e5e7eb', background:'#fff', borderRadius:8, fontSize:12.5, fontWeight:500, color:'#374151', cursor:'pointer' }}>{children}</button>
}
function PBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ padding:'7px 13px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer' }}>{children}</button>
}
