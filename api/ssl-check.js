module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const domain = (req.query.domain || '')
    .replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase().trim()
  if (!domain) return res.status(400).json({ error: 'domain required' })

  // Run SSL Labs and crt.sh in parallel
  const [labsRes, crtRes] = await Promise.allSettled([
    fetchSSLLabs(domain),
    fetchCrtSh(domain),
  ])

  const labs = labsRes.status === 'fulfilled' ? labsRes.value : null
  let   crt  = crtRes.status  === 'fulfilled' ? crtRes.value  : null

  // If crt.sh failed in parallel, retry once (it's sometimes slow to start)
  if (!crt) {
    crt = await fetchCrtSh(domain)
  }

  // Grade + TLS details from SSL Labs
  const grade     = labs?.grade     || (crt ? 'Valid' : null)
  const ipAddress = labs?.ipAddress || null
  const protocols = labs?.protocols || []
  const hsts      = labs?.hsts      || false
  const hstsAge   = labs?.hstsAge   || null

  // Cert details from crt.sh (SSL Labs v3 only returns cert IDs, not full certs)
  const subject  = crt?.subject  || null
  const issuer   = crt?.issuer   || null
  const expires  = crt?.expires  || null
  const daysLeft = crt?.daysLeft ?? null

  if (!grade && !issuer) {
    return res.status(200).json({ grade: null, error: 'Could not verify SSL certificate.' })
  }

  const source = labs?.grade ? 'SSL Labs (Qualys) + CT logs' : 'Certificate Transparency (crt.sh)'

  return res.status(200).json({
    grade, subject, issuer, expires, daysLeft, ipAddress,
    protocols, hsts, hstsAge, fromCache: false, source, error: null,
  })
}

async function fetchSSLLabs(domain) {
  try {
    const r = await fetch(
      `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24&all=done`,
      { headers: { 'User-Agent': 'EasySecurity/1.0' } }
    )
    if (!r.ok) return null
    const data = await r.json()
    if (data.status !== 'READY' || !data.endpoints?.length) return null
    const ep  = data.endpoints[0]
    const det = ep.details || {}
    return {
      grade:     ep.grade || null,
      ipAddress: ep.ipAddress || null,
      protocols: (det.protocols || []).map(p => ({ name: p.name, version: p.version })),
      hsts:      det.hstsPolicy?.status === 'present',
      hstsAge:   det.hstsPolicy?.maxAge || null,
    }
  } catch { return null }
}

async function fetchCrtSh(domain) {
  try {
    const r = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { headers: { Accept: 'application/json', 'User-Agent': 'EasySecurity/1.0' } }
    )
    if (!r.ok) return null
    const raw = await r.json()
    if (!Array.isArray(raw) || !raw.length) return null

    const now    = Date.now()
    const dLow   = domain.toLowerCase()
    const sorted = [...raw].sort((a, b) => new Date(b.not_before) - new Date(a.not_before))
    const best   = sorted.find(c =>
      new Date(c.not_after).getTime() > now && (
        (c.common_name || '').toLowerCase() === dLow ||
        (c.common_name || '').toLowerCase() === `*.${dLow}`
      )
    ) || sorted.find(c => new Date(c.not_after).getTime() > now)

    if (!best) return null
    const exp = new Date(best.not_after)
    const m   = (best.issuer_name || '').match(/\bO=([^,;/]+)/)
    return {
      subject:  best.common_name || domain,
      issuer:   m ? m[1].trim() : (best.issuer_name || '—').slice(0, 50),
      expires:  exp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      daysLeft: Math.ceil((exp - now) / 86400000),
    }
  } catch { return null }
}
