// Vercel Edge Function — SSL Labs Proxy + crt.sh fallback
// File: api/ssl-check.js
// URL: /api/ssl-check?domain=github.com

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const domain = new URL(req.url).searchParams.get('domain')
  if (!domain) return Response.json({ error: 'domain required' }, { headers: CORS })

  const d = domain.replace(/^https?:\/\//,'').replace(/\/.*/,'').toLowerCase()

  // ── Try SSL Labs first ─────────────────────────────────────────────────
  try {
    const r = await fetch(
      `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(d)}&fromCache=on&maxAge=24&all=done`,
      { headers: { 'User-Agent': 'EasySecurity/1.0' }, signal: AbortSignal.timeout(18000) }
    )

    if (r.ok) {
      const data = await r.json()

      if (data.status === 'READY' && data.endpoints?.length) {
        const ep = data.endpoints[0]
        const det = ep.details || {}

        // SSL Labs v3: certs are in det.certChains[0].certs OR det.certs
        // notAfter is Unix timestamp in SECONDS (multiply by 1000 for ms)
        let subject = null, issuer = null, expires = null, daysLeft = null, keyAlg = null, keySize = null

        // Try certChains first (v3 structure)
        const chain = det.certChains?.[0]
        const leaf  = chain?.certs?.[0] ?? det.certs?.[0] ?? null

        if (leaf) {
          subject = leaf.subject || leaf.commonNames?.[0] || d
          issuer  = leaf.issuerLabel || leaf.issuerSubject || '—'
          keyAlg  = leaf.keyAlg  || null
          keySize = leaf.keySize || null

          // notAfter can be seconds or ms — SSL Labs uses seconds
          if (leaf.notAfter) {
            const ts  = leaf.notAfter > 1e12 ? leaf.notAfter : leaf.notAfter * 1000
            const exp = new Date(ts)
            expires  = exp.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
            daysLeft = Math.ceil((exp - Date.now()) / 86400000)
          }
        }

        const result = {
          grade:     ep.grade     || null,
          ipAddress: ep.ipAddress || null,
          subject, issuer, expires, daysLeft, keyAlg, keySize,
          protocols: (det.protocols || []).map(p => ({ name: p.name, version: p.version })),
          vulns: ['heartbleed','poodle','freak','logjam','drownVulnerable','ticketbleed','bleichenbacher']
            .filter(v => det[v] === true || det[v] === 2)
            .map(v => ({ heartbleed:'Heartbleed',poodle:'POODLE',freak:'FREAK',logjam:'Logjam',drownVulnerable:'DROWN',ticketbleed:'Ticketbleed',bleichenbacher:'ROBOT' }[v])),
          hsts:      det.hstsPolicy?.status === 'present',
          hstsAge:   det.hstsPolicy?.maxAge  || null,
          fromCache: !!data.fromCache,
          source:    'SSL Labs (Qualys)',
          error:     null,
        }

        // If SSL Labs gave grade but no cert details, supplement from crt.sh
        if (!expires) {
          const crt = await fetchCrtSh(d)
          if (crt) { result.issuer = crt.issuer; result.expires = crt.expires; result.daysLeft = crt.daysLeft; result.subject = crt.subject }
        }

        return Response.json(result, { headers: CORS })
      }

      if (data.status === 'IN_PROGRESS' || data.status === 'DNS') {
        // Fall through to crt.sh — don't make user wait 60s
      } else if (data.errors?.length || data.status === 'ERROR') {
        // Fall through to crt.sh
      }
    }
  } catch (_) {
    // Fall through to crt.sh
  }

  // ── Fallback: crt.sh Certificate Transparency ──────────────────────────
  const crt = await fetchCrtSh(d)
  if (crt) {
    return Response.json({
      grade: 'Valid', source: 'Certificate Transparency (crt.sh)',
      ...crt, protocols: [], vulns: [], hsts: false, fromCache: false, error: null,
    }, { headers: CORS })
  }

  return Response.json({
    grade: null, error: 'Could not verify SSL certificate. Domain may not have SSL installed.',
    source: 'N/A', issuer: null, expires: null, daysLeft: null,
  }, { headers: CORS })
}

async function fetchCrtSh(domain) {
  try {
    const r = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!r.ok) return null
    const raw = await r.json()
    if (!Array.isArray(raw) || !raw.length) return null

    const now  = Date.now()
    const sorted = [...raw].sort((a,b) => new Date(b.not_before) - new Date(a.not_before))

    // Find valid cert matching this domain
    const valid = sorted.find(c => {
      const exp = new Date(c.not_after).getTime()
      if (exp < now) return false
      const cn = c.common_name || ''
      return cn === domain || cn === `*.${domain}` ||
        (c.name_value||'').split('\n').some(n => n.trim() === domain || n.trim() === `*.${domain}`)
    }) || sorted.find(c => new Date(c.not_after).getTime() > now)

    if (!valid) return null

    const exp = new Date(valid.not_after)
    return {
      subject:  valid.common_name || domain,
      issuer:   valid.issuer_name?.match(/O=([^,/]+)/)?.[1]?.trim() ||
                valid.issuer_name?.match(/CN=([^,/]+)/)?.[1]?.trim() || '—',
      expires:  exp.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }),
      daysLeft: Math.ceil((exp - now) / 86400000),
      ipAddress: null, keyAlg: null, keySize: null,
    }
  } catch { return null }
}
