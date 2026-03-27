import { useState } from 'react'
import { generateCsrAndKey } from '../lib/anthropic.js'
import { nextCsrNumber } from '../lib/utils.js'

export default function GeneratePage({ csrs, onSave, push }) {
  const [form, setForm] = useState({ domain:'', organization:'', orgUnit:'', city:'', state:'', country:'US', email:'', algorithm:'RSA', keySize:'2048' })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const f = k => e => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: '' })) }
  const nextNum = nextCsrNumber(csrs)
  const keySizes = form.algorithm === 'RSA' ? ['2048','4096'] : ['P-256','P-384']

  function validate() {
    const e = {}
    if (!form.domain.trim())       e.domain = 'Domain is required.'
    if (!form.organization.trim()) e.organization = 'Organization is required.'
    return e
  }

  async function handleGenerate(ev) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setLoading(true)
    try {
      const { csr: csrContent, privateKey } = await generateCsrAndKey({
        domain: form.domain.trim(), organization: form.organization.trim(),
        orgUnit: form.orgUnit.trim(), city: form.city.trim(), state: form.state.trim(),
        country: form.country.toUpperCase(), email: form.email.trim(),
        algorithm: form.algorithm, keySize: form.keySize,
      })
      if (!csrContent) throw new Error('Empty CSR returned.')
      await onSave({
        csr_number: nextNum, domain: form.domain.trim(), organization: form.organization.trim(),
        org_unit: form.orgUnit.trim(), city: form.city.trim(), state: form.state.trim(),
        country: form.country.toUpperCase(), email: form.email.trim(),
        algorithm: form.algorithm, key_size: form.keySize,
        csr_content: csrContent, private_key: privateKey, status: 'active',
      })
    } catch (err) {
      push(err.message || 'Generation failed. Try again.', 'error')
    } finally { setLoading(false) }
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 52, height: 52, border: '3px solid #e5e7eb', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ fontSize: 15, fontWeight: 500, color: '#374151' }}>Generating your CSR…</div>
      <div style={{ fontSize: 12.5, color: '#9ca3af' }}>Creating {form.algorithm} key pair and signing request</div>
    </div>
  )

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '18px 28px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Generate New CSR</h1>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Fill in the details. A matching private key will be generated and saved automatically.</p>
      </div>

      <form onSubmit={handleGenerate}>
        <div style={{ padding: '24px 28px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, maxWidth: 1060 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <Sect title="Domain Information">
              <FField label="Common Name (Domain) *" error={errors.domain} hint="Use *.domain.com for wildcard">
                <Inp value={form.domain} onChange={f('domain')} placeholder="api.example.com" hasError={!!errors.domain} />
              </FField>
            </Sect>

            <Sect title="Organization Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <FField label="Organization Name *" error={errors.organization}>
                  <Inp value={form.organization} onChange={f('organization')} placeholder="Example Corp Ltd" hasError={!!errors.organization} />
                </FField>
                <FField label="Organizational Unit">
                  <Inp value={form.orgUnit} onChange={f('orgUnit')} placeholder="IT Department" />
                </FField>
                <FField label="City / Locality">
                  <Inp value={form.city} onChange={f('city')} placeholder="San Francisco" />
                </FField>
                <FField label="State / Province">
                  <Inp value={form.state} onChange={f('state')} placeholder="California" />
                </FField>
                <FField label="Country Code">
                  <select value={form.country} onChange={f('country')} style={{ width:'100%', padding:'8px 11px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, color:'#111827', outline:'none', background:'#fff' }}>
                    {[['US','United States'],['GB','United Kingdom'],['IN','India'],['CA','Canada'],['AU','Australia'],['DE','Germany'],['SG','Singapore'],['AE','UAE'],['FR','France']].map(([c,n]) => <option key={c} value={c}>{c} – {n}</option>)}
                  </select>
                </FField>
                <FField label="Email Address">
                  <Inp type="email" value={form.email} onChange={f('email')} placeholder="admin@example.com" />
                </FField>
              </div>
            </Sect>

            <Sect title="Key Configuration">
              <div style={{ marginBottom: 16 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:500, color:'#374151', marginBottom:8 }}>Key Algorithm</label>
                <div style={{ display:'flex', gap:10 }}>
                  {['RSA','ECDSA'].map(alg => (
                    <button key={alg} type="button" onClick={() => setForm(p => ({ ...p, algorithm:alg, keySize:alg==='RSA'?'2048':'P-256' }))} style={{ flex:1, padding:'10px 14px', border:`1.5px solid ${form.algorithm===alg?'#4f46e5':'#e5e7eb'}`, borderRadius:9, background:form.algorithm===alg?'#ede9fe':'#fff', cursor:'pointer', textAlign:'left' }}>
                      <div style={{ fontSize:13, fontWeight:600, color:form.algorithm===alg?'#4f46e5':'#374151' }}>{alg}</div>
                      <div style={{ fontSize:11, color:form.algorithm===alg?'#7c3aed':'#9ca3af', marginTop:2 }}>{alg==='RSA'?'Most compatible':'Smaller & modern'}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display:'block', fontSize:12, fontWeight:500, color:'#374151', marginBottom:8 }}>Key Size</label>
                <div style={{ display:'flex', gap:10 }}>
                  {keySizes.map(sz => (
                    <button key={sz} type="button" onClick={() => setForm(p => ({ ...p, keySize:sz }))} style={{ flex:1, padding:'10px 14px', border:`1.5px solid ${form.keySize===sz?'#4f46e5':'#e5e7eb'}`, borderRadius:9, background:form.keySize===sz?'#ede9fe':'#fff', cursor:'pointer', textAlign:'left' }}>
                      <div style={{ fontSize:13, fontWeight:600, color:form.keySize===sz?'#4f46e5':'#374151' }}>{sz}{form.algorithm==='RSA'?'-bit':''}</div>
                      <div style={{ fontSize:11, color:form.keySize===sz?'#7c3aed':'#9ca3af', marginTop:2 }}>{sz==='2048'?'Standard':sz==='4096'?'Recommended':sz==='P-256'?'Standard EC':'High security'}</div>
                    </button>
                  ))}
                </div>
              </div>
            </Sect>

            <button type="submit" style={{ padding:'12px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:600, cursor:'pointer' }}>
              Generate CSR &amp; Private Key
            </button>
          </div>

          {/* Right panel */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'16px 18px' }}>
              <div style={SL}>Auto-assigned Reference</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:22, color:'#4f46e5', fontWeight:500, marginTop:6 }}>{nextNum}</div>
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>Next available number</div>
            </div>
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'16px 18px' }}>
              <div style={SL}>Steps</div>
              <div style={{ marginTop:12 }}>
                {[
                  { label:'Fill in details',   done:true  },
                  { label:'Choose key type',   done:true  },
                  { label:'Generate',          done:false },
                  { label:'Saved to registry', done:false },
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:10, marginBottom:i<3?14:0 }}>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                      <div style={{ width:20, height:20, borderRadius:'50%', background:s.done?'#10b981':'#e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:s.done?'#fff':'#9ca3af', fontWeight:600, flexShrink:0 }}>{s.done?'✓':i+1}</div>
                      {i<3 && <div style={{ width:1, flex:1, background:s.done?'#10b981':'#e5e7eb', minHeight:14, marginTop:2 }} />}
                    </div>
                    <div style={{ paddingBottom:i<3?8:0 }}>
                      <div style={{ fontSize:12.5, fontWeight:500, color:s.done?'#10b981':'#374151' }}>{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#92400e', marginBottom:5 }}>Security reminder</div>
              <div style={{ fontSize:11.5, color:'#92400e', lineHeight:1.65 }}>Your private key is stored in Supabase with row-level security. Always download a backup copy.</div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

function Sect({ title, children }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
      <div style={{ padding:'10px 18px', background:'#f9fafb', borderBottom:'1px solid #e5e7eb', fontSize:10.5, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>{title}</div>
      <div style={{ padding:'16px 18px' }}>{children}</div>
    </div>
  )
}
function FField({ label, error, hint, children }) {
  return (
    <div>
      <label style={{ display:'block', fontSize:12, fontWeight:500, color:'#374151', marginBottom:5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>{hint}</div>}
      {error && <div style={{ fontSize:11.5, color:'#dc2626', marginTop:4 }}>{error}</div>}
    </div>
  )
}
function Inp({ hasError, ...props }) {
  const [f, setF] = useState(false)
  return <input {...props} onFocus={() => setF(true)} onBlur={() => setF(false)} style={{ width:'100%', padding:'8px 11px', border:`1px solid ${f?'#4f46e5':hasError?'#fca5a5':'#e5e7eb'}`, borderRadius:8, fontSize:13, color:'#111827', outline:'none', boxShadow:f?'0 0 0 3px rgba(79,70,229,0.1)':'none', transition:'all 0.15s' }} />
}
const SL = { fontSize:10.5, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em' }
