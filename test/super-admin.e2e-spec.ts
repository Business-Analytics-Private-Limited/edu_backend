/**
 * The super admin area: organizations (with their type and branches), modules, and the predefined
 * roles, including creating new ones (ADR-0030).
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
    expect(detail.body).toMatchObject({
      slug: 'green-valley',
      status: 'ACTIVE',
      type: 'INTERMEDIATE',
      code: 'GREENVALLE',
    });
    expect(detail.body.branches.map((b: { code: string }) => b.code)).toEqual(['MAIN']);
    expect(detail.body.admins).toEqual([
      expect.objectContaining({ email: 'admin@greenvalley.test', status: 'ACTIVE' }),
    ]);
    expect(detail.body.modules.every((m: { enabled: boolean }) => !m.enabled)).toBe(true);
  });

  it('only the super admin adds branches; an organization starts with at least one', async () => {
    const base = '/api/v1/super-admin/organizations';
    const body = {
      name: 'No branches',
      slug: 'no-branches',
      code: 'NB',
      type: 'SCHOOL',
      admin: { name: 'N Admin', email: 'n@none.test', password: 'Admin@12345' },
    };
    await api().post(base).set(auth()).send(body).expect(400);
    await api()
      .post(base)
      .set(auth())
      .send({
        ...body,
        branches: [
          { name: 'One', code: 'ONE' },
          { name: 'Two', code: 'ONE' },
        ],
      })
      .expect(400);
    await api()
      .post(base)
      .set(auth())
      .send({ ...body, type: 'COACHING', branches: [{ name: 'One', code: 'ONE' }] })
      .expect(400);

    // More can be added later; codes stay unique in the organization.
    await api()
      .post(`${base}/${organizationId}/branches`)
      .set(auth())
      .send({ name: 'Ameerpet', code: 'AMP' })
      .expect(201);
    await api()
      .post(`${base}/${organizationId}/branches`)
      .set(auth())
      .send({ name: 'Again', code: 'AMP' })
      .expect(400);

    // The organization's own admin can see and rename branches, not add them.
    const admin = await loginUser(app, 'admin@greenvalley.test', 'Admin@12345');
    await api()
      .post(`${base}/${organizationId}/branches`)
      .set({ Authorization: `Bearer ${admin}` })
      .send({ name: 'Mine', code: 'MINE' })
      .expect(403);
    const detail = await api().get(`${base}/${organizationId}`).set(auth()).expect(200);
    expect(detail.body.branches.map((b: { code: string }) => b.code)).toEqual(['AMP', 'MAIN']);
  });

  it('the type can change only while there is no academic structure', async () => {
    const base = `/api/v1/super-admin/organizations/${organizationId}`;
    const changed = await api().patch(base).set(auth()).send({ type: 'SCHOOL' }).expect(200);
    expect(changed.body).toMatchObject({ type: 'SCHOOL', levelNames: ['Class', 'Section'] });
    await api().put(`${base}/modules/academic`).set(auth()).send({ enabled: true }).expect(200);
    const admin = await loginUser(app, 'admin@greenvalley.test', 'Admin@12345');
    await api()
      .put('/api/v1/academic-structure/school-classes')
      .set({ Authorization: `Bearer ${admin}` })
      .send({ codes: ['C1'] })
      .expect(200);
    // Ticked classes are built in, so the structure is still "empty"; an own course isn't.
    await api().patch(base).set(auth()).send({ type: 'INTERMEDIATE' }).expect(200);
    await api().patch(base).set(auth()).send({ type: 'DEGREE' }).expect(200);
    await api()
      .post('/api/v1/academic-structure/courses')
      .set({ Authorization: `Bearer ${admin}` })
      .send({ name: 'B.Com', code: 'BCOM' })
      .expect(201);
    await api().patch(base).set(auth()).send({ type: 'SCHOOL' }).expect(400);
    await api().put(`${base}/modules/academic`).set(auth()).send({ enabled: false }).expect(200);
  });

  it('refuses a duplicate slug and a badly written slug', async () => {
    const body = {
      name: 'Another',
      slug: 'green-valley',
      code: 'AN',
      type: 'SCHOOL',
      admin: { name: 'X Admin', email: 'x@another.test', password: 'Admin@12345' },
      branches: [{ name: 'Main', code: 'MAIN' }],
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
    await api().get('/api/v1/branches').set(auth()).expect(403);
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
      'branch_admin',
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
    expect(reset.body.permissions).toContain('platform.branch.update');
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

  it('creates a new predefined role: every organization gets it; delete only while unused', async () => {
    const created = await api()
      .post('/api/v1/super-admin/predefined-roles')
      .set(auth())
      .send({
        name: 'Accountant',
        description: 'Fees and receipts',
        permissions: ['students.student.view'],
      })
      .expect(201);
    expect(created.body).toMatchObject({ key: 'accountant', builtIn: false });
    await api()
      .post('/api/v1/super-admin/predefined-roles')
      .set(auth())
      .send({ name: 'Accountant', description: 'Again', permissions: [] })
      .expect(400);

    // Both organizations have it, as a predefined role they may customize.
    for (const email of ['admin@greenvalley.test', 'admin@bluehills.test']) {
      const admin = await loginUser(app, email, 'Admin@12345');
      const roles = await api()
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(roles.body.find((r: { name: string }) => r.name === 'Accountant')).toMatchObject({
        predefined: true,
        editable: true,
        permissions: ['students.student.view'],
      });
    }

    // Built-in roles can't be deleted; a new one can, once nobody has it.
    await api().delete('/api/v1/super-admin/predefined-roles/director').set(auth()).expect(400);
    await api().delete('/api/v1/super-admin/predefined-roles/accountant').set(auth()).expect(200);
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
