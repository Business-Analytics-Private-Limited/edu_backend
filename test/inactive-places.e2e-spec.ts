/**
 * Closed branches (ADR-0026, ADR-0030): the super admin adds, closes, reopens and deletes branches;
 * a closed branch keeps its records, nothing new happens there, and roles there stop working.
 *
 * Organization "cls": branches KPHB (student Teja) and AMP. Ravi = Branch admin of AMP.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { branchId, createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Closed branches', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const base = () => `/api/v1/super-admin/organizations/${orgId}/branches`;
  const admit = (branch: string, admissionNo: string) =>
    api().post('/api/v1/students').set(as(admin)).send({
      branchId: branch,
      admissionNo,
      admissionDate: '2026-06-01',
      fullName: 'Test Student',
      dateOfBirth: '2010-01-01',
      gender: 'MALE',
    });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'cls', 'admin@cls.test', {
      branches: [
        { name: 'KPHB', code: 'KPHB' },
        { name: 'AMP', code: 'AMP' },
      ],
      modules: ['academic', 'students'],
    });
    admin = await loginUser(app, 'admin@cls.test', 'Admin@12345');
    ids.KPHB = await branchId(app, superAdmin, orgId, 'KPHB');
    ids.AMP = await branchId(app, superAdmin, orgId, 'AMP');
    ids.TEJA = (await admit(ids.KPHB, 'C1').expect(201)).body.id;

    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    const branchAdmin = roles.body.find((r: { name: string }) => r.name === 'Branch admin').id;
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'ravi',
        email: 'ravi@cls.test',
        password: 'Password@123',
        roles: [{ roleId: branchAdmin, branchId: ids.AMP }],
      })
      .expect(201);
    ravi = await loginUser(app, 'ravi@cls.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('only the super admin closes branches, and not while current students study there', async () => {
    await api().post(`${base()}/${ids.KPHB}/deactivate`).set(as(admin)).expect(403);
    const res = await api()
      .post(`${base()}/${ids.KPHB}/deactivate`)
      .set(as(superAdmin))
      .expect(400);
    expect(res.body.message).toBe(
      '1 current student(s) still study at KPHB; it can be deactivated once they have left or moved',
    );
  });

  it('a closed branch keeps its records, but nothing new happens there', async () => {
    await api()
      .post(`/api/v1/students/${ids.TEJA}/leave`)
      .set(as(admin))
      .send({ status: 'DISCONTINUED', effectiveOn: '2026-09-30' })
      .expect(200);
    await api().post(`${base()}/${ids.KPHB}/deactivate`).set(as(superAdmin)).expect(200);

    // Records stay readable.
    await api().get(`/api/v1/students/${ids.TEJA}`).set(as(admin)).expect(200);
    const list = await api().get('/api/v1/branches').set(as(admin)).expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KPHB', status: 'INACTIVE' })]),
    );
    const dashboard = await api().get('/api/v1/dashboard').set(as(admin)).expect(200);
    expect(dashboard.body).toMatchObject({ branches: 1, inactiveBranches: 1 });

    // Nothing new: admission, roles, holidays.
    const refused = await admit(ids.KPHB, 'C2').expect(400);
    expect(refused.body.message).toBe('Branch KPHB is inactive; EduPlatform can activate it again');
    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    const junior = roles.body.find((r: { name: string }) => r.name === 'Junior faculty').id;
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'Late joiner',
        email: 'late@cls.test',
        password: 'Password@123',
        roles: [{ roleId: junior, branchId: ids.KPHB }],
      })
      .expect(400);
    await api()
      .post('/api/v1/holidays')
      .set(as(admin))
      .send({ branchId: ids.KPHB, name: 'Festival', startsOn: '2026-10-20' })
      .expect(400);
  });

  it("roles at a closed branch stop working until it's activated again", async () => {
    await api().get('/api/v1/students').set(as(ravi)).expect(200);
    await api().post(`${base()}/${ids.AMP}/deactivate`).set(as(superAdmin)).expect(200);

    const me = await api().get('/api/v1/auth/me').set(as(ravi)).expect(200);
    expect(me.body).toMatchObject({ grants: [], permissions: [], isOrganizationAdmin: false });
    await api().get('/api/v1/students').set(as(ravi)).expect(403);

    await api().post(`${base()}/${ids.AMP}/activate`).set(as(admin)).expect(403);
    await api().post(`${base()}/${ids.AMP}/activate`).set(as(superAdmin)).expect(200);
    await api().get('/api/v1/students').set(as(ravi)).expect(200);
  });

  it('a real delete is only for an empty branch', async () => {
    const empty = await api()
      .post(base())
      .set(as(superAdmin))
      .send({ name: 'By mistake', code: 'OOPS' })
      .expect(201);
    await api().delete(`${base()}/${empty.body.id}`).set(as(superAdmin)).expect(200);

    const withRoles = await api().delete(`${base()}/${ids.AMP}`).set(as(superAdmin)).expect(400);
    expect(withRoles.body.message).toBe(
      'Some users still have roles at this branch; take those roles away first',
    );
    const withStudents = await api()
      .delete(`${base()}/${ids.KPHB}`)
      .set(as(superAdmin))
      .expect(400);
    expect(withStudents.body.message).toBe(
      'Only an empty branch can be deleted (no sections, students or holidays); deactivate it instead',
    );
  });
});
