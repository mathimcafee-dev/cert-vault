import { useState, useEffect, useCallback } from 'react'
import { supabase }        from './lib/supabase.js'
import AuthPage            from './pages/AuthPage.jsx'
import Dashboard           from './pages/Dashboard.jsx'
import RegistryPage        from './pages/RegistryPage.jsx'
import GeneratePage        from './pages/GeneratePage.jsx'
import DetailPage          from './pages/DetailPage.jsx'
import InventoryPage       from './pages/InventoryPage.jsx'
import CertLabsPage        from './pages/CertLabsPage.jsx'
import TopNav              from './components/TopNav.jsx'
import LeftNav             from './components/LeftNav.jsx'
import RightPanel          from './components/RightPanel.jsx'
import ToastContainer, { useToast } from './components/Toast.jsx'

export default function App() {
  const [session,      setSession]      = useState(null)
  const [profile,      setProfile]      = useState(null)
  const [authReady,    setAuthReady]    = useState(false)
  const [page,         setPage]         = useState('overview')
  const [csrs,         setCsrs]         = useState([])
  const [csrsLoading,  setCsrsLoading]  = useState(false)
  const [selectedCsr,  setSelectedCsr]  = useState(null)
  const [inventory,    setInventory]    = useState([])
  const [activity,     setActivity]     = useState([])
  const [certLabsTool, setCertLabsTool] = useState('ssl-checker')
  const { toasts, push } = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
    loadInventory()
  }, [session])

  async function loadInventory() {
    if (!session?.user) return
    const { data } = await supabase.from('certificate_inventory').select('*').eq('user_id', session.user.id)
    if (data) setInventory(data)
  }
  const loadCsrs = useCallback(async () => {
    if (!session?.user) return
    setCsrsLoading(true)
    const { data, error } = await supabase.from('csr_records').select('*').eq('user_id', session.user.id).order('created_at', { ascending:false })
    if (!error && data) setCsrs(data)
    setCsrsLoading(false)
  }, [session])
  useEffect(() => { loadCsrs() }, [loadCsrs])

  function handleAuth(user, sess) {
    setSession(sess); setPage('overview')
  }
  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null); setCsrs([]); setSelectedCsr(null)
    setInventory([]); setActivity([]); setPage('overview')
  }

  async function handleSaveCsr(csrData) {
    const { data, error } = await supabase.from('csr_records').insert({ ...csrData, user_id: session.user.id }).select().single()
    if (error) throw new Error(error.message)
    setCsrs(prev => [data, ...prev])
    setSelectedCsr(data); setPage('detail')
    push('CSR generated and saved!', 'ok')
    setActivity(prev => [{ icon:'🔑', text:`CSR ${data.csr_number} generated`, time:'Just now' }, ...prev].slice(0,8))
  }
  async function handleDeleteCsr(id) {
    const { error } = await supabase.from('csr_records').delete().eq('id', id)
    if (error) { push('Failed to delete.', 'error'); return }
    setCsrs(prev => prev.filter(c => c.id !== id))
    setSelectedCsr(null); setPage('registry')
    push('CSR deleted.', 'ok')
  }
  function addActivity(item) { setActivity(prev => [item, ...prev].slice(0,8)) }
  function handleSelect(csr) { setSelectedCsr(csr); setPage('detail') }

  const navigate = (p) => {
    if (p.startsWith('cert-labs:'))  { setCertLabsTool(p.split(':')[1]);  setPage('cert-labs');  return }
    setPage(p)
    if (p === 'registry') setSelectedCsr(null)
  }

  function daysUntil(str) {
    const m = str?.match(/^(\d{2})-(\d{2})-(\d{4})/)
    if (!m) return null
    return Math.ceil((new Date(`${m[3]}-${m[2]}-${m[1]}`) - new Date().setHours(0,0,0,0)) / 86400000)
  }
  const urgentCerts     = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d<=60 }).slice(0,4)
  const inventoryAlerts = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d<=30 }).length

  // ── Show landing page ──
  if (!authReady) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, background:'#ecfeff' }}>
      <div style={{ width:36, height:36, border:'3px solid #cffafe', borderTopColor:'#0891b2', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
      <div style={{ fontSize:13, color:'#67c5d4', fontFamily:'Inter,sans-serif' }}>Loading EasySecurity…</div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (!session) return <AuthPage onAuth={handleAuth}/>

  const hideRight = ['generate','detail'].includes(page)

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'#ecfeff' }}>
      <TopNav
        page={page}
        setPage={navigate}
        user={session.user}
        profile={profile}
        inventoryAlerts={inventoryAlerts}
        onLogout={handleLogout}
      />
      <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>
        <LeftNav
          page={page}
          setPage={navigate}
          csrCount={csrs.length}
          inventoryAlerts={inventoryAlerts}
        />
        <main style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
          {page==='overview'   && <Dashboard user={session.user} setPage={navigate} csrs={csrs}/>}
          {page==='registry'   && <RegistryPage csrs={csrs} loading={csrsLoading} onSelect={handleSelect} onNew={() => navigate('generate')} push={push}/>}
          {page==='generate'   && <GeneratePage csrs={csrs} onSave={handleSaveCsr} push={push}/>}
          {page==='inventory'  && <InventoryPage user={session.user}
            onUpload={() => { loadInventory(); addActivity({ icon:'📋', text:'CSV uploaded — inventory refreshed', time:'Just now' }) }}
          />}
          {page==='cert-labs'  && <CertLabsPage initialTool={certLabsTool}/>}
          {page==='detail' && selectedCsr && <DetailPage csr={selectedCsr} onDelete={() => handleDeleteCsr(selectedCsr.id)} onBack={() => navigate('registry')} push={push}/>}
          {page==='detail' && !selectedCsr && <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#67c5d4', background:'#ecfeff' }}>Select a CSR from the registry.</div>}
        </main>
        {!hideRight && (
          <RightPanel
            page={page}
            setPage={navigate}
            urgentCerts={urgentCerts}
            recentActivity={activity}
          />
        )}
      </div>
      <ToastContainer toasts={toasts}/>
    </div>
  )
}
