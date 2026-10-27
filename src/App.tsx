import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Nav } from './components/Nav'
import { DemoBanner, DemoEmailInbox, DemoSmsInbox, Footer, Toaster } from './components/Shell'
import { Spinner } from './components/ui'
import Home from './pages/Home'

const Explore = lazy(() => import('./pages/Explore'))
const Organization = lazy(() => import('./pages/Organization'))
const Donate = lazy(() => import('./pages/Donate'))
const Track = lazy(() => import('./pages/Track'))
const Experience = lazy(() => import('./pages/Experience'))
const Login = lazy(() => import('./pages/Login'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const DonorDashboard = lazy(() => import('./pages/DonorDashboard'))
const OrgPortal = lazy(() => import('./pages/OrgPortal'))
const PartnerPortal = lazy(() => import('./pages/PartnerPortal'))
const Admin = lazy(() => import('./pages/Admin'))
const Content = lazy(() => import('./pages/Content'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <DemoBanner />
      <Nav />
      <main id="main" className="flex-1">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/org/:slug" element={<Organization />} />
            <Route path="/donate" element={<Donate />} />
            <Route path="/track/:code" element={<Track />} />
            <Route path="/experience" element={<Experience />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Navigate to={`/login?mode=signup${window.location.search.replace("?", "&")}`} replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard" element={<DonorDashboard />} />
            <Route path="/portal/organization" element={<OrgPortal />} />
            <Route path="/portal/partner" element={<PartnerPortal />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/:page" element={<Content />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <Toaster />
      <DemoSmsInbox />
      <DemoEmailInbox />
    </div>
  )
}
