// STEP 6: public check. No login. Pre-filled when opened from the link printed on the certificate.
import { useEffect, useState } from 'react';

type Result = {
  valid: boolean;
  status?: string;
  number?: string;
  name?: string;
  course?: string;
  grade?: string;
  centre?: string;
  issuedAt?: string;
  message?: string;
};

export function VerifyPage() {
  const params = new URLSearchParams(window.location.search);
  const [number, setNumber] = useState(params.get('verify') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  async function check() {
    setError('');
    setResult(null);
    const res = await fetch(`/api/verify/${encodeURIComponent(number.trim())}?code=${encodeURIComponent(code.trim())}`);
    const body = (await res.json().catch(() => ({}))) as Result & { error?: string };
    if (res.status === 429) setError(body.error ?? 'Too many checks, wait a minute');
    else setResult(body);
  }

  useEffect(() => {
    if (number && code) void check();
    // run once if the page was opened from a certificate link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card verify">
      <h2>Is this certificate genuine?</h2>
      <p className="muted">Enter the certificate number and verification code printed on it.</p>
      <div className="row">
        <input placeholder="PSM-000001" value={number} onChange={(e) => setNumber(e.target.value)} />
        <input placeholder="Verification code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button onClick={check} disabled={!number || !code}>Check</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result &&
        (result.valid ? (
          <div className="result good">
            <h3>✔ Genuine and valid</h3>
            <p>{result.number}: <b>{result.name}</b> completed <b>{result.course}</b> (grade {result.grade}) at {result.centre}.</p>
            <p className="muted">Issued {result.issuedAt && new Date(result.issuedAt).toLocaleDateString()}</p>
          </div>
        ) : result.status === 'REVOKED' ? (
          <div className="result bad">
            <h3>✘ Not valid: this certificate has been cancelled</h3>
            <p>{result.number} was issued to {result.name} but is no longer valid.</p>
          </div>
        ) : (
          <div className="result bad">
            <h3>✘ Not found</h3>
            <p>{result.message ?? 'No certificate matches this number and code.'}</p>
          </div>
        ))}
    </div>
  );
}
