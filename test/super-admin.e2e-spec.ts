/**
 * The super admin area: organizations and their modules.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

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

  it('refuses a duplicate slug and a badly written slug', async () => {
    const body = {
      name: 'Another',
      slug: 'green-valley',
      admin: { name: 'X Admin', email: 'x@another.test', password: 'Admin@12345' },
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
      .send({ email: 'admin@greenvalley.test', password: 'Admin@12345' })
      .expect(401);
    expect(login.body.message).toBe('Your organization is suspended');

    await api()
      .post(`/api/v1/super-admin/organizations/${organizationId}/activate`)
      .set(auth())
      .expect(200);
    await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(200);
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
