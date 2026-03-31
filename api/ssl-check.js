module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const domain = (req.query.domain || '')
    .replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase().trim()
  if (!domain) return res.status(400).json({ error: 'domain required' })

  // Run SSL Labs and crt.sh in parallel
  const [labsResult, crtResult] = await Promise.allSettled([
    fetch(
      `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24&all=done`,
      { headers: { 'User-Agent': 'EasySecurity/1.0' } }
    ).then(r => r.json()),
    fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { headers: { Accept: 'application/json' } }
    ).then(r => r.json()),
  ])

  // Grade from SSL Labs
  let grade = null, ipAddress = null, protocols = [], hsts = false, hstsAge = null
  if (labsResult.status === 'fulfilled') {
    const labs = labsResult.value
    if (labs.status === 'READY' && labs.endpoints?.length) {
      const ep  = labs.endpoints[0]
      const det = ep.details || {}
      grade     = ep.grade || null
      ipAddress = ep.ipAddress || null
      protocols = (det.protocols || []).map(p => ({ name: p.name, version: p.version }))
      hsts      = det.hstsPolicy?.status === 'present'
      hstsAge   = det.hstsPolicy?.maxAge || null
    }
  }

  // Cert details from crt.sh (SSL Labs v3 doesn't return full cert objects)
  let subject = null, issuer = null, expires = null, daysLeft = null
  if (crtResult.status === 'fulfilled') {
    const raw = crtResult.value
    if (Array.isArray(raw) && raw.length > 0) {
      const now    = Date.now()
      const dLow   = domain.toLowerCase()
      const sorted = [...raw].sort((a, b) => new Date(b.not_before) - new Date(a.not_before))
      const best   = sorted.find(c =>
        new Date(c.not_after).getTime() > now && (
          (c.common_name || '').toLowerCase() === dLow ||
          (c.common_name || '').toLowerCase() === `*.${dLow}`
        )
      ) || sorted.find(c => new Date(c.not_after).getTime() > now)

      if (best) {
        const exp = new Date(best.not_after)
        const m   = (best.issuer_name || '').match(/\bO=([^,;/]+)/)
        subject  = best.common_name || domain
        issuer   = m ? m[1].trim() : (best.issuer_name || '—').slice(0, 40)
        expires  = exp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        daysLeft = Math.ceil((exp - now) / 86400000)
        if (!grade) grade = daysLeft > 0 ? 'Valid' : 'Expired'
      }
    }
  }

  if (!grade && !issuer) {
    return res.status(200).json({ grade: null, error: 'Could not verify SSL certificate.' })
  }

  return res.status(200).json({
    grade, subject, issuer, expires, daysLeft, ipAddress,
    protocols, hsts, hstsAge, fromCache: false,
    source: grade && grade.length <= 2 ? 'SSL Labs (Qualys)' : 'Certificate Transparency (crt.sh)',
    error: null,
  })
}
