/**
 * Roles at PLACES (ADR-0018): a Campus admin runs one campus, a Principal one institution.
 *
 * The organization used here:
 *   Sri Vidya Junior College (SVJC)  - campuses Kukatpally (KKP) and Ameerpet (AMP)
 *   Sri Vidya Degree College (SVDC)  - campus Main (MAIN)
 * People:
 *   Organization admin       whole organization
 *   Ravi   Campus admin      Kukatpally
 *   Sita   Campus admin      Ameerpet
 *   Lakshmi Principal        Sri Vidya Junior College
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Roles at places', () => {
  let app: INestApplication;
  let admin: string;
  let ravi: string; // Campus admin, Kukatpally
  let lakshmi: string; // Principal, SVJC
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
    await createOrganization(app, superAdmin, 'sri-vidya', 'admin@srividya.test');
    admin = await loginUser(app, 'admin@srividya.test', 'Admin@12345');

    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    for (const r of roles.body) ids[r.name] = r.id;

    const svjc = await api()
      .post('/api/v1/institutions')
      .set(as(admin))
      .send({ name: 'Sri Vidya Junior College', code: 'SVJC', type: 'JUNIOR_COLLEGE' });
    const svdc = await api()
      .post('/api/v1/institutions')
      .set(as(admin))
      .send({ name: 'Sri Vidya Degree College', code: 'SVDC', type: 'DEGREE_COLLEGE' });
    ids.SVJC = svjc.body.id;
    ids.SVDC = svdc.body.id;
    for (const [institution, code, name] of [
      ['SVJC', 'KKP', 'Kukatpally'],
      ['SVJC', 'AMP', 'Ameerpet'],
      ['SVDC', 'MAIN', 'Main'],
    ]) {
      const campus = await api()
        .post(`/api/v1/institutions/${ids[institution]}/campuses`)
        .set(as(admin))
        .send({ name, code });
      ids[code] = campus.body.id;
    }

    await addUser('ravi@srividya.test', [{ roleId: ids['Campus admin'], campusId: ids.KKP }]);
    await addUser('sita@srividya.test', [{ roleId: ids['Campus admin'], campusId: ids.AMP }]);
    await addUser('lakshmi@srividya.test', [{ roleId: ids.Principal, institutionId: ids.SVJC }]);
    ravi = await loginUser(app, 'ravi@srividya.test', 'Password@123');
    lakshmi = await loginUser(app, 'lakshmi@srividya.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a campus admin sees only their own campus', async () => {
    const list = await api().get('/api/v1/institutions').set(as(ravi)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].code).toBe('SVJC');
    expect(list.body[0].campuses.map((c: { code: string }) => c.code)).toEqual(['KKP']);

    const detail = await api().get(`/api/v1/institutions/${ids.SVJC}`).set(as(ravi)).expect(200);
    expect(detail.body.campuses.map((c: { code: string }) => c.code)).toEqual(['KKP']);
    await api().get(`/api/v1/institutions/${ids.SVDC}`).set(as(ravi)).expect(404);

    await api()
      .patch(`/api/v1/campuses/${ids.KKP}`)
      .set(as(ravi))
      .send({ name: 'Kukatpally Campus' })
      .expect(200);
    await api()
      .patch(`/api/v1/campuses/${ids.AMP}`)
      .set(as(ravi))
      .send({ name: 'Taken over' })
      .expect(403);
  });

  it('a campus admin adds staff only to their campus, with roles within their own', async () => {
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

    await addAt(ids['Junior faculty'], { campusId: ids.KKP }).expect(201);
    await addAt(ids['Junior faculty'], { campusId: ids.AMP }).expect(403);
    await addAt(ids['Junior faculty'], { institutionId: ids.SVJC }).expect(403);
    await addAt(ids['Junior faculty'], {}).expect(403); // the whole organization
    await addAt(ids.Principal, { campusId: ids.KKP }).expect(403); // more than Ravi has
    await addAt(ids['Organization admin'], { campusId: ids.KKP }).expect(400);
  });

  it("a campus admin sees their campus's staff, not other campuses or the organization admin", async () => {
    const users = await api().get('/api/v1/users').set(as(ravi)).expect(200);
    const emails = users.body.items.map((u: { email: string }) => u.email);
    expect(emails).toContain('ravi@srividya.test');
    expect(emails).not.toContain('sita@srividya.test');
    expect(emails).not.toContain('admin@srividya.test');
    expect(emails).not.toContain('lakshmi@srividya.test');
  });

  it("a campus admin can't create roles: roles belong to the whole organization", async () => {
    await api()
      .post('/api/v1/roles')
      .set(as(ravi))
      .send({ name: 'Campus clerk', permissions: ['access.user.view'] })
      .expect(403);
  });

  it('someone teaching at two campuses: each campus admin manages only their part', async () => {
    const kiranId = await addUser('kiran@srividya.test', [
      { roleId: ids['Senior faculty'], campusId: ids.KKP },
      { roleId: ids['Senior faculty'], campusId: ids.AMP },
    ]);
    const kiran = await api().get(`/api/v1/users/${kiranId}`).set(as(ravi)).expect(200);
    const atKkp = kiran.body.roles.find((r: { campus: { id: string } }) => r.campus.id === ids.KKP);
    const atAmp = kiran.body.roles.find((r: { campus: { id: string } }) => r.campus.id === ids.AMP);
    expect(atKkp.campus.name).toBe('Kukatpally Campus');

    // Ravi can't touch the Ameerpet role, nor deactivate Kiran (who also works at Ameerpet).
    await api().delete(`/api/v1/users/${kiranId}/roles/${atAmp.id}`).set(as(ravi)).expect(403);
    await api().post(`/api/v1/users/${kiranId}/deactivate`).set(as(ravi)).expect(403);
    // ...but can take away the Kukatpally role; then Kiran is no longer Ravi's staff.
    await api().delete(`/api/v1/users/${kiranId}/roles/${atKkp.id}`).set(as(ravi)).expect(200);
    await api().get(`/api/v1/users/${kiranId}`).set(as(ravi)).expect(404);
  });

  it('a principal runs their institution and all its campuses, nothing else', async () => {
    const users = await api().get('/api/v1/users').set(as(lakshmi)).expect(200);
    const emails = users.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining(['ravi@srividya.test', 'sita@srividya.test']));
    expect(emails).not.toContain('admin@srividya.test');

    const list = await api().get('/api/v1/institutions').set(as(lakshmi)).expect(200);
    expect(list.body.map((i: { code: string }) => i.code)).toEqual(['SVJC']);
    expect(list.body[0].campuses).toHaveLength(2);

    await api()
      .patch(`/api/v1/institutions/${ids.SVJC}`)
      .set(as(lakshmi))
      .send({ name: 'Sri Vidya Junior College' })
      .expect(200);
    await api()
      .patch(`/api/v1/institutions/${ids.SVDC}`)
      .set(as(lakshmi))
      .send({ name: 'Taken over' })
      .expect(403);
    await api()
      .post('/api/v1/institutions')
      .set(as(lakshmi))
      .send({ name: 'New college', code: 'NEW', type: 'SCHOOL' })
      .expect(403);

    // A principal may appoint a campus admin in their institution.
    await api()
      .post('/api/v1/users')
      .set(as(lakshmi))
      .send({
        name: 'Anil',
        email: 'anil@srividya.test',
        password: 'Password@123',
        roles: [{ roleId: ids['Campus admin'], campusId: ids.AMP }],
      })
      .expect(201);
  });

  it('a campus with staff assigned cannot be deleted', async () => {
    const res = await api().delete(`/api/v1/campuses/${ids.AMP}`).set(as(admin)).expect(400);
    expect(res.body.message).toBe(
      'Some users still have roles at this campus; take those roles away first',
    );
  });

  it('the audit log shows names, and each admin sees their own part', async () => {
    const mine = await api().get('/api/v1/audit-logs').set(as(ravi)).expect(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    for (const entry of mine.body.items) expect(entry.campusId).toBe(ids.KKP);
    expect(mine.body.items.map((e: { actorName: string }) => e.actorName)).toContain('ravi');

    const all = await api().get('/api/v1/audit-logs?pageSize=100').set(as(admin)).expect(200);
    const places = new Set(all.body.items.map((e: { campusId: string | null }) => e.campusId));
    expect(places.has(ids.AMP)).toBe(true);
    expect(places.has(null)).toBe(true);
  });
});
