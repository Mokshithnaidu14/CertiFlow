import { useEffect, useState } from 'react';
import { api, getToken, login, logout, ROLE_LABEL, savedUser, type User } from './api';
import { BatchDetailView } from './components/BatchDetail';
import { BatchList } from './components/BatchList';
import { NewBatch } from './components/NewBatch';
import { StatePanel } from './components/StatePanel';
import { VerifyPage } from './components/VerifyPage';
import { useLive } from './useLive';

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(savedUser());
  const [page, setPage] = useState<'work' | 'verify'>(
    new URLSearchParams(window.location.search).has('verify') ? 'verify' : 'work',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const refreshKey = useLive(me ? getToken() : null);

  useEffect(() => {
    api<User[]>('/auth/users').then(setUsers).catch(() => setUsers([]));
  }, []);

  async function switchTo(userId: string) {
    setSelected(null);
    if (!userId) {
      logout();
      setMe(null);
      return;
    }
    setMe(await login(userId));
    setPage('work');
  }

  return (
    <div className="app">
      <header>
        <h1>CertiFlow</h1>
        <nav>
          <button className={page === 'work' ? 'active' : ''} onClick={() => setPage('work')}>Work</button>
          <button className={page === 'verify' ? 'active' : ''} onClick={() => setPage('verify')}>Verify a certificate</button>
          <a href="http://localhost:4000" target="_blank" rel="noreferrer">Fake WhatsApp inbox ↗</a>
        </nav>
        <label className="switcher">
          Acting as{' '}
          <select value={me?.id ?? ''} onChange={(e) => switchTo(e.target.value)}>
            <option value="">- choose a person -</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({ROLE_LABEL[u.role]})
              </option>
            ))}
          </select>
        </label>
      </header>

      <main>
        {page === 'verify' ? (
          <VerifyPage />
        ) : !me ? (
          <p className="muted">Choose a person at the top right to start. Anyone can use "Verify a certificate" without logging in.</p>
        ) : (
          <div className="layout">
            <section>
              {me.role === 'CENTRE' && <NewBatch onCreated={setSelected} />}
              {me.role === 'STATE' && <StatePanel refreshKey={refreshKey} onOpen={setSelected} />}
              <BatchList key={me.id} me={me} refreshKey={refreshKey} selected={selected} onSelect={setSelected} />
            </section>
            <section>
              {selected ? (
                <BatchDetailView key={selected} id={selected} refreshKey={refreshKey} />
              ) : (
                <p className="muted">Select a batch to see its details.</p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
