const API_KEY = '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'

export async function generateCsrAndKey({ domain, organization, orgUnit, city, state, country, email, algorithm, keySize }) {
  const prompt = `You are a certificate authority tool. Generate a realistic PEM-format CSR and private key.

Common Name: ${domain}
Organization: ${organization || 'N/A'}
Organizational Unit: ${orgUnit || 'N/A'}
City: ${city || 'N/A'}
State: ${state || 'N/A'}
Country: ${country || 'US'}
Email: ${email || 'N/A'}
Algorithm: ${algorithm}
Key Size: ${keySize}${algorithm === 'RSA' ? ' bits' : ''}

Return ONLY a JSON object with two keys:
- "csr": full PEM block from -----BEGIN CERTIFICATE REQUEST----- to -----END CERTIFICATE REQUEST-----
- "privateKey": full PEM block from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----

No markdown, no explanation. Only the raw JSON.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message || `API error ${res.status}`)
  }

  const data = await res.json()
  const raw = data.content?.[0]?.text || ''
  const cleaned = raw.replace(/```json|```/gi, '').trim()

  try {
    const p = JSON.parse(cleaned)
    return { csr: p.csr || '', privateKey: p.privateKey || p.private_key || '' }
  } catch {
    const extract = (text, type) => {
      const s = `-----BEGIN ${type}-----`, e = `-----END ${type}-----`
      const si = text.indexOf(s), ei = text.indexOf(e)
      return si >= 0 && ei >= 0 ? text.slice(si, ei + e.length) : ''
    }
    return { csr: extract(raw, 'CERTIFICATE REQUEST'), privateKey: extract(raw, 'PRIVATE KEY') }
  }
}
