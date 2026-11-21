import { useEffect, useState } from 'react';
import { api, type BatchSummary, type User } from '../api';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status.toLowerCase()}`}>{status.replace(/_/g, ' ')}</span>;
}

export function BatchList(props: { me: User; refreshKey: number; selected: string | null; onSelect: (id: string) => void }) {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [onlyMine, setOnlyMine] = useState(props.me.role !== 'CENTRE');
  const [error, setError] = useState('');

  useEffect(() => {
    api<BatchSummary[]>('/batches')
      .then((b) => {
        setBatches(b);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [props.refreshKey, props.me.id]);

  const shown = onlyMine ? batches.filter((b) => b.waitingForMe) : batches;

  return (
    <div className="card">
      <div className="row space">
        <h3>Batches</h3>
        {props.me.role !== 'CENTRE' && (
          <label>
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only waiting for me
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {shown.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Batch</th><th>Status</th><th>Candidates</th><th>Approved by</th></tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} className={b.id === props.selected ? 'selected' : ''} onClick={() => props.onSelect(b.id)}>
                <td>
                  {b.name}
                  <div className="muted small">{b.centre}</div>
                  {b.waitingForMe && <span className="tag">waiting for you</span>}
                  {b.escalatedAt && <span className="tag warn">escalated</span>}
                </td>
                <td><StatusBadge status={b.status} /></td>
                <td>{b.candidateCount}</td>
                <td>{b.approvedBy.join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
