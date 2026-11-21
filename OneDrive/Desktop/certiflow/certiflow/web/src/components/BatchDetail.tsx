import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type BatchDetail, type RowError } from '../api';
import { StatusBadge } from './BatchList';

export function BatchDetailView({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<BatchDetail>(`/batches/${id}`)
      .then((b) => {
        setBatch(b);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load, refreshKey]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setMessage('');
    setRowErrors([]);
    try {
      await action();
      setMessage(done);
      setReason('');
      load();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && Array.isArray(e.details)) setRowErrors(e.details as RowError[]);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const text = await file.text();
    await run(
      () => api(`/batches/${id}/candidates`, { method: 'PUT', body: text, headers: { 'Content-Type': 'text/csv' } }),
      'Candidates saved',
    );
  }

  const post = (path: string, body?: object) =>
    api(`/batches/${id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });

  if (!batch) return <div className="card">{error ? <p className="error">{error}</p> : 'Loading...'}</div>;
  const p = batch.permissions;

  return (
    <div className="card">
      <div className="row space">
        <h2>{batch.name}</h2>
        <StatusBadge status={batch.status} />
      </div>
      <p className="muted">
        {batch.centre} · round {batch.round} · {batch.candidates.length} candidates
        {batch.escalatedAt && <span className="tag warn">escalated</span>}
      </p>
      {batch.lastReason && <p className="notice">Reason given: {batch.lastReason}</p>}
      {batch.approvals.length > 0 && (
        <p>Approvals this round: {batch.approvals.map((a) => `${a.by} (${a.stage.toLowerCase()})`).join(', ')}</p>
      )}

      {/* ---- actions: only the buttons this person is allowed to use are shown ---- */}
      {p.canEdit && (
        <div className="actions">
          <label className="file">
            Upload candidates CSV (name, phone, course, grade):{' '}
            <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      )}
      <div className="actions">
        {p.canSubmit && <button disabled={busy} onClick={() => run(() => post('submit'), 'Sent for approval')}>Send for approval</button>}
        {p.canApprove && <button disabled={busy} onClick={() => run(() => post('approve'), 'Approved')}>Approve</button>}
        {p.canWithdraw && <button disabled={busy} className="secondary" onClick={() => run(() => post('withdraw'), 'Approval withdrawn')}>Withdraw my approval</button>}
      </div>
      {(p.canSendBack || p.canRevoke) && (
        <div className="actions">
          <input placeholder="Reason (needed to send back, reject or cancel)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {p.canSendBack && (
            <>
              <button disabled={busy || reason.trim().length < 5} className="secondary" onClick={() => run(() => post('send-back', { reason }), 'Sent back to centre')}>Send back</button>
              <button disabled={busy || reason.trim().length < 5} className="danger" onClick={() => run(() => post('reject', { reason }), 'Rejected')}>Reject</button>
            </>
          )}
        </div>
      )}

      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}
      {rowErrors.length > 0 && (
        <table className="errors">
          <thead><tr><th>Row</th><th>Field</th><th>Problem</th></tr></thead>
          <tbody>
            {rowErrors.map((r, i) => (
              <tr key={i}><td>{r.row}</td><td>{r.field}</td><td>{r.message}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Candidates</h3>
      <table>
        <thead>
          <tr><th>Name</th><th>Phone</th><th>Course</th><th>Grade</th><th>Certificate</th>{p.canRevoke && <th></th>}</tr>
        </thead>
        <tbody>
          {batch.candidates.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.phone}</td>
              <td>{c.course}</td>
              <td>{c.grade}</td>
              <td>
                {c.certificate ? (
                  <>
                    {c.certificate.number} · <b>{c.certificate.status}</b> · WhatsApp: {c.certificate.delivery}
                    {c.certificate.deliveryAttempts > 1 && <span className="muted small"> ({c.certificate.deliveryAttempts} tries)</span>}
                  </>
                ) : batch.status === 'APPROVED' ? 'issuing...' : '-'}
              </td>
              {p.canRevoke && (
                <td>
                  {c.certificate?.status === 'VALID' && (
                    <button
                      className="danger small"
                      disabled={busy || reason.trim().length < 5}
                      title="Type a reason above first"
                      onClick={() => run(() => api(`/certificates/${c.certificate!.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Certificate cancelled')}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Timeline (who did what, when)</h3>
      <ul className="timeline">
        {batch.timeline.map((t) => (
          <li key={t.id}>
            <span className="muted small">{new Date(t.at).toLocaleString()}</span> <b>{t.by}</b> ({t.role.toLowerCase()}) - {t.action}
            {t.details && <span className="muted small"> {JSON.stringify(t.details)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
