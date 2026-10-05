/**
 * The tenant admin area, and the most important rule of the product:
 * one organization never sees another organization's data.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createOrganization,
  createTestApp,
  institutionId,
  loginSuperAdmin,
  loginUser,
} from './helpers';

describe('Organization area', () => {
  let app: INestApplication;
  let orgA: string;
  let orgB: string;
  let adminA: string; // token of organization A's admin
  let adminB: string; // token of organization B's admin
  let institutionA: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** The id of organization A's role with this name. */
  const roleId = async (name: string): Promise<string> => {
    const roles = await api().get('/api/v1/roles').set(as(adminA)).expect(200);
    return roles.body.find((r: { name: string }) => r.name === name).id;
  };

  beforeAll(async () => {
    app = await createTestApp();
    const superAdmin = await loginSuperAdmin(app);
    orgA = await createOrganization(app, superAdmin, 'org-a', 'admin@org-a.test', [
      { name: 'Org A Junior College', code: 'OAJC' },
    ]);
    institutionA = await institutionId(app, superAdmin, orgA, 'OAJC');
    orgB = await createOrganization(app, superAdmin, 'org-b', 'admin@org-b.test');
    adminA = await loginUser(app, 'admin@org-a.test', 'Admin@12345');
    adminB = await loginUser(app, 'admin@org-b.test', 'Admin@12345');
  });

  afterAll(async () => {
    await app.close();
  });

  it('an admin manages the campuses of their institutions', async () => {
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
    // roles: the 9 predefined roles every organization gets
    expect(dashboard.body).toMatchObject({ institutions: 1, campuses: 1, users: 1, roles: 9 });
  });

  it("organization B can't see or change organization A's data", async () => {
    const list = await api().get('/api/v1/institutions').set(as(adminB)).expect(200);
    expect(list.body.map((i: { code: string }) => i.code)).toEqual(['MAIN']); // B's own only

    await api().get(`/api/v1/institutions/${institutionA}`).set(as(adminB)).expect(404);
    await api()
      .patch(`/api/v1/institutions/${institutionA}`)
      .set(as(adminB))
      .send({ name: 'Hacked' })
      .expect(404);
    await api()
      .post(`/api/v1/institutions/${institutionA}/campuses`)
      .set(as(adminB))
      .send({ name: 'Sneaky', code: 'SNK' })
      .expect(404);
  });

  it('the database safety net hides other organizations even when a query forgets its filter', async () => {
    const prisma = app.get(PrismaService);

    // As organization B, with NO "where organizationId" filter: still nothing of A.
    const seenByB = await prisma.forOrganization(orgB, (db) => db.institution.findMany());
    expect(seenByB.map((i) => i.code)).toEqual(['MAIN']);

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
        roles: [{ roleId: role.body.id }],
      })
      .expect(201);
    const teacher = await loginUser(app, 'ravi@org-a.test', 'Teacher@123');

    await api().get('/api/v1/institutions').set(as(teacher)).expect(200);
    const denied = await api()
      .patch(`/api/v1/institutions/${institutionA}`)
      .set(as(teacher))
      .send({ name: 'Not allowed' })
      .expect(403);
    expect(denied.body.message).toBe(
      'Your role needs the permission "platform.institution.update"',
    );
    await api().get('/api/v1/users').set(as(teacher)).expect(403);
  });

  it('every organization gets the predefined roles', async () => {
    const roles = await api().get('/api/v1/roles').set(as(adminA)).expect(200);
    const predefined = roles.body.filter((r: { predefined: boolean }) => r.predefined);
    expect(predefined.map((r: { name: string }) => r.name)).toEqual([
      'Organization admin',
      'Director',
      'Principal',
      'Campus admin',
      'Senior faculty',
      'Junior faculty',
      'DTP operator',
      'Parent',
      'Student',
    ]);
    const parent = predefined.find((r: { name: string }) => r.name === 'Parent');
    expect(parent.assignable).toBe(false);
  });

  it('an organization admin can add roles but not change or delete predefined ones', async () => {
    const director = await roleId('Director');
    await api()
      .patch(`/api/v1/roles/${director}`)
      .set(as(adminA))
      .send({ permissions: ['audit.log.view'] })
      .expect(403);
    await api().delete(`/api/v1/roles/${director}`).set(as(adminA)).expect(403);
    const adminRole = await roleId('Organization admin');
    await api().delete(`/api/v1/roles/${adminRole}`).set(as(adminA)).expect(403);
    await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Broken', permissions: ['make.me.boss'] })
      .expect(400);
  });

  it('a user with several roles may do what any of them allows', async () => {
    const roles = [
      { roleId: await roleId('Principal') },
      { roleId: await roleId('Senior faculty') },
    ];
    await api()
      .post('/api/v1/users')
      .set(as(adminA))
      .send({
        name: 'Lakshmi Principal',
        email: 'lakshmi@org-a.test',
        password: 'Principal@123',
        roles,
      })
      .expect(201);
    const token = await loginUser(app, 'lakshmi@org-a.test', 'Principal@123');

    const me = await api().get('/api/v1/auth/me').set(as(token)).expect(200);
    expect(me.body.roleNames.sort()).toEqual(['Principal', 'Senior faculty']);
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['students.enrolment.promote', 'attendance.record.mark']),
    );
    // Principal may rename institutions; deleting them is for the super admin only (ADR-0025).
    await api()
      .patch(`/api/v1/institutions/${institutionA}`)
      .set(as(token))
      .send({ name: 'Org A Junior College' })
      .expect(200);
    await api().delete(`/api/v1/institutions/${institutionA}`).set(as(token)).expect(404);
  });

  it("parent and student roles can't be given from the Users page", async () => {
    const parentRole = await roleId('Parent');
    const res = await api()
      .post('/api/v1/users')
      .set(as(adminA))
      .send({
        name: 'A Parent',
        email: 'parent@org-a.test',
        password: 'Parent@12345',
        roles: [{ roleId: parentRole }],
      })
      .expect(400);
    expect(res.body.message).toBe("The Parent role is given from a student's record, not here");
  });

  it('nobody can hand out more than they have', async () => {
    // An office manager who may manage users and create roles, but little else.
    const manager = await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({
        name: 'Office manager',
        permissions: [
          'access.user.view',
          'access.user.create',
          'access.user.update',
          'access.role.view',
          'access.role.create',
        ],
      })
      .expect(201);
    await api()
      .post('/api/v1/users')
      .set(as(adminA))
      .send({
        name: 'Manager',
        email: 'manager@org-a.test',
        password: 'Manager@123',
        roles: [{ roleId: manager.body.id }],
      })
      .expect(201);
    const token = await loginUser(app, 'manager@org-a.test', 'Manager@123');

    // A role with a permission the manager doesn't have: refused.
    await api()
      .post('/api/v1/roles')
      .set(as(token))
      .send({ name: 'Sneaky', permissions: ['platform.campus.delete'] })
      .expect(403);
    // Changing a role that has more than the manager has: refused.
    await api()
      .patch(`/api/v1/roles/${manager.body.id}`)
      .set(as(adminA))
      .send({ permissions: [...manager.body.permissions, 'access.role.update'] })
      .expect(200);
    const bigger = await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Bigger', permissions: ['platform.campus.delete'] })
      .expect(201);
    await api()
      .patch(`/api/v1/roles/${bigger.body.id}`)
      .set(as(token))
      .send({ permissions: [] })
      .expect(403);
    // Giving someone the Director role (more than the manager has): refused.
    const director = await roleId('Director');
    await api()
      .post('/api/v1/users')
      .set(as(token))
      .send({
        name: 'Fake Director',
        email: 'fake@org-a.test',
        password: 'Director@123',
        roles: [{ roleId: director }],
      })
      .expect(403);
    // Deactivating the organization admin (who may do more): refused.
    const admin = await api().get('/api/v1/auth/me').set(as(adminA)).expect(200);
    await api().post(`/api/v1/users/${admin.body.id}/deactivate`).set(as(token)).expect(403);
    // Adding someone with the manager's own role: fine.
    await api()
      .post('/api/v1/users')
      .set(as(token))
      .send({
        name: 'Assistant',
        email: 'assistant@org-a.test',
        password: 'Assistant@123',
        roles: [{ roleId: manager.body.id }],
      })
      .expect(201);
  });

  it('an admin cannot lock the organization out', async () => {
    const me = await api().get('/api/v1/auth/me').set(as(adminA)).expect(200);
    await api().post(`/api/v1/users/${me.body.id}/deactivate`).set(as(adminA)).expect(400);

    // Adding a second role: fine.
    const directorRole = await roleId('Director');
    const both = await api()
      .post(`/api/v1/users/${me.body.id}/roles`)
      .set(as(adminA))
      .send({ roleId: directorRole })
      .expect(201);
    expect(both.body.roles).toHaveLength(2);

    // The same role at the same place twice: refused.
    await api()
      .post(`/api/v1/users/${me.body.id}/roles`)
      .set(as(adminA))
      .send({ roleId: directorRole })
      .expect(409);

    // Taking away the only admin's Organization admin role: refused.
    const adminAssignment = both.body.roles.find(
      (r: { role: { name: string } }) => r.role.name === 'Organization admin',
    );
    const res = await api()
      .delete(`/api/v1/users/${me.body.id}/roles/${adminAssignment.id}`)
      .set(as(adminA))
      .expect(400);
    expect(res.body.message).toBe(
      'The organization must keep at least one active Organization admin',
    );

    // Taking away Director again: fine. Then the last role can't go.
    const directorAssignment = both.body.roles.find(
      (r: { role: { name: string } }) => r.role.name === 'Director',
    );
    await api()
      .delete(`/api/v1/users/${me.body.id}/roles/${directorAssignment.id}`)
      .set(as(adminA))
      .expect(200);
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
