import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Flag, Sparkles, Store, XCircle } from 'lucide-react'
import { DonationDetail } from '../components/DonationDetail'
import { UpdatedLabel } from '../components/domain'
import { RequireAuth } from '../components/auth'
import { Button, ErrorState, Field, Modal, Spinner, Textarea, btn } from '../components/ui'
import { useAction, useBackend, useData } from '../state/app'
import { canTransition } from '../lib/status'
import { ReportModal } from './Organization'

export default function Track() {
  return (
    <RequireAuth title="Sign in to track this donation" body="Tracking details are private to the donor, the receiving organisation and the assigned partner.">
      <TrackInner />
    </RequireAuth>
  )
}

function TrackInner() {
  const { code = '' } = useParams()
  const backend = useBackend()
  const { data: view, error, loading, reload, updatedAt } = useData((b) => b.getDonation(code), [code], { poll: 10_000 })
  const { run, busy } = useAction()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reportOpen, setReportOpen] = useState(false)

  if (loading && !view) return <Spinner />
  if (error && !view) return <div className="container-x py-16"><ErrorState error={error} onRetry={reload} /></div>
  if (!view) return null
  const r = view.request
  const isDonor = view.viewer === 'donor'

  const actions = isDonor && (
    <>
      {canTransition(r.status, 'delivered_pending_receipt_confirmation', 'donor', r.deliveryMethod) && (
        <Button icon={<Store className="h-4 w-4" />} loading={busy === 'drop'} onClick={() => run('drop', () => backend.confirmDropoff(r.id), 'Marked as dropped off — the organisation will confirm receipt')}>I’ve dropped it off</Button>
      )}
      {canTransition(r.status, 'cancelled', 'donor', r.deliveryMethod) && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>Cancel request</Button>}
      <Button variant="ghost" icon={<Flag className="h-4 w-4" />} onClick={() => setReportOpen(true)}>Report a problem</Button>
      <Link to={`/experience?request=${r.code}`} className={btn('ghost')}><Sparkles className="h-4 w-4" /> 3D story</Link>
    </>
  )

  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to={isDonor ? '/dashboard' : view.viewer === 'org' ? '/portal/organization' : view.viewer === 'partner' ? '/portal/partner' : '/admin'} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-forest-400 hover:text-forest"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <UpdatedLabel at={updatedAt} />
      </div>
      <h1 className="display-md mb-8 text-forest">Donation tracking</h1>
      <DonationDetail view={view} actions={actions} />

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this request?">
        <p className="mb-4 text-[14px] text-charcoal-600">The organisation{view.partner ? ' and your delivery partner' : ''} will be notified.</p>
        <Field label="Reason" required>{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Items no longer available" />}</Field>
        <Button variant="danger" className="mt-5 w-full" loading={busy === 'cancel'} onClick={async () => { const x = await run('cancel', () => backend.cancelDonation(r.id, reason), 'Request cancelled'); if (x.ok) setCancelOpen(false) }}>Cancel request</Button>
      </Modal>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} requestId={r.id} orgId={r.orgId} />
    </div>
  )
}
