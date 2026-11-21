// STEP 5: a stand-in for the WhatsApp Business API.
// It behaves like the real thing on a bad day:
//   - FAIL_RATE of sends fail with 503 (nothing delivered)
//   - SLOW_RATE of sends ARE delivered but the answer comes back too late, so the caller times out
//     and will retry. That is exactly the case where a naive system sends twice.
//   - Like real providers, it remembers idempotency keys: the same key is only ever delivered once.
// No dependencies: plain Node.js.
const http = require('node:http');

const PORT = Number(process.env.PORT ?? 4000);
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.3);
const SLOW_RATE = Number(process.env.SLOW_RATE ?? 0.1);
const SLOW_MS = Number(process.env.SLOW_MS ?? 8000);

const delivered = new Map(); // idempotencyKey -> message  (these are "the phones")
const stats = { requests: 0, failed: 0, slow: 0, duplicatesIgnored: 0 };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) reject(new Error('too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleSend(req, res) {
  let msg;
  try {
    msg = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'invalid body' });
  }
  const key = req.headers['idempotency-key'] || msg.idempotencyKey;
  if (!key || !msg.to || !msg.text) return json(res, 400, { error: 'to, text and idempotency key are required' });

  stats.requests++;
  const roll = Math.random();

  if (roll < FAIL_RATE) {
    stats.failed++;
    return json(res, 503, { error: 'temporarily unavailable' });
  }

  if (delivered.has(key)) {
    stats.duplicatesIgnored++;
    return json(res, 200, { id: key, duplicate: true });
  }

  delivered.set(key, { id: key, to: msg.to, text: msg.text, link: msg.link, deliveredAt: new Date().toISOString() });

  if (roll < FAIL_RATE + SLOW_RATE) {
    stats.slow++;
    setTimeout(() => json(res, 200, { id: key, duplicate: false }), SLOW_MS); // delivered, but answers late
    return;
  }
  json(res, 200, { id: key, duplicate: false });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inboxPage(res) {
  const byPhone = new Map();
  for (const m of delivered.values()) {
    if (!byPhone.has(m.to)) byPhone.set(m.to, []);
    byPhone.get(m.to).push(m);
  }
  const rows = [...byPhone.entries()]
    .map(([phone, msgs]) => `<tr><td>${escapeHtml(phone)}</td><td>${msgs.length}</td><td>${msgs
      .map((m) => `${escapeHtml(m.text)} <a href="${escapeHtml(m.link)}" target="_blank">Download PDF</a>`)
      .join('<br>')}</td></tr>`)
    .join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<title>Fake WhatsApp inbox</title>
<style>body{font-family:system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#e8f5e9}</style>
</head><body>
<h1>Fake WhatsApp - phones</h1>
<p>Requests: ${stats.requests} | Failed (503): ${stats.failed} | Slow (delivered, answered late): ${stats.slow} | Duplicates ignored: ${stats.duplicatesIgnored}</p>
<p>Phones that received a message: <b>${byPhone.size}</b>. Messages per phone should always be 1.</p>
<table><tr><th>Phone</th><th>Messages</th><th>Message</th></tr>${rows || '<tr><td colspan="3">No messages yet</td></tr>'}</table>
</body></html>`);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && pathname === '/messages') return void handleSend(req, res);
  if (req.method === 'GET' && pathname === '/messages') return json(res, 200, { stats, messages: [...delivered.values()] });
  if (req.method === 'POST' && pathname === '/reset') {
    delivered.clear();
    Object.keys(stats).forEach((k) => (stats[k] = 0));
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && (pathname === '/' || pathname === '/inbox')) return inboxPage(res);
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`fake-whatsapp on :${PORT} (fail ${FAIL_RATE}, slow ${SLOW_RATE})`));
