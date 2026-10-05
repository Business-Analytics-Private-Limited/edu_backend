/**
 * Inactive campuses and institutions (ADR-0026): closing instead of deleting, nothing new at a
 * closed place, roles there stop working, only the Organization admin reopens a campus, a real
 * delete only for an empty campus, and the super admin closes / reopens institutions.
 *
 * Organization "cls": SVJC with campuses KKP (student Teja) and AMP; SVDC with no campuses.
 * Ravi = Campus admin of AMP. Divya = Director (whole organization, not the Organization admin).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createOrganization,
  createTestApp,
  institutionId,
  loginSuperAdmin,
  loginUser,
  SVJC,
} from './helpers';

describe('Inactive campuses and institutions', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let divya: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const admit = (campusId: string, admissionNo: string) =>
    api()
      .post('/api/v1/students')
      .set(as(admin))
      .send({
        campusId,
        admissionNo,
        admissionDate: '2026-06-01',
        fullName: `Student ${admissionNo}`,
        dateOfBirth: '2010-01-01',
        gender: 'MALE',
      });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'cls', 'admin@cls.test', [
      SVJC,
      { name: 'Sri Vidya Degree College', code: 'SVDC' },
    ]);
    for (const key of ['academic', 'students']) {
      await api()
        .put(`/api/v1/super-admin/organizations/${orgId}/modules/${key}`)
        .set(as(superAdmin))
        .send({ enabled: true })
        .expect(200);
    }
    admin = await loginUser(app, 'admin@cls.test', 'Admin@12345');
    ids.SVJC = await institutionId(app, superAdmin, orgId, 'SVJC');
    ids.SVDC = await institutionId(app, superAdmin, orgId, 'SVDC');
    for (const code of ['KKP', 'AMP']) {
      const campus = await api()
        .post(`/api/v1/institutions/${ids.SVJC}/campuses`)
        .set(as(admin))
        .send({ name: code, code })
        .expect(201);
      ids[code] = campus.body.id;
    }
    ids.TEJA = (await admit(ids.KKP, 'C1').expect(201)).body.id;

    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    for (const [email, name, place] of [
      ['ravi@cls.test', 'Campus admin', { campusId: ids.AMP }],
      ['divya@cls.test', 'Director', {}],
    ] as const) {
      await api()
        .post('/api/v1/users')
        .set(as(admin))
        .send({
          name: email.split('@')[0],
          email,
          password: 'Password@123',
          roles: [{ roleId: role(name), ...place }],
        })
        .expect(201);
    }
    ravi = await loginUser(app, 'ravi@cls.test', 'Password@123');
    divya = await loginUser(app, 'divya@cls.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a campus with active students cannot be closed', async () => {
    const res = await api()
      .post(`/api/v1/campuses/${ids.KKP}/deactivate`)
      .set(as(admin))
      .expect(400);
    expect(res.body.message).toBe(
      '1 active student(s) still study at KKP; move them to another campus or change their status first',
    );
  });

  it('a closed campus keeps its records, but nothing new happens there', async () => {
    await api()
      .post(`/api/v1/students/${ids.TEJA}/status`)
      .set(as(admin))
      .send({ status: 'DISCONTINUED', effectiveOn: '2026-09-30' })
      .expect(200);
    await api().post(`/api/v1/campuses/${ids.KKP}/deactivate`).set(as(admin)).expect(200);

    // Records stay readable.
    await api().get(`/api/v1/students/${ids.TEJA}`).set(as(admin)).expect(200);
    const list = await api().get('/api/v1/institutions').set(as(admin)).expect(200);
    const svjc = list.body.find((i: { code: string }) => i.code === 'SVJC');
    expect(svjc.campuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KKP', status: 'INACTIVE' })]),
    );
    const dashboard = await api().get('/api/v1/dashboard').set(as(admin)).expect(200);
    expect(dashboard.body).toMatchObject({ campuses: 1, inactiveCampuses: 1 });

    // Nothing new: admission, classes, roles, holidays.
    const refused = await admit(ids.KKP, 'C2').expect(400);
    expect(refused.body.message).toBe(
      'Campus KKP is inactive; the Organization admin can activate it again',
    );
    await api()
      .post(`/api/v1/campuses/${ids.KKP}/classes`)
      .set(as(admin))
      .send({ name: '1st year', code: 'Y1' })
      .expect(400);
    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'Late joiner',
        email: 'late@cls.test',
        password: 'Password@123',
        roles: [
          {
            roleId: roles.body.find((r: { name: string }) => r.name === 'Junior faculty').id,
            campusId: ids.KKP,
          },
        ],
      })
      .expect(400);
    await api()
      .post('/api/v1/holidays')
      .set(as(admin))
      .send({
        institutionId: ids.SVJC,
        campusId: ids.KKP,
        name: 'Festival',
        startsOn: '2026-10-20',
      })
      .expect(400);
  });

  it("roles at a closed campus stop working until it's activated again", async () => {
    await api().get('/api/v1/students').set(as(ravi)).expect(200);
    await api().post(`/api/v1/campuses/${ids.AMP}/deactivate`).set(as(admin)).expect(200);

    const me = await api().get('/api/v1/auth/me').set(as(ravi)).expect(200);
    expect(me.body).toMatchObject({ grants: [], permissions: [], isOrganizationAdmin: false });
    await api().get('/api/v1/students').set(as(ravi)).expect(403);

    // Only the Organization admin reopens a campus, not even a Director.
    const denied = await api()
      .post(`/api/v1/campuses/${ids.AMP}/activate`)
      .set(as(divya))
      .expect(403);
    expect(denied.body.message).toBe('Only the Organization admin can activate a campus');
    await api().post(`/api/v1/campuses/${ids.AMP}/activate`).set(as(admin)).expect(200);
    await api().get('/api/v1/students').set(as(ravi)).expect(200);
  });

  it('a real delete is only for an empty campus, by the Organization admin', async () => {
    const empty = await api()
      .post(`/api/v1/institutions/${ids.SVJC}/campuses`)
      .set(as(admin))
      .send({ name: 'By mistake', code: 'OOPS' })
      .expect(201);
    await api().delete(`/api/v1/campuses/${empty.body.id}`).set(as(divya)).expect(403);
    await api().delete(`/api/v1/campuses/${empty.body.id}`).set(as(admin)).expect(200);

    const withData = await api().delete(`/api/v1/campuses/${ids.KKP}`).set(as(admin)).expect(400);
    expect(withData.body.message).toBe(
      'Only an empty campus can be deleted (no classes, students or holidays); deactivate it instead',
    );
  });

  it('the super admin closes and reopens institutions', async () => {
    const base = `/api/v1/super-admin/organizations/${orgId}/institutions`;
    // SVJC has an active student at AMP: refused.
    await admit(ids.AMP, 'C3').expect(201);
    await api().post(`${base}/${ids.SVJC}/deactivate`).set(as(superAdmin)).expect(400);

    // SVDC is empty: closed, then no campus can be added and none activated there.
    await api().post(`${base}/${ids.SVDC}/deactivate`).set(as(superAdmin)).expect(200);
    const refused = await api()
      .post(`/api/v1/institutions/${ids.SVDC}/campuses`)
      .set(as(admin))
      .send({ name: 'Main', code: 'MAIN' })
      .expect(400);
    expect(refused.body.message).toBe('Sri Vidya Degree College is inactive');
    // The organization can't reopen it; the super admin can.
    await api().post(`${base}/${ids.SVDC}/activate`).set(as(admin)).expect(403);
    await api().post(`${base}/${ids.SVDC}/activate`).set(as(superAdmin)).expect(200);
    await api()
      .post(`/api/v1/institutions/${ids.SVDC}/campuses`)
      .set(as(admin))
      .send({ name: 'Main', code: 'MAIN' })
      .expect(201);

    const detail = await api()
      .get(`/api/v1/super-admin/organizations/${orgId}`)
      .set(as(superAdmin))
      .expect(200);
    expect(detail.body.campuses).toEqual({ active: 2, inactive: 1 }); // AMP and SVDC's MAIN; KKP is closed;
  });
});
