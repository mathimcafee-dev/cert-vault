module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const domain = (req.query.domain || '')
    .replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase().trim()
  if (!domain) return res.status(400).json({ error: 'domain required' })

  const result = { domain, labsStatus: null, labsError: null, crtError: null }

  // SSL Labs
  try {
    const r = await fetch(
      `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24&all=done`,
      { headers: { 'User-Agent': 'EasySecurity/1.0' } }
    )
    const labs = await r.json()
    result.labsStatus = labs.status
    result.labsRaw = JSON.stringify(labs).slice(0, 2000)

    if (labs.status === 'READY' && labs.endpoints?.length) {
      const ep   = labs.endpoints[0]
      const det  = ep.details || {}
      const leaf = det.certChains?.[0]?.certs?.[0] || null

      result.grade     = ep.grade
      result.ipAddress = ep.ipAddress
      result.hasLeaf   = !!leaf
      result.leafKeys  = leaf ? Object.keys(leaf) : []
      result.notAfter  = leaf?.notAfter
      result.subject   = leaf?.subject
      result.issuerLabel = leaf?.issuerLabel

      if (leaf?.notAfter) {
        const ms  = leaf.notAfter > 1e12 ? leaf.notAfter : leaf.notAfter * 1000
        const exp = new Date(ms)
        result.expires  = exp.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
        result.daysLeft = Math.ceil((exp - Date.now()) / 86400000)
        result.issuer   = leaf.issuerLabel || null
        result.source   = 'SSL Labs (Qualys)'
        result.error    = null
        return res.status(200).json(result)
      }
    }
  } catch (e) {
    result.labsError = e.message
  }

  // crt.sh
  try {
    const r = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { headers: { Accept: 'application/json' } }
    )
    const raw = await r.json()
    result.crtCount = raw?.length

    const now  = Date.now()
    const dLow = domain.toLowerCase()
    const sorted = [...raw].sort((a, b) => new Date(b.not_before) - new Date(a.not_before))
    const best = sorted.find(c =>
      new Date(c.not_after).getTime() > now && (
        (c.common_name||'').toLowerCase() === dLow ||
        (c.common_name||'').toLowerCase() === `*.${dLow}`
      )
    ) || sorted.find(c => new Date(c.not_after).getTime() > now)

    if (best) {
      const exp = new Date(best.not_after)
      const m   = (best.issuer_name||'').match(/\bO=([^,;/]+)/)
      result.grade    = 'Valid'
      result.subject  = best.common_name || domain
      result.issuer   = m ? m[1].trim() : best.issuer_name?.slice(0,40) || '—'
      result.expires  = exp.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      result.daysLeft = Math.ceil((exp - now) / 86400000)
      result.source   = 'Certificate Transparency (crt.sh)'
      result.error    = null
      return res.status(200).json(result)
    }
  } catch (e) {
    result.crtError = e.message
  }

  return res.status(200).json(result)
}
