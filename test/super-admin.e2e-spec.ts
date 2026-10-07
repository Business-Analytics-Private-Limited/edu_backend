/**
 * The super admin area: organizations, their institutions and modules, and the predefined roles.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createOrganization,
  createTestApp,
  currentPassword,
  loginSuperAdmin,
  loginUser,
} from './helpers';

describe('Super admin', () => {
  let app: INestApplication;
  let token: string;
  let organizationId: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginSuperAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an organization with its first admin', async () => {
    organizationId = await createOrganization(app, token, 'green-valley', 'admin@greenvalley.test');

    const detail = await api()
      .get(`/api/v1/super-admin/organizations/${organizationId}`)
      .set(auth())
      .expect(200);
    expect(detail.body).toMatchObject({ slug: 'green-valley', status: 'ACTIVE' });
    expect(detail.body.admins).toEqual([
      expect.objectContaining({ email: 'admin@greenvalley.test', status: 'ACTIVE' }),
    ]);
    expect(detail.body.modules.every((m: { enabled: boolean }) => !m.enabled)).toBe(true);
  });

  it('only the super admin adds and deletes institutions (ADR-0025)', async () => {
    const base = '/api/v1/super-admin/organizations';
    const body = {
      name: 'No institutions',
      slug: 'no-institutions',
      admin: { name: 'N Admin', email: 'n@none.test', password: 'Admin@12345' },
    };
    // An organization starts with at least one institution, with different codes.
    await api().post(base).set(auth()).send(body).expect(400);
    await api()
      .post(base)
      .set(auth())
      .send({
        ...body,
        institutions: [
          { name: 'One', code: 'ONE' },
          { name: 'Two', code: 'ONE' },
        ],
      })
      .expect(400);

    // More can be added later; codes stay unique in the organization.
    const added = await api()
      .post(`${base}/${organizationId}/institutions`)
      .set(auth())
      .send({ name: 'Green Valley School', code: 'GVS' })
      .expect(201);
    await api()
      .post(`${base}/${organizationId}/institutions`)
      .set(auth())
      .send({ name: 'Again', code: 'GVS' })
      .expect(400);
    // No type any more: every institution starts with the same levels and sets up its own.
    expect(added.body.type).toBeUndefined();

    // The organization's own admin can see and rename institutions, not add or delete them.
    const admin = await loginUser(app, 'admin@greenvalley.test', 'Admin@12345');
    const asAdmin = { Authorization: `Bearer ${admin}` };
    await api()
      .post('/api/v1/institutions')
      .set(asAdmin)
      .send({ name: 'Mine', code: 'MINE' })
      .expect(404);
    await api().delete(`/api/v1/institutions/${added.body.id}`).set(asAdmin).expect(404);
    await api()
      .patch(`/api/v1/institutions/${added.body.id}`)
      .set(asAdmin)
      .send({ name: 'Green Valley High School' })
      .expect(200);

    // An institution with campuses can't be deleted; an empty one can.
    await api()
      .post(`/api/v1/institutions/${added.body.id}/campuses`)
      .set(asAdmin)
      .send({ name: 'Main', code: 'MAIN' })
      .expect(201);
    await api()
      .delete(`${base}/${organizationId}/institutions/${added.body.id}`)
      .set(auth())
      .expect(400);
    const empty = await api()
      .post(`${base}/${organizationId}/institutions`)
      .set(auth())
      .send({ name: 'Empty', code: 'EMPTY' })
      .expect(201);
    await api()
      .delete(`${base}/${organizationId}/institutions/${empty.body.id}`)
      .set(auth())
      .expect(200);

    const detail = await api().get(`${base}/${organizationId}`).set(auth()).expect(200);
    expect(detail.body.institutions.map((i: { code: string }) => i.code).sort()).toEqual([
      'GVS',
      'MAIN',
    ]);
  });

  it('refuses a duplicate slug and a badly written slug', async () => {
    const body = {
      name: 'Another',
      slug: 'green-valley',
      admin: { name: 'X Admin', email: 'x@another.test', password: 'Admin@12345' },
      institutions: [{ name: 'Another College', code: 'AC' }],
    };
    await api().post('/api/v1/super-admin/organizations').set(auth()).send(body).expect(409);
    await api()
      .post('/api/v1/super-admin/organizations')
      .set(auth())
      .send({ ...body, slug: 'Bad Slug!' })
      .expect(400);
  });

  it('lists and searches organizations', async () => {
    const res = await api()
      .get('/api/v1/super-admin/organizations?search=green')
      .set(auth())
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ slug: 'green-valley', _count: { users: 1 } });
  });

  it('switches modules on and off in dependency order', async () => {
    const setModule = (key: string, enabled: boolean) =>
      api()
        .put(`/api/v1/super-admin/organizations/${organizationId}/modules/${key}`)
        .set(auth())
        .send({ enabled });

    const tooEarly = await setModule('students', true).expect(400);
    expect(tooEarly.body.message).toBe('Students needs these modules first: academic');

    await setModule('academic', true).expect(200);
    await setModule('students', true).expect(200);
    await setModule('attendance', true).expect(200);

    const stillNeeded = await setModule('students', false).expect(400);
    expect(stillNeeded.body.message).toBe('Switch off these modules first: Attendance');

    await setModule('attendance', false).expect(200);
    await setModule('unknown', true).expect(404);
  });

  it('keeps the super admin area and the organization area apart', async () => {
    const adminToken = await loginUser(app, 'admin@greenvalley.test', 'Admin@12345');
    await api()
      .get('/api/v1/super-admin/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    await api().get('/api/v1/institutions').set(auth()).expect(403);
  });

  it('suspending an organization stops its users at once', async () => {
    const adminToken = await loginUser(app, 'admin@greenvalley.test', 'Admin@12345');

    await api()
      .post(`/api/v1/super-admin/organizations/${organizationId}/suspend`)
      .set(auth())
      .expect(200);
    await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(401);
    const login = await api()
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@greenvalley.test',
        password: currentPassword('admin@greenvalley.test', 'Admin@12345'),
      })
      .expect(401);
    expect(login.body.message).toBe('Your organization is suspended');

    await api()
      .post(`/api/v1/super-admin/organizations/${organizationId}/activate`)
      .set(auth())
      .expect(200);
    await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(200);
  });

  it('changes a predefined role for every organization at once', async () => {
    const otherOrg = await createOrganization(app, token, 'blue-hills', 'admin@bluehills.test');
    const permissions = ['students.student.view', 'attendance.record.mark'];

    const list = await api().get('/api/v1/super-admin/predefined-roles').set(auth()).expect(200);
    expect(list.body.map((r: { key: string }) => r.key)).toEqual([
      'org_admin',
      'director',
      'principal',
      'campus_admin',
      'senior_faculty',
      'junior_faculty',
      'dtp_operator',
      'parent',
      'student',
    ]);

    await api()
      .put('/api/v1/super-admin/predefined-roles/junior_faculty')
      .set(auth())
      .send({ permissions })
      .expect(200);

    // Both organizations' copies of "Junior faculty" changed.
    for (const email of ['admin@greenvalley.test', 'admin@bluehills.test']) {
      const admin = await loginUser(app, email, 'Admin@12345');
      const roles = await api()
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      const junior = roles.body.find((r: { name: string }) => r.name === 'Junior faculty');
      expect(junior).toMatchObject({ predefined: true, permissions });
    }
    expect(otherOrg).toBeDefined();
  });

  it('puts a predefined role back to its starting permissions', async () => {
    await api()
      .put('/api/v1/super-admin/predefined-roles/director')
      .set(auth())
      .send({ permissions: ['audit.log.view'] })
      .expect(200);
    const reset = await api()
      .post('/api/v1/super-admin/predefined-roles/director/reset')
      .set(auth())
      .expect(200);
    expect(reset.body.permissions.length).toBeGreaterThan(1);
    expect(reset.body.permissions).toContain('platform.institution.update');
  });

  it('refuses to change the Organization admin role or unknown permissions', async () => {
    await api()
      .put('/api/v1/super-admin/predefined-roles/org_admin')
      .set(auth())
      .send({ permissions: [] })
      .expect(400);
    await api()
      .put('/api/v1/super-admin/predefined-roles/director')
      .set(auth())
      .send({ permissions: ['make.me.boss'] })
      .expect(400);
  });

  it('only the super admin can change predefined roles', async () => {
    const adminToken = await loginUser(app, 'admin@greenvalley.test', 'Admin@12345');
    await api()
      .put('/api/v1/super-admin/predefined-roles/director')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissions: [] })
      .expect(403);
  });

  it('shows dashboard numbers', async () => {
    // Other test files create organizations in the same test database, so check the shape and
    // that the numbers add up, not exact totals.
    const res = await api().get('/api/v1/super-admin/dashboard').set(auth()).expect(200);
    const { total, active, suspended } = res.body.organizations;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(active + suspended).toBe(total);
    expect(res.body.users).toBeGreaterThanOrEqual(1);
    expect(res.body.recentOrganizations.length).toBeGreaterThanOrEqual(1);
  });
});
