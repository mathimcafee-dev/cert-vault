export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export function nextCsrNumber(existingCsrs) {
  const year = new Date().getFullYear()
  const prefix = `CSR-${year}-`
  const nums = existingCsrs.filter(c => c.csr_number?.startsWith(prefix)).map(c => parseInt(c.csr_number.replace(prefix, ''), 10) || 0)
  return `${prefix}${(Math.max(0, ...nums) + 1).toString().padStart(4, '0')}`
}
export async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
export function downloadTextFile(filename, content) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: 'text/plain' })),
    download: filename,
  })
  a.click(); URL.revokeObjectURL(a.href)
}
export function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
