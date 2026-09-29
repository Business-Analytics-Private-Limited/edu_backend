/**
 * The tenant admin area, and the most important rule of the product:
 * one organization never sees another organization's data.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Organization area', () => {
  let app: INestApplication;
  let orgA: string;
  let orgB: string;
  let adminA: string; // token of organization A's admin
  let adminB: string; // token of organization B's admin
  let institutionA: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    const superAdmin = await loginSuperAdmin(app);
    orgA = await createOrganization(app, superAdmin, 'org-a', 'admin@org-a.test');
    orgB = await createOrganization(app, superAdmin, 'org-b', 'admin@org-b.test');
    adminA = await loginUser(app, 'admin@org-a.test', 'Admin@12345');
    adminB = await loginUser(app, 'admin@org-b.test', 'Admin@12345');
  });

  afterAll(async () => {
    await app.close();
  });

  it('an admin manages institutions and campuses of their organization', async () => {
    const institution = await api()
      .post('/api/v1/institutions')
      .set(as(adminA))
      .send({ name: 'Org A Junior College', code: 'OAJC', type: 'JUNIOR_COLLEGE' })
      .expect(201);
    institutionA = institution.body.id;

    await api()
      .post(`/api/v1/institutions/${institutionA}/campuses`)
      .set(as(adminA))
      .send({ name: 'Main campus', code: 'MAIN' })
      .expect(201);

    const detail = await api()
      .get(`/api/v1/institutions/${institutionA}`)
      .set(as(adminA))
      .expect(200);
    expect(detail.body.campuses).toHaveLength(1);

    const dashboard = await api().get('/api/v1/dashboard').set(as(adminA)).expect(200);
    expect(dashboard.body).toMatchObject({ institutions: 1, campuses: 1, users: 1, roles: 1 });
  });

  it("organization B can't see or change organization A's data", async () => {
    const list = await api().get('/api/v1/institutions').set(as(adminB)).expect(200);
    expect(list.body).toEqual([]);

    await api().get(`/api/v1/institutions/${institutionA}`).set(as(adminB)).expect(404);
    await api()
      .patch(`/api/v1/institutions/${institutionA}`)
      .set(as(adminB))
      .send({ name: 'Hacked' })
      .expect(404);
    await api().delete(`/api/v1/institutions/${institutionA}`).set(as(adminB)).expect(404);
  });

  it('the database safety net hides other organizations even when a query forgets its filter', async () => {
    const prisma = app.get(PrismaService);

    // As organization B, with NO "where organizationId" filter: still nothing of A.
    const seenByB = await prisma.forOrganization(orgB, (db) => db.institution.findMany());
    expect(seenByB).toEqual([]);

    // Without saying who is asking at all: nothing.
    expect(await prisma.institution.findMany()).toEqual([]);

    // As organization A: its own institution.
    const seenByA = await prisma.forOrganization(orgA, (db) => db.institution.findMany());
    expect(seenByA.map((i) => i.code)).toEqual(['OAJC']);
  });

  it('a role limits what a user may do', async () => {
    const role = await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Teacher', permissions: ['platform.institution.view'] })
      .expect(201);

    await api()
      .post('/api/v1/users')
      .set(as(adminA))
      .send({
        name: 'Ravi Teacher',
        email: 'ravi@org-a.test',
        password: 'Teacher@123',
        roleId: role.body.id,
      })
      .expect(201);
    const teacher = await loginUser(app, 'ravi@org-a.test', 'Teacher@123');

    await api().get('/api/v1/institutions').set(as(teacher)).expect(200);
    const denied = await api()
      .post('/api/v1/institutions')
      .set(as(teacher))
      .send({ name: 'Not allowed', code: 'NOPE', type: 'SCHOOL' })
      .expect(403);
    expect(denied.body.message).toBe(
      'Your role needs the permission "platform.institution.manage"',
    );
    await api().get('/api/v1/users').set(as(teacher)).expect(403);
  });

  it('refuses unknown permissions and protects the admin role', async () => {
    await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Broken', permissions: ['make.me.boss'] })
      .expect(400);

    const roles = await api().get('/api/v1/roles').set(as(adminA)).expect(200);
    const adminRole = roles.body.find((r: { isSystem: boolean }) => r.isSystem);
    await api().delete(`/api/v1/roles/${adminRole.id}`).set(as(adminA)).expect(400);
  });

  it('an admin cannot lock the organization out', async () => {
    const me = await api().get('/api/v1/auth/me').set(as(adminA)).expect(200);
    await api().post(`/api/v1/users/${me.body.id}/deactivate`).set(as(adminA)).expect(400);
  });

  it('a deactivated user can no longer log in', async () => {
    const users = await api().get('/api/v1/users?search=ravi').set(as(adminA)).expect(200);
    await api()
      .post(`/api/v1/users/${users.body.items[0].id}/deactivate`)
      .set(as(adminA))
      .expect(200);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ravi@org-a.test', password: 'Teacher@123' })
      .expect(401);
  });

  it('records changes in the audit log', async () => {
    const res = await api().get('/api/v1/audit-logs').set(as(adminA)).expect(200);
    const actions = res.body.items.map(
      (i: { action: string; entity: string }) => `${i.action} ${i.entity}`,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'create institution',
        'create campus',
        'create role',
        'create user',
        'deactivate user',
      ]),
    );
  });
});
