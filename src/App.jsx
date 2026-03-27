import { useState, useEffect, useCallback } from 'react'
import { supabase }       from './lib/supabase.js'
import AuthPage           from './pages/AuthPage.jsx'
import RegistryPage       from './pages/RegistryPage.jsx'
import GeneratePage       from './pages/GeneratePage.jsx'
import DetailPage         from './pages/DetailPage.jsx'
import InventoryPage      from './pages/InventoryPage.jsx'
import DmarcPage          from './pages/DmarcPage.jsx'
import ComingSoonPage     from './pages/ComingSoonPage.jsx'
import Sidebar            from './components/Sidebar.jsx'
import ToastContainer, { useToast } from './components/Toast.jsx'

const COMING_SOON_IDS = ['ssl-checker','cert-labs','dns-checker']

export default function App() {
  const [session,     setSession]     = useState(null)
  const [profile,     setProfile]     = useState(null)
  const [authReady,   setAuthReady]   = useState(false)
  const [page,        setPage]        = useState('registry')
  const [csrs,        setCsrs]        = useState([])
  const [csrsLoading, setCsrsLoading] = useState(false)
  const [selectedCsr, setSelectedCsr] = useState(null)
  const { toasts, push } = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data))
  }, [session])

  const loadCsrs = useCallback(async () => {
    if (!session?.user) return
    setCsrsLoading(true)
    const { data, error } = await supabase.from('csr_records').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false })
    if (!error && data) setCsrs(data)
    setCsrsLoading(false)
  }, [session])
  useEffect(() => { loadCsrs() }, [loadCsrs])

  function handleAuth(user, sess) { setSession(sess); setPage('registry') }

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null); setCsrs([]); setSelectedCsr(null); setPage('registry')
  }

  async function handleSaveCsr(csrData) {
    const { data, error } = await supabase.from('csr_records').insert({ ...csrData, user_id: session.user.id }).select().single()
    if (error) throw new Error(error.message)
    setCsrs(prev => [data, ...prev])
    setSelectedCsr(data); setPage('detail')
    push('CSR generated and saved!', 'ok')
  }

  async function handleDeleteCsr(id) {
    const { error } = await supabase.from('csr_records').delete().eq('id', id)
    if (error) { push('Failed to delete CSR.', 'error'); return }
    setCsrs(prev => prev.filter(c => c.id !== id))
    setSelectedCsr(null); setPage('registry')
    push('CSR deleted.', 'ok')
  }

  function handleSelect(csr) { setSelectedCsr(csr); setPage('detail') }

  if (!authReady) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14 }}>
      <div style={{ width:36, height:36, border:'3px solid #e5e7eb', borderTopColor:'#4f46e5', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <div style={{ fontSize:13, color:'#6b7280' }}>Loading CertVault…</div>
    </div>
  )

  if (!session) return <AuthPage onAuth={handleAuth} />

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <Sidebar
        page={page}
        setPage={p => { setPage(p); if (p==='registry') setSelectedCsr(null) }}
        user={session.user}
        profile={profile}
        csrCount={csrs.length}
        onLogout={handleLogout}
      />
      <main style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#f5f6fa' }}>
        {page==='registry'  && <RegistryPage csrs={csrs} loading={csrsLoading} onSelect={handleSelect} onNew={() => setPage('generate')} push={push} />}
        {page==='generate'  && <GeneratePage csrs={csrs} onSave={handleSaveCsr} push={push} />}
        {page==='inventory' && <InventoryPage user={session.user} />}
        {page==='dmarc'     && <DmarcPage user={session.user} />}
        {page==='detail' && selectedCsr && <DetailPage csr={selectedCsr} onDelete={() => handleDeleteCsr(selectedCsr.id)} onBack={() => setPage('registry')} push={push} />}
        {page==='detail' && !selectedCsr && <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#9ca3af' }}>Select a CSR from the registry.</div>}
        {COMING_SOON_IDS.includes(page) && <ComingSoonPage toolId={page} />}
      </main>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
