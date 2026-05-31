import { describe, expect, it, vi } from 'vitest';
import { createRequireAuth } from '../server/middleware.js';
import { createSessionManager } from '../server/session.js';
import { createEnterpriseBinding } from '../server/enterprise/index.js';
import { enterpriseUser, makeEnterpriseDb, makeMpcManager, session } from './enterprise-test-helpers.js';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };
}

describe('ENT-04: session track discriminator', () => {
  it('defaults session track to anonymous', async () => {
    const db = makeEnterpriseDb();
    const manager = createSessionManager(db, { secret: 'test-secret-32-chars-long-enough-12345' });

    await manager.createSession('user-1', makeRes() as never);

    expect(db.createSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      track: 'anonymous',
    }));
  });

  it('persists enterprise track when requested', async () => {
    const db = makeEnterpriseDb();
    const manager = createSessionManager(db, { secret: 'test-secret-32-chars-long-enough-12345' });

    await manager.createSession('ent-1', makeRes() as never, { track: 'enterprise' });

    expect(db.createSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'ent-1',
      track: 'enterprise',
    }));
  });

  it('attaches active enterprise users to req.enterpriseUser', async () => {
    const db = makeEnterpriseDb();
    const sessionManager = {
      getSession: vi.fn().mockResolvedValue(session({ userId: 'ent-1', track: 'enterprise' })),
      refreshSession: vi.fn().mockResolvedValue(undefined),
    };
    const req: any = {};
    const res = makeRes();
    const next = vi.fn();

    await createRequireAuth(sessionManager as never, db)(req, res as never, next);

    expect(req.enterpriseUser).toEqual(expect.objectContaining({ id: 'ent-1', type: 'enterprise' }));
    expect(req.anonUser).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('deletes and rejects suspended enterprise sessions', async () => {
    const db = makeEnterpriseDb({
      getEnterpriseUserById: vi.fn().mockResolvedValue(enterpriseUser({ status: 'suspended' })),
    });
    const sessionManager = {
      getSession: vi.fn().mockResolvedValue(session({ id: 'sess-ent', userId: 'ent-1', track: 'enterprise' })),
      refreshSession: vi.fn(),
    };
    const res = makeRes();
    const next = vi.fn();

    await createRequireAuth(sessionManager as never, db)({} as never, res as never, next);

    expect(db.deleteSession).toHaveBeenCalledWith('sess-ent');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('status change invalidates live enterprise sessions', async () => {
    const db = makeEnterpriseDb();
    const enterprise = createEnterpriseBinding({
      db,
      mpcManager: makeMpcManager() as never,
      enterpriseConfig: { enabled: true },
    });

    await enterprise.setStatus({ externalIdp: 'scim', externalSub: 'employee-1', status: 'deprovisioned' });

    expect(db.deleteSessionsByUserAndTrack).toHaveBeenCalledWith('ent-1', 'enterprise');
  });
});

