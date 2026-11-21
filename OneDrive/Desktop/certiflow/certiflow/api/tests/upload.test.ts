// MOMENT 1: a spreadsheet with bad rows -> exact problems reported, nothing half-saved.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/infra';
import { app, auth, csvFor, tokenFor } from './helpers';

async function newBatch() {
  const token = await tokenFor('anika');
  const res = await request(app).post('/api/batches').set(auth(token)).send({ name: 'Upload test' }).expect(201);
  return { token, id: res.body.id as string };
}

describe('CSV upload', () => {
  it('reports every bad row and saves nothing', async () => {
    const { token, id } = await newBatch();
    const csv = [
      'name,phone,course,grade',
      'Asha Rao,9876543210,Electrician,A', // row 2: fine
      'B,12345,Electrician,A', // row 3: name too short, bad phone
      'Ravi Kumar,9876543211,,Z', // row 4: no course, bad grade
      'Asha Twin,9876543210,Plumber,B', // row 5: same phone as row 2
    ].join('\n');

    const res = await request(app).put(`/api/batches/${id}/candidates`).set(auth(token)).set('Content-Type', 'text/csv').send(csv);

    expect(res.status).toBe(422);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, field: 'name' }),
        expect.objectContaining({ row: 3, field: 'phone' }),
        expect.objectContaining({ row: 4, field: 'course' }),
        expect.objectContaining({ row: 4, field: 'grade' }),
        expect.objectContaining({ row: 5, field: 'phone' }),
      ]),
    );
    // Row 2 was fine, but it must NOT be saved on its own.
    expect(await prisma.candidate.count({ where: { batchId: id } })).toBe(0);
  });

  it('rejects a file with missing columns', async () => {
    const { token, id } = await newBatch();
    const res = await request(app).put(`/api/batches/${id}/candidates`).set(auth(token)).set('Content-Type', 'text/csv').send('name,phone\nAsha,9876543210');
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('header');
  });

  it('saves a good file completely, and a second upload replaces the first', async () => {
    const { token, id } = await newBatch();
    await request(app).put(`/api/batches/${id}/candidates`).set(auth(token)).set('Content-Type', 'text/csv').send(csvFor(10)).expect(200);
    expect(await prisma.candidate.count({ where: { batchId: id } })).toBe(10);

    await request(app).put(`/api/batches/${id}/candidates`).set(auth(token)).set('Content-Type', 'text/csv').send(csvFor(4)).expect(200);
    expect(await prisma.candidate.count({ where: { batchId: id } })).toBe(4);
  });

  it('a bad second upload leaves the first good upload untouched', async () => {
    const { token, id } = await newBatch();
    await request(app).put(`/api/batches/${id}/candidates`).set(auth(token)).set('Content-Type', 'text/csv').send(csvFor(5)).expect(200);
    await request(app).put(`/api/batches/${id}/candidates`).set(auth(token)).set('Content-Type', 'text/csv').send('name,phone,course,grade\nX,1,,Q').expect(422);
    expect(await prisma.candidate.count({ where: { batchId: id } })).toBe(5);
  });

  it('another centre cannot upload to this batch', async () => {
    const { id } = await newBatch();
    const omar = await tokenFor('omar');
    await request(app).put(`/api/batches/${id}/candidates`).set(auth(omar)).set('Content-Type', 'text/csv').send(csvFor(2)).expect(403);
  });
});
