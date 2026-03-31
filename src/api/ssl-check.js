module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const domain = (req.query.domain || '')
    .replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase().trim()
  if (!domain) return res.status(400).json({ error: 'domain required' })

  // Try SSL Labs
  try {
    const url = `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24&all=done`
    const r = await fetch(url, { headers: { 'User-Agent': 'EasySecurity/1.0' } })
    if (r.ok) {
      const labs = await r.json()
      
      // Log full response to debug
      console.log('SSL Labs status:', labs.status)
      if (labs.endpoints?.[0]) {
        const ep = labs.endpoints[0]
        console.log('Grade:', ep.grade)
        console.log('Has details:', !!ep.details)
        console.log('certChains:', JSON.stringify(ep.details?.certChains?.length))
        console.log('First cert keys:', JSON.stringify(Object.keys(ep.details?.certChains?.[0]?.certs?.[0] || {})))
        console.log('First cert sample:', JSON.stringify(ep.details?.certChains?.[0]?.certs?.[0]).slice(0, 300))
      }

      if (labs.status === 'READY' && labs.endpoints?.length) {
        const ep  = labs.endpoints[0]
        const det = ep.details || {}

        // SSL Labs v3: cert is in certChains[].certs[]
        // notAfter is UNIX SECONDS
        const chain = det.certChains?.[0]
        const leaf  = chain?.certs?.[0]

        let subject = null, issuer = null, expires = null, daysLeft = null

        if (leaf) {
          console.log('leaf notAfter:', leaf.notAfter, 'type:', typeof leaf.notAfter)
          console.log('leaf subject:', leaf.subject)
          console.log('leaf issuerLabel:', leaf.issuerLabel)
          
          subject = leaf.subject || domain
          // issuerLabel is a friendly name like "DigiCert TLS RSA SHA256 2020 CA1"
          issuer = leaf.issuerLabel || null
          
          if (!issuer && leaf.issuerSubject) {
            // Parse O= from issuerSubject DN string
            const m = (leaf.issuerSubject || '').match(/\bO=([^,;/]+)/)
            issuer = m ? m[1].trim() : null
          }

          if (leaf.notAfter) {
            // notAfter is seconds since epoch in SSL Labs API
            const ms  = leaf.notAfter > 1e12 ? leaf.notAfter : leaf.notAfter * 1000
            const exp = new Date(ms)
            expires  = exp.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
            daysLeft = Math.ceil((exp - Date.now()) / 86400000)
            console.log('Parsed expiry:', expires, 'days:', daysLeft)
          }
        }

        // If still no cert details, use crt.sh to fill in
        if (!expires) {
          console.log('No cert details from SSL Labs, trying crt.sh...')
          const crt = await queryCrtSh(domain)
          if (crt) { subject = crt.subject; issuer = crt.issuer; expires = crt.expires; daysLeft = crt.daysLeft }
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
  } catch (e) {
    console.error('SSL Labs error:', e.message)
  }

  // Fallback: crt.sh
  const crt = await queryCrtSh(domain)
  if (crt) {
    return res.status(200).json({
      grade: 'Valid', ...crt,
      protocols: [], hsts: false, fromCache: false,
      source: 'Certificate Transparency (crt.sh)', error: null,
    })
  }

  return res.status(200).json({ grade: null, error: 'Could not verify SSL.' })
}

async function queryCrtSh(domain) {
  try {
    const r = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      { headers: { Accept: 'application/json', 'User-Agent': 'EasySecurity/1.0' } }
    )
    if (!r.ok) return null
    const raw = await r.json()
    if (!Array.isArray(raw) || !raw.length) return null

    const now  = Date.now()
    const dLow = domain.toLowerCase()
    const sorted = [...raw].sort((a, b) => new Date(b.not_before) - new Date(a.not_before))
    const best = sorted.find(c =>
      new Date(c.not_after).getTime() > now && (
        (c.common_name||'').toLowerCase() === dLow ||
        (c.common_name||'').toLowerCase() === `*.${dLow}`
      )
    ) || sorted.find(c => new Date(c.not_after).getTime() > now)

    if (!best) return null
    const exp = new Date(best.not_after)
    const m   = (best.issuer_name||'').match(/\bO=([^,;/]+)/)
    return {
      subject:  best.common_name || domain,
      issuer:   m ? m[1].trim() : (best.issuer_name||'—').slice(0, 40),
      expires:  exp.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }),
      daysLeft: Math.ceil((exp - now) / 86400000),
      ipAddress: null, keyAlg: null, keySize: null,
    }
  } catch { return null }
}
