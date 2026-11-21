// NEVER: acting as someone else; a stranger seeing someone else's data.
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, auth, createBatch, tokenFor } from './helpers';

describe('security', () => {
  it('rejects requests with no login', async () => {
    await request(app).get('/api/batches').expect(401);
  });

  it('rejects a token that was edited to claim a higher role', async () => {
    const token = await tokenFor('anika');
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.role = 'STATE';
    claims.sub = 'farah';
    const forged = [header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.');
    await request(app).get('/api/batches').set(auth(forged)).expect(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const fake = jwt.sign({ name: 'Farah', role: 'STATE' }, 'not-the-real-secret', { subject: 'farah' });
    await request(app).get('/api/batches').set(auth(fake)).expect(401);
  });

  it('rejects an unsigned ("alg: none") token', async () => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'farah', name: 'Farah', role: 'STATE' })}.`;
    await request(app).get('/api/batches').set(auth(unsigned)).expect(401);
  });

  it('ignores a role sent in the login request', async () => {
    const res = await request(app).post('/api/auth/login').send({ userId: 'anika', role: 'STATE' }).expect(200);
    expect(res.body.user.role).toBe('CENTRE');
  });

  it('a centre cannot see another centre\'s batch', async () => {
    const id = await createBatch(2);
    const omar = await tokenFor('omar');
    await request(app).get(`/api/batches/${id}`).set(auth(omar)).expect(403);
    const list = await request(app).get('/api/batches').set(auth(omar)).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('an officer cannot see batches from another district', async () => {
    const id = await createBatch(2);
    const ravi = await tokenFor('ravi');
    await request(app).get(`/api/batches/${id}`).set(auth(ravi)).expect(403);
  });

  it('rejects bad ids and bad input', async () => {
    const dev = await tokenFor('dev');
    await request(app).post('/api/batches/not-a-uuid/approve').set(auth(dev)).expect(400);
    const anika = await tokenFor('anika');
    await request(app).post('/api/batches').set(auth(anika)).send({ name: '' }).expect(400);
  });

  it('only the state office can cancel certificates', async () => {
    const dev = await tokenFor('dev');
    await request(app)
      .post('/api/certificates/00000000-0000-4000-8000-000000000000/revoke')
      .set(auth(dev))
      .send({ reason: 'trying my luck' })
      .expect(403);
  });
});
