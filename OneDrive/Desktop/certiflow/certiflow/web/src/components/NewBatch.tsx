import { useState } from 'react';
import { api } from '../api';

export function NewBatch({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function create() {
    setError('');
    try {
      const batch = await api<{ id: string }>('/batches', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      onCreated(batch.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h3>New batch</h3>
      <div className="row">
        <input placeholder="e.g. Plumbing - Dec 2026" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={create} disabled={name.trim().length < 3}>Create</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
