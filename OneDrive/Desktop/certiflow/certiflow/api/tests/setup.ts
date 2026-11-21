import { afterAll, beforeEach } from 'vitest';
import { closeAll } from '../src/infra';
import { resetDb } from './helpers';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAll();
});
