// State office: escalation alerts and queue health.
import { useEffect, useState } from 'react';
import { api } from '../api';

type Note = { id: string; message: string; batchId: string | null; createdAt: string };
type QueueStats = { waiting: number; active: number; delayed: number; failed: number; undelivered: number };

export function StatePanel({ refreshKey, onOpen }: { refreshKey: number; onOpen: (id: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [queue, setQueue] = useState<QueueStats | null>(null);

  useEffect(() => {
    api<Note[]>('/notifications').then(setNotes).catch(() => undefined);
    api<QueueStats>('/ops/queue').then(setQueue).catch(() => undefined);
  }, [refreshKey]);

  return (
    <div className="card">
      <h3>Alerts</h3>
      {notes.length === 0 ? (
        <p className="muted">No stuck batches.</p>
      ) : (
        <ul className="alerts">
          {notes.slice(0, 5).map((n) => (
            <li key={n.id} onClick={() => n.batchId && onOpen(n.batchId)}>
              <span className="muted small">{new Date(n.createdAt).toLocaleTimeString()}</span> {n.message}
            </li>
          ))}
        </ul>
      )}
      {queue && (
        <p className="muted small">
          Certificate queue - waiting: {queue.waiting}, running: {queue.active}, retrying: {queue.delayed}, not yet delivered: {queue.undelivered}
        </p>
      )}
    </div>
  );
}
