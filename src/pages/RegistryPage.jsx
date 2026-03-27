import { useState } from 'react'
import { fmtDate } from '../lib/utils.js'

export default function RegistryPage({ csrs, loading, onSelect, onNew }) {
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const PER = 10

  const filtered = csrs.filter(c =>
    c.domain?.toLowerCase().includes(search.toLowerCase()) ||
    c.csr_number?.toLowerCase().includes(search.toLowerCase()) ||
    c.organization?.toLowerCase().includes(search.toLowerCase())
  )
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PER))
  const paged       = filtered.slice((page - 1) * PER, page * PER)
  const thisMonth   = csrs.filter(c => new Date(c.created_at).getMonth() === new Date().getMonth()).length
  const domains     = new Set(csrs.map(c => c.domain)).size

  const stats = [
    { label: 'Total CSRs',     value: csrs.length, color: '#4f46e5', sub: 'All time'        },
    { label: 'This Month',     value: thisMonth,    color: '#10b981', sub: 'New CSRs'        },
    { label: 'Unique Domains', value: domains,      color: '#f59e0b', sub: 'Registered'      },
    { label: 'Private Keys',   value: csrs.length,  color: '#6366f1', sub: 'Stored securely' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 28px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>CSR Registry</h1>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>All certificate signing requests and private keys</p>
        </div>
        <button onClick={onNew} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600 }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
          New CSR
        </button>
      </div>

      {/* Stats */}
      <div style={{ padding: '16px 28px', display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600, color: s.color, marginTop: 4, letterSpacing: '-0.03em' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 28px 28px' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search domain, CSR#, organization…" style={{ padding: '7px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12.5, color: '#374151', outline: 'none', width: 280 }} />
          </div>

          {loading && <div style={{ padding: '60px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading…</div>}

          {!loading && csrs.length === 0 && (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, background: '#f3f4f6', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="#9ca3af" strokeWidth="1.5"/><path d="M8 12h8M8 8h8M8 16h5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#6b7280' }}>No CSRs yet</div>
              <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 5 }}>Click "New CSR" to generate your first certificate signing request.</div>
            </div>
          )}

          {!loading && csrs.length > 0 && filtered.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>No results for "{search}"</div>
          )}

          {!loading && paged.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '148px 1fr 170px 120px 90px 88px 72px', padding: '9px 16px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                {['CSR Number','Domain','Organization','Created','Algorithm','Key Size',''].map((h, i) => (
                  <span key={i} style={{ fontSize: 10.5, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                ))}
              </div>
              {paged.map((csr, i) => <Row key={csr.id} csr={csr} idx={i} total={paged.length} onSelect={onSelect} />)}
            </>
          )}

          {filtered.length > PER && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Page {page} of {totalPages}</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {[...Array(totalPages)].map((_, i) => (
                  <button key={i} onClick={() => setPage(i+1)} style={{ minWidth: 30, height: 30, borderRadius: 6, border: '1px solid #e5e7eb', background: page === i+1 ? '#4f46e5' : '#fff', color: page === i+1 ? '#fff' : '#374151', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>{i+1}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ csr, idx, total, onSelect }) {
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'grid', gridTemplateColumns: '148px 1fr 170px 120px 90px 88px 72px', padding: '12px 16px', borderBottom: idx < total-1 ? '1px solid #f9fafb' : 'none', alignItems: 'center', background: hov ? '#f0f1ff' : idx % 2 === 0 ? '#fff' : '#fafafa', transition: 'background 0.12s' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#4f46e5', fontWeight: 500 }}>{csr.csr_number}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{csr.domain}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>SHA-256</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{csr.organization || '—'}</div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(csr.created_at)}</div>
      <div style={{ fontSize: 12, color: '#374151' }}>{csr.algorithm || 'RSA'}</div>
      <div style={{ fontSize: 12, color: '#374151' }}>{csr.key_size}{csr.algorithm === 'RSA' ? '-bit' : ''}</div>
      <button onClick={() => onSelect(csr)} style={{ padding: '5px 12px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>View</button>
    </div>
  )
}
