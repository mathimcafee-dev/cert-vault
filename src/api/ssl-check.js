// Vercel Edge Function — SSL Certificate Checker
// Runs server-side: no CORS issues, no rate limits from browser
// Path: api/ssl-check.js → URL: /api/ssl-check?domain=github.com

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('domain') || ''
  const domain = raw.replace(/^https?:\/\//,'').replace(/\/.*/,'').toLowerCase().trim()

  if (!domain) {
    return Response.json({ error: 'domain parameter required' }, { status: 400, headers: CORS })
  }

  // Step 1: SSL Labs (most accurate — grade A+/A/B/F + full cert details)
  try {
    const labsRes = await fetch(
      `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24&all=done`,
      {
        headers: { 'User-Agent': 'EasySecurity-Scanner/1.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      }
    )
    if (labsRes.ok) {
      const labs = await labsRes.json()
      if (labs.status === 'READY' && labs.endpoints?.length) {
        const ep  = labs.endpoints[0]
        const det = ep.details || {}

        let subject = null, issuer = null, expires = null, daysLeft = null, keyAlg = null, keySize = null

        // SSL Labs v3 stores certs in certChains[0].certs[]
        // notAfter = Unix SECONDS (not ms)
        const leaf = det.certChains?.[0]?.certs?.[0] || det.certs?.[0] || null
        if (leaf) {
          subject = leaf.subject || domain
          issuer  = leaf.issuerLabel || parseO(leaf.issuerSubject) || '—'
          keyAlg  = leaf.keyAlg  || null
          keySize = leaf.keySize || null
          if (leaf.notAfter) {
            const ms  = leaf.notAfter > 1e12 ? leaf.notAfter : leaf.notAfter * 1000
            const exp = new Date(ms)
            expires  = fmt(exp)
            daysLeft = Math.ceil((exp - Date.now()) / 86400000)
          }
        }

        // If SSL Labs didn't return cert details (uncommon), fill from crt.sh
        if (!expires || !issuer || issuer === '—') {
          const crt = await queryCrtSh(domain)
          if (crt) {
            if (!issuer || issuer === '—') issuer   = crt.issuer
            if (!expires)                  expires  = crt.expires
            if (daysLeft === null)         daysLeft = crt.daysLeft
            if (!subject)                  subject  = crt.subject
          }
        }

        return Response.json({
          grade:    ep.grade || null,
          subject, issuer, expires, daysLeft, keyAlg, keySize,
          ipAddress: ep.ipAddress || null,
          protocols: (det.protocols || []).map(p => ({ name: p.name, version: p.version })),
          vulns: extractVulns(det),
          hsts:    det.hstsPolicy?.status === 'present',
          hstsAge: det.hstsPolicy?.maxAge  || null,
          fromCache: !!labs.fromCache,
          source: 'SSL Labs (Qualys)',
          error:  null,
        }, { headers: CORS })
      }
      // SSL Labs busy/error — fall through to crt.sh
    }
  } catch (_) {
    // Timeout or network error — fall through
  }

  // Step 2: crt.sh — always works, gives real cert data
  const crt = await queryCrtSh(domain)
  if (crt) {
    return Response.json({
      grade: 'Valid',
      ...crt,
      protocols: [], vulns: [], hsts: false, hstsAge: null,
      fromCache: false,
      source: 'Certificate Transparency (crt.sh)',
      error: null,
    }, { headers: CORS })
  }

  return Response.json({
    grade: null, issuer: null, expires: null, daysLeft: null,
    source: null, error: 'SSL certificate could not be verified for this domain.',
  }, { status: 200, headers: CORS })
}

async function queryCrtSh(domain) {
  try {
    const r = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      {
        headers: { 'Accept': 'application/json', 'User-Agent': 'EasySecurity/1.0' },
        signal: AbortSignal.timeout(12000),
      }
    )
    if (!r.ok) return null
    const raw = await r.json()
    if (!Array.isArray(raw) || !raw.length) return null

    const now    = Date.now()
    const sorted = [...raw].sort((a, b) => new Date(b.not_before) - new Date(a.not_before))
    const dLow   = domain.toLowerCase()

    const best = sorted.find(c => {
      if (new Date(c.not_after).getTime() <= now) return false
      const cn = (c.common_name || '').toLowerCase()
      return cn === dLow || cn === `*.${dLow}` ||
        (c.name_value || '').toLowerCase().split('\n')
          .some(n => n.trim() === dLow || n.trim() === `*.${dLow}`)
    }) || sorted.find(c => new Date(c.not_after).getTime() > now)

    if (!best) return null
    const exp = new Date(best.not_after)
    return {
      subject:  best.common_name || domain,
      issuer:   parseO(best.issuer_name) || '—',
      expires:  fmt(exp),
      daysLeft: Math.ceil((exp - now) / 86400000),
      ipAddress: null, keyAlg: null, keySize: null,
    }
  } catch { return null }
}

function parseO(dn) {
  if (!dn) return null
  const m = dn.match(/\bO=([^,;/]+)/)
  if (m) return m[1].trim()
  const m2 = dn.match(/\bCN=([^,;/]+)/)
  return m2 ? m2[1].trim() : null
}

function fmt(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function extractVulns(det) {
  return [
    ['heartbleed','Heartbleed'], ['poodle','POODLE'], ['freak','FREAK'],
    ['logjam','Logjam'], ['drownVulnerable','DROWN'], ['ticketbleed','Ticketbleed'],
    ['bleichenbacher','ROBOT'],
  ].filter(([k]) => det[k] === true || det[k] === 2).map(([,v]) => v)
}
