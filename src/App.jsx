import { useState, useEffect, useCallback } from 'react'
import { supabase }       from './lib/supabase.js'
import AuthPage           from './pages/AuthPage.jsx'
import RegistryPage       from './pages/RegistryPage.jsx'
import GeneratePage       from './pages/GeneratePage.jsx'
import DetailPage         from './pages/DetailPage.jsx'
import InventoryPage      from './pages/InventoryPage.jsx'
import DmarcPage          from './pages/DmarcPage.jsx'
import DnsPage            from './pages/DnsPage.jsx'
import ComingSoonPage     from './pages/ComingSoonPage.jsx'
import Dashboard          from './pages/Dashboard.jsx'
import TopNav             from './components/TopNav.jsx'
import LeftNav            from './components/LeftNav.jsx'
import RightPanel         from './components/RightPanel.jsx'
import ToastContainer, { useToast } from './components/Toast.jsx'

const COMING_SOON_IDS = ['ssl-checker','cert-labs']

export default function App() {
  const [session,      setSession]      = useState(null)
  const [profile,      setProfile]      = useState(null)
  const [authReady,    setAuthReady]    = useState(false)
  const [page,         setPage]         = useState('overview')
  const [csrs,         setCsrs]         = useState([])
  const [csrsLoading,  setCsrsLoading]  = useState(false)
  const [selectedCsr,  setSelectedCsr]  = useState(null)
  const [inventory,    setInventory]    = useState([])
  const [dmarcHistory, setDmarcHistory] = useState([])
  const [activity,     setActivity]     = useState([])
  const { toasts, push } = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data))
    loadInventory()
    loadDmarcHistory()
  }, [session])

  async function loadInventory() {
    if (!session?.user) return
    const { data } = await supabase.from('certificate_inventory').select('*').eq('user_id', session.user.id).order('cert_expiry', { ascending:true })
    if (data) setInventory(data)
  }

  async function loadDmarcHistory() {
    if (!session?.user) return
    const { data } = await supabase.from('dmarc_history').select('*').eq('user_id', session.user.id).order('checked_at', { ascending:false }).limit(5)
    if (data) setDmarcHistory(data)
  }

  const loadCsrs = useCallback(async () => {
    if (!session?.user) return
    setCsrsLoading(true)
    const { data, error } = await supabase.from('csr_records').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false })
    if (!error && data) setCsrs(data)
    setCsrsLoading(false)
  }, [session])
  useEffect(() => { loadCsrs() }, [loadCsrs])

  function handleAuth(user, sess) { setSession(sess); setPage('overview') }

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null); setCsrs([]); setSelectedCsr(null); setPage('overview')
  }

  async function handleSaveCsr(csrData) {
    const { data, error } = await supabase.from('csr_records').insert({ ...csrData, user_id: session.user.id }).select().single()
    if (error) throw new Error(error.message)
    setCsrs(prev => [data, ...prev])
    setSelectedCsr(data); setPage('detail')
    push('CSR generated and saved!', 'ok')
    addActivity({ icon:'🔒', text:`CSR ${data.csr_number} generated`, time:'Just now' })
  }

  async function handleDeleteCsr(id) {
    const { error } = await supabase.from('csr_records').delete().eq('id', id)
    if (error) { push('Failed to delete CSR.', 'error'); return }
    setCsrs(prev => prev.filter(c => c.id !== id))
    setSelectedCsr(null); setPage('registry')
    push('CSR deleted.', 'ok')
  }

  function addActivity(item) { setActivity(prev => [item, ...prev].slice(0,8)) }
  function handleSelect(csr) { setSelectedCsr(csr); setPage('detail') }

  function daysUntil(str) {
    const m = str?.match(/^(\d{2})-(\d{2})-(\d{4})/)
    if (!m) return null
    const [,dd,mm,yyyy] = m
    return Math.ceil((new Date(`${yyyy}-${mm}-${dd}`) - new Date().setHours(0,0,0,0)) / 86400000)
  }

  const urgentCerts = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d<=60 }).slice(0,4)
  const inventoryAlerts = inventory.filter(r => { const d=daysUntil(r.cert_expiry); return d!==null&&d<=30 }).length

  const navigate = (p) => { setPage(p); if (p==='registry') setSelectedCsr(null) }

  if (!authReady) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, background:'#ecfeff' }}>
      <div style={{ width:36, height:36, border:'3px solid #cffafe', borderTopColor:'#0891b2', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <div style={{ fontSize:13, color:'#67c5d4' }}>Loading CertVault…</div>
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
          {page==='overview'  && <Dashboard user={session.user} setPage={navigate} csrs={csrs}/>}
          {page==='registry'  && <RegistryPage csrs={csrs} loading={csrsLoading} onSelect={handleSelect} onNew={() => navigate('generate')} push={push}/>}
          {page==='generate'  && <GeneratePage csrs={csrs} onSave={handleSaveCsr} push={push}/>}
          {page==='inventory' && <InventoryPage user={session.user}/>}
          {page==='dmarc'     && <DmarcPage user={session.user}/>}
          {page==='dns'       && <DnsPage/>}
          {page==='detail' && selectedCsr && <DetailPage csr={selectedCsr} onDelete={() => handleDeleteCsr(selectedCsr.id)} onBack={() => navigate('registry')} push={push}/>}
          {page==='detail' && !selectedCsr && <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#67c5d4', background:'#ecfeff' }}>Select a CSR from the registry.</div>}
          {COMING_SOON_IDS.includes(page) && <ComingSoonPage toolId={page}/>}
        </main>
        {!hideRight && (
          <RightPanel
            page={page}
            setPage={navigate}
            urgentCerts={urgentCerts}
            dmarcHistory={dmarcHistory}
            recentActivity={activity}
          />
        )}
      </div>
      <ToastContainer toasts={toasts}/>
    </div>
  )
}
