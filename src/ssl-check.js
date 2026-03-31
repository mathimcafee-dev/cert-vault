// Vercel Serverless Function
// Vite + Vercel: use module.exports syntax, NOT ES module export default

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const domain = (req.query.domain || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .toLowerCase()
    .trim()

  if (!domain) return res.status(400).json({ error: 'domain parameter required' })

  // Step 1: SSL Labs
  try {
    const labsUrl = `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24&all=done`
    const labsRes = await fetch(labsUrl, {
      headers: { 'User-Agent': 'EasySecurity/1.0' },
    })
    if (labsRes.ok) {
      const labs = await labsRes.json()
      if (labs.status === 'READY' && labs.endpoints?.length) {
        const ep  = labs.endpoints[0]
        const det = ep.details || {}
        const leaf = det.certChains?.[0]?.certs?.[0] || det.certs?.[0] || null

        let subject = null, issuer = null, expires = null, daysLeft = null

        if (leaf) {
          subject = leaf.subject || domain
          issuer  = parseO(leaf.issuerLabel || leaf.issuerSubject)
          if (leaf.notAfter) {
            const ms  = leaf.notAfter > 1e12 ? leaf.notAfter : leaf.notAfter * 1000
            const exp = new Date(ms)
            expires  = fmt(exp)
            daysLeft = Math.ceil((exp - Date.now()) / 86400000)
          }
        }

        // Fill missing cert details from crt.sh
        if (!expires || !issuer) {
          const crt = await queryCrtSh(domain)
          if (crt) {
            if (!issuer)   issuer   = crt.issuer
            if (!expires)  expires  = crt.expires
            if (!daysLeft) daysLeft = crt.daysLeft
            if (!subject)  subject  = crt.subject
          }
        }

        return res.status(200).json({
          grade: ep.grade, subject, issuer, expires, daysLeft,
          keyAlg:  leaf?.keyAlg  || null,
          keySize: leaf?.keySize || null,
          ipAddress: ep.ipAddress || null,
          protocols: (det.protocols || []).map(p => ({ name: p.name, version: p.version })),
          hsts:    det.hstsPolicy?.status === 'present',
          hstsAge: det.hstsPolicy?.maxAge || null,
          fromCache: !!labs.fromCache,
          source: 'SSL Labs (Qualys)',
          error: null,
        })
      }
    }
  } catch (_) {}

  // Step 2: crt.sh fallback
  const crt = await queryCrtSh(domain)
  if (crt) {
    return res.status(200).json({
      grade: 'Valid', ...crt,
      protocols: [], hsts: false, fromCache: false,
      source: 'Certificate Transparency (crt.sh)',
      error: null,
    })
  }

  return res.status(200).json({
    grade: null, issuer: null, expires: null, daysLeft: null,
    source: null, error: 'SSL certificate could not be verified.',
  })
}

async function queryCrtSh(domain) {
  try {
    const r = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'EasySecurity/1.0' } }
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
      return cn === dLow || cn === `*.${dLow}`
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
  return dn.match(/\bO=([^,;/]+)/)?.[1]?.trim()
    || dn.match(/\bCN=([^,;/]+)/)?.[1]?.trim()
    || null
}

function fmt(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
