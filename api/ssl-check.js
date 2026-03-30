// Vercel Serverless Function — SSL Labs Proxy
// Path: /api/ssl-check?domain=github.com
// This runs on Vercel's servers (no CORS), calls SSL Labs, returns result

export const config = { runtime: 'edge' }

export default async function handler(request) {
  const url    = new URL(request.url)
  const domain = url.searchParams.get('domain')

  if (!domain) {
    return Response.json({ error: 'domain parameter required' }, { status: 400 })
  }

  const cleanDomain = domain.replace(/^https?:\/\//,'').replace(/\/.*/,'').toLowerCase()

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=3600',
    'Content-Type': 'application/json',
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers })
  }

  try {
    // Call SSL Labs from server-side (no CORS issues)
    const labsUrl = `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(cleanDomain)}&fromCache=on&maxAge=24&all=done`
    const r = await fetch(labsUrl, {
      headers: { 'User-Agent': 'EasySecurity Scanner/1.0' },
      signal: AbortSignal.timeout(20000),
    })

    if (!r.ok) {
      return Response.json({ error: `SSL Labs error: ${r.status}` }, { status: 200, headers })
    }

    const data = await r.json()

    // Parse into clean response
    const result = {
      domain:     cleanDomain,
      status:     data.status,
      grade:      null,
      subject:    null,
      issuer:     null,
      expires:    null,
      daysLeft:   null,
      keyAlg:     null,
      keySize:    null,
      protocols:  [],
      vulns:      [],
      hsts:       false,
      hstsAge:    null,
      ipAddress:  null,
      fromCache:  !!data.fromCache,
      error:      null,
    }

    if (data.errors?.length) {
      result.error = data.errors[0].message
      return Response.json(result, { headers })
    }

    if (data.status === 'READY' && data.endpoints?.length) {
      const ep = data.endpoints[0]
      result.grade     = ep.grade
      result.ipAddress = ep.ipAddress

      if (ep.details) {
        const d = ep.details
        // Cert
        if (d.certChains?.length) {
          const leaf = d.certChains[0].certs?.[0]
          if (leaf) {
            result.subject = leaf.subject
            result.issuer  = leaf.issuerLabel || leaf.issues?.[0] || '—'
            result.keyAlg  = leaf.keyAlg
            result.keySize = leaf.keySize
            if (leaf.notAfter) {
              const exp = new Date(leaf.notAfter)
              result.expires  = exp.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
              result.daysLeft = Math.ceil((exp - Date.now()) / 86400000)
            }
          }
        }
        // Protocols
        result.protocols = (d.protocols||[]).map(p => ({ name:p.name, version:p.version }))
        // Vulns
        const VULNS = ['heartbleed','poodle','freak','logjam','drownVulnerable','ticketbleed','bleichenbacher']
        result.vulns = VULNS.filter(v => d[v]===true||d[v]===2).map(v => ({
          heartbleed:'Heartbleed', poodle:'POODLE', freak:'FREAK',
          logjam:'Logjam', drownVulnerable:'DROWN', ticketbleed:'Ticketbleed',
          bleichenbacher:'ROBOT'
        }[v]))
        // HSTS
        result.hsts    = d.hstsPolicy?.status === 'present'
        result.hstsAge = d.hstsPolicy?.maxAge || null
      }
    } else if (data.status === 'IN_PROGRESS' || data.status === 'DNS') {
      result.error = 'SSL Labs scan in progress — result not cached yet. Try again in 60 seconds.'
    } else if (data.status === 'ERROR') {
      result.error = data.statusMessage || 'SSL Labs scan failed'
    }

    return Response.json(result, { headers })

  } catch (e) {
    return Response.json(
      { error: e.name === 'TimeoutError' ? 'SSL Labs timeout — try again' : e.message },
      { status: 200, headers }
    )
  }
}
