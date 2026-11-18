/**
 * Roles at PLACES (ADR-0030): the whole organization, or one branch.
 *
 * The organization used here: Sri Vidya, branches KPHB and Ameerpet (AMP).
 * People:
 *   Organization admin          whole organization
 *   Ravi    Branch admin        KPHB
 *   Sita    Branch admin        Ameerpet
 *   Lakshmi Principal           KPHB
 *   Divya   Director            whole organization
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { branchId, createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Roles at places', () => {
  let app: INestApplication;
  let admin: string;
  let ravi: string; // Branch admin, KPHB
  let lakshmi: string; // Principal, KPHB
  let divya: string; // Director
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Creates a user as the organization admin and returns their id. */
  async function addUser(email: string, roles: object[]) {
    const res = await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({ name: email.split('@')[0], email, password: 'Password@123', roles })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const superAdmin = await loginSuperAdmin(app);
    const orgId = await createOrganization(app, superAdmin, 'sri-vidya', 'admin@srividya.test', {
      branches: [
        { name: 'KPHB', code: 'KPHB' },
        { name: 'Ameerpet', code: 'AMP' },
      ],
    });
    admin = await loginUser(app, 'admin@srividya.test', 'Admin@12345');

    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    for (const r of roles.body) ids[r.name] = r.id;
    ids.KPHB = await branchId(app, superAdmin, orgId, 'KPHB');
    ids.AMP = await branchId(app, superAdmin, orgId, 'AMP');

    await addUser('ravi@srividya.test', [{ roleId: ids['Branch admin'], branchId: ids.KPHB }]);
    await addUser('sita@srividya.test', [{ roleId: ids['Branch admin'], branchId: ids.AMP }]);
    await addUser('lakshmi@srividya.test', [{ roleId: ids.Principal, branchId: ids.KPHB }]);
    await addUser('divya@srividya.test', [{ roleId: ids.Director }]);
    ravi = await loginUser(app, 'ravi@srividya.test', 'Password@123');
    lakshmi = await loginUser(app, 'lakshmi@srividya.test', 'Password@123');
    divya = await loginUser(app, 'divya@srividya.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a branch admin sees only their own branch', async () => {
    const list = await api().get('/api/v1/branches').set(as(ravi)).expect(200);
    expect(list.body.map((b: { code: string }) => b.code)).toEqual(['KPHB']);
    await api().get(`/api/v1/branches/${ids.AMP}`).set(as(ravi)).expect(404);

    const dashboard = await api().get('/api/v1/dashboard').set(as(ravi)).expect(200);
    expect(dashboard.body).toMatchObject({ branches: 1 });
  });

  it('a branch admin adds staff only to their branch, with roles within their own', async () => {
    const addAt = (roleId: string, place: object) =>
      api()
        .post('/api/v1/users')
        .set(as(ravi))
        .send({
          name: 'New',
          email: `new-${Math.random().toString(36).slice(2)}@srividya.test`,
          password: 'Password@123',
          roles: [{ roleId, ...place }],
        });

    await addAt(ids['Junior faculty'], { branchId: ids.KPHB }).expect(201);
    await addAt(ids['Junior faculty'], { branchId: ids.AMP }).expect(403);
    await addAt(ids['Junior faculty'], {}).expect(403); // the whole organization
    await addAt(ids.Principal, { branchId: ids.KPHB }).expect(403); // more than Ravi has
    await addAt(ids['Organization admin'], { branchId: ids.KPHB }).expect(400);
  });

  it("a branch admin sees their branch's staff, not other branches or the organization admin", async () => {
    const users = await api().get('/api/v1/users').set(as(ravi)).expect(200);
    const emails = users.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining(['ravi@srividya.test', 'lakshmi@srividya.test']));
    expect(emails).not.toContain('sita@srividya.test');
    expect(emails).not.toContain('admin@srividya.test');
    expect(emails).not.toContain('divya@srividya.test');
  });

  it("a branch admin can't create roles: roles belong to the whole organization", async () => {
    await api()
      .post('/api/v1/roles')
      .set(as(ravi))
      .send({ name: 'Branch clerk', permissions: ['access.user.view'] })
      .expect(403);
  });

  it('someone teaching at two branches: each branch admin manages only their part', async () => {
    const kiranId = await addUser('kiran@srividya.test', [
      { roleId: ids['Senior faculty'], branchId: ids.KPHB },
      { roleId: ids['Senior faculty'], branchId: ids.AMP },
    ]);
    const kiran = await api().get(`/api/v1/users/${kiranId}`).set(as(ravi)).expect(200);
    const atKphb = kiran.body.roles.find(
      (r: { branch: { id: string } }) => r.branch.id === ids.KPHB,
    );
    const atAmp = kiran.body.roles.find((r: { branch: { id: string } }) => r.branch.id === ids.AMP);
    expect(atKphb.branch.name).toBe('KPHB');

    // Ravi can't touch the Ameerpet role, nor deactivate Kiran (who also works at Ameerpet).
    await api().delete(`/api/v1/users/${kiranId}/roles/${atAmp.id}`).set(as(ravi)).expect(403);
    await api().post(`/api/v1/users/${kiranId}/deactivate`).set(as(ravi)).expect(403);
    // ...but can take away the KPHB role; then Kiran is no longer Ravi's staff.
    await api().delete(`/api/v1/users/${kiranId}/roles/${atKphb.id}`).set(as(ravi)).expect(200);
    await api().get(`/api/v1/users/${kiranId}`).set(as(ravi)).expect(404);
  });

  it('a principal runs their branch and may appoint its branch admin', async () => {
    const users = await api().get('/api/v1/users').set(as(lakshmi)).expect(200);
    const emails = users.body.items.map((u: { email: string }) => u.email);
    expect(emails).toContain('ravi@srividya.test');
    expect(emails).not.toContain('sita@srividya.test');

    await api()
      .post('/api/v1/users')
      .set(as(lakshmi))
      .send({
        name: 'Anil',
        email: 'anil@srividya.test',
        password: 'Password@123',
        roles: [{ roleId: ids['Branch admin'], branchId: ids.KPHB }],
      })
      .expect(201);
    await api()
      .post('/api/v1/users')
      .set(as(lakshmi))
      .send({
        name: 'Anitha',
        email: 'anitha@srividya.test',
        password: 'Password@123',
        roles: [{ roleId: ids['Branch admin'], branchId: ids.AMP }],
      })
      .expect(403);
  });

  it('a director sees every branch and all staff, and changes nothing', async () => {
    const branches = await api().get('/api/v1/branches').set(as(divya)).expect(200);
    expect(branches.body).toHaveLength(2);
    const users = await api().get('/api/v1/users').set(as(divya)).expect(200);
    expect(users.body.items.map((u: { email: string }) => u.email)).toEqual(
      expect.arrayContaining(['sita@srividya.test', 'ravi@srividya.test']),
    );
    await api()
      .post('/api/v1/users')
      .set(as(divya))
      .send({
        name: 'X',
        email: 'x@srividya.test',
        password: 'Password@123',
        roles: [{ roleId: ids['Junior faculty'], branchId: ids.KPHB }],
      })
      .expect(403);
  });

  it('the audit log shows names, and each branch admin sees their own branch', async () => {
    const mine = await api().get('/api/v1/audit-logs').set(as(ravi)).expect(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    for (const entry of mine.body.items) expect(entry.branchId).toBe(ids.KPHB);
    expect(mine.body.items.map((e: { actorName: string }) => e.actorName)).toContain('ravi');

    const all = await api().get('/api/v1/audit-logs?pageSize=100').set(as(admin)).expect(200);
    const places = new Set(all.body.items.map((e: { branchId: string | null }) => e.branchId));
    expect(places.has(ids.AMP)).toBe(true);
    expect(places.has(null)).toBe(true);
  });
});
