import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createScimRouter } from '../server/enterprise/scim.js';
import { createEnterpriseBinding } from '../server/enterprise/index.js';
import { makeEnterpriseDb, makeMpcManager } from './enterprise-test-helpers.js';

function appWithScim(overrides: any = {}) {
  const app = express();
  const db = overrides.db ?? makeEnterpriseDb({
    getEnterpriseUserByExternalId: vi.fn().mockResolvedValue(null),
  });
  const enterprise = overrides.enterprise ?? createEnterpriseBinding({
    db,
    mpcManager: makeMpcManager() as never,
    enterpriseConfig: { enabled: true, scim: { enabled: true, bearerToken: 'secret' } },
  });
  app.use('/scim/v2', createScimRouter({
    db,
    enterprise,
    enterpriseConfig: {
      enabled: true,
      scim: {
        enabled: true,
        bearerToken: 'secret',
        attributeMapping: { userName: 'email', 'name.formatted': 'displayName' },
      },
    },
    rateLimiting: { auth: { limit: 1000, windowMs: 60_000 } },
  }));
  return { app, db, enterprise };
}

const auth = { Authorization: 'Bearer secret' };

describe('ENT-05: SCIM Users bearer auth', () => {
  it('rejects missing bearer before provisioning', async () => {
    const { app, db } = appWithScim();
    await request(app).post('/scim/v2/Users').send({ userName: 'a@example.com' }).expect(401);
    expect(db.createEnterpriseUser).not.toHaveBeenCalled();
  });

  it('rejects wrong bearer before provisioning', async () => {
    const { app, db } = appWithScim();
    await request(app).post('/scim/v2/Users').set('Authorization', 'Bearer wrong').send({ userName: 'a@example.com' }).expect(401);
    expect(db.createEnterpriseUser).not.toHaveBeenCalled();
  });
});

describe('ENT-05: SCIM Users lifecycle', () => {
  it('provisions a user through linkIdentity', async () => {
    const { app, db } = appWithScim();
    const res = await request(app)
      .post('/scim/v2/Users')
      .set(auth)
      .send({ userName: 'employee@example.com', externalId: 'employee-9', active: true, name: { formatted: 'Employee Nine' } })
      .expect(201);

    expect(res.body.id).toBe('employee-9');
    expect(res.body.externalId).toBe('employee-9');
    expect(db.createEnterpriseUser).toHaveBeenCalledWith(expect.objectContaining({
      externalIdp: 'scim',
      externalSub: 'employee-9',
      scimId: 'employee-9',
    }));
  });

  it('returns existing binding for duplicate provisioning without minting twice', async () => {
    const db = makeEnterpriseDb();
    const { app } = appWithScim({ db });

    await request(app)
      .post('/scim/v2/Users')
      .set(auth)
      .send({ userName: 'employee@example.com', externalId: 'employee-1' })
      .expect(200);

    expect(db.createEnterpriseUser).not.toHaveBeenCalled();
  });

  it('supports GET by id and filtered GET', async () => {
    const { app } = appWithScim({ db: makeEnterpriseDb() });

    await request(app).get('/scim/v2/Users/employee-1').set(auth).expect(200);
    const filtered = await request(app)
      .get('/scim/v2/Users')
      .query({ filter: 'externalId eq "employee-1"' })
      .set(auth)
      .expect(200);

    expect(filtered.body.totalResults).toBe(1);
    expect(filtered.body.Resources[0].externalId).toBe('employee-1');
  });

  it('rejects unsupported filters', async () => {
    const { app } = appWithScim();
    await request(app)
      .get('/scim/v2/Users')
      .query({ filter: 'emails.value co "example.com"' })
      .set(auth)
      .expect(400);
  });

  it('PATCH active:false deprovisions through enterprise status path', async () => {
    const db = makeEnterpriseDb();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: makeMpcManager() as never,
      enterpriseConfig: { enabled: true },
    });
    const { app } = appWithScim({ db, enterprise });

    await request(app)
      .patch('/scim/v2/Users/employee-1')
      .set(auth)
      .send({ Operations: [{ op: 'Replace', path: 'active', value: false }] })
      .expect(200);

    expect(db.setEnterpriseUserStatus).toHaveBeenCalledWith('ent-1', 'deprovisioned');
    expect(db.deleteSessionsByUserAndTrack).toHaveBeenCalledWith('ent-1', 'enterprise');
  });

  it('DELETE revokes instead of hard-deleting by default', async () => {
    const db = makeEnterpriseDb();
    const { app } = appWithScim({ db });

    await request(app).delete('/scim/v2/Users/employee-1').set(auth).expect(204);

    expect(db.setEnterpriseUserStatus).toHaveBeenCalledWith('ent-1', 'deprovisioned');
    expect(db.deleteEnterpriseUser).not.toHaveBeenCalled();
  });
});

