/**
 * The organization's own area, and the most important rule of the product:
 * one organization never sees another organization's data.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { branchId, createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Organization area', () => {
  let app: INestApplication;
  let orgA: string;
  let orgB: string;
  let adminA: string; // token of organization A's admin
  let adminB: string; // token of organization B's admin
  let branchA: string;
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
    orgA = await createOrganization(app, superAdmin, 'org-a', 'admin@org-a.test', {
      branches: [
        { name: 'KPHB', code: 'KPHB' },
        { name: 'Ameerpet', code: 'AMP' },
      ],
    });
    branchA = await branchId(app, superAdmin, orgA, 'KPHB');
    orgB = await createOrganization(app, superAdmin, 'org-b', 'admin@org-b.test');
    adminA = await loginUser(app, 'admin@org-a.test', 'Admin@12345');
    adminB = await loginUser(app, 'admin@org-b.test', 'Admin@12345');
  });

  afterAll(async () => {
    await app.close();
  });

  it('an admin sees and renames their branches; adding them is for the super admin', async () => {
    const list = await api().get('/api/v1/branches').set(as(adminA)).expect(200);
    expect(list.body.map((b: { code: string }) => b.code)).toEqual(['AMP', 'KPHB']);
    await api()
      .patch(`/api/v1/branches/${branchA}`)
      .set(as(adminA))
      .send({ name: 'KPHB Colony' })
      .expect(200);

    const organization = await api().get('/api/v1/organization').set(as(adminA)).expect(200);
    expect(organization.body).toMatchObject({
      type: 'INTERMEDIATE',
      code: 'ORGA',
      levelNames: ['Year', 'Group', 'Stream', 'Section'],
    });

    const dashboard = await api().get('/api/v1/dashboard').set(as(adminA)).expect(200);
    // roles: the 9 predefined roles every organization gets
    expect(dashboard.body).toMatchObject({ branches: 2, users: 1, roles: 9 });
  });

  it("organization B can't see or change organization A's data", async () => {
    const list = await api().get('/api/v1/branches').set(as(adminB)).expect(200);
    expect(list.body.map((b: { code: string }) => b.code)).toEqual(['MAIN']); // B's own only

    await api().get(`/api/v1/branches/${branchA}`).set(as(adminB)).expect(404);
    await api()
      .patch(`/api/v1/branches/${branchA}`)
      .set(as(adminB))
      .send({ name: 'Hacked' })
      .expect(404);
  });

  it('the database safety net hides other organizations even when a query forgets its filter', async () => {
    const prisma = app.get(PrismaService);

    // As organization B, with NO "where organizationId" filter: still nothing of A.
    const seenByB = await prisma.forOrganization(orgB, (db) => db.branch.findMany());
    expect(seenByB.map((b) => b.code)).toEqual(['MAIN']);

    // Without saying who is asking at all: nothing.
    expect(await prisma.branch.findMany()).toEqual([]);

    // As organization A: its own branches.
    const seenByA = await prisma.forOrganization(orgA, (db) => db.branch.findMany());
    expect(seenByA.map((b) => b.code).sort()).toEqual(['AMP', 'KPHB']);
  });

  it('a role limits what a user may do', async () => {
    const role = await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Teacher', permissions: ['platform.branch.view'] })
      .expect(201);
    // The same name again: a clear message, though row security hides the column.
    const again = await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Teacher', permissions: ['platform.branch.view'] })
      .expect(409);
    expect(again.body.message).toBe('A role with this name already exists');

    await api()
      .post('/api/v1/users')
      .set(as(adminA))
      .send({
        name: 'Ravi Teacher',
        email: 'ravi@org-a.test',
        password: 'Teacher@123',
        roles: [{ roleId: role.body.id, branchId: branchA }],
      })
      .expect(201);
    const teacher = await loginUser(app, 'ravi@org-a.test', 'Teacher@123');

    const seen = await api().get('/api/v1/branches').set(as(teacher)).expect(200);
    expect(seen.body.map((b: { id: string }) => b.id)).toEqual([branchA]); // their branch only
    const denied = await api()
      .patch(`/api/v1/branches/${branchA}`)
      .set(as(teacher))
      .send({ name: 'Not allowed' })
      .expect(403);
    expect(denied.body.message).toBe('Your role needs the permission "platform.branch.update"');
    await api().get('/api/v1/users').set(as(teacher)).expect(403);
  });

  it('every organization gets the predefined roles', async () => {
    const roles = await api().get('/api/v1/roles').set(as(adminA)).expect(200);
    const predefined = roles.body.filter((r: { predefined: boolean }) => r.predefined);
    expect(predefined.map((r: { name: string }) => r.name)).toEqual([
      'Organization admin',
      'Director',
      'Principal',
      'Branch admin',
      'Senior faculty',
      'Junior faculty',
      'DTP operator',
      'Parent',
      'Student',
    ]);
    const parent = predefined.find((r: { name: string }) => r.name === 'Parent');
    expect(parent.assignable).toBe(false);
  });

  it("an organization admin can change predefined roles' permissions, not delete them", async () => {
    const director = await roleId('Director');
    // Permissions can change (ADR-0029); the role is then "customized".
    const changed = await api()
      .patch(`/api/v1/roles/${director}`)
      .set(as(adminA))
      .send({ permissions: ['audit.log.view'] })
      .expect(200);
    expect(changed.body).toMatchObject({ permissions: ['audit.log.view'], customized: true });
    // The name stays.
    await api()
      .patch(`/api/v1/roles/${director}`)
      .set(as(adminA))
      .send({ name: 'Boss' })
      .expect(400);
    // Back to EduPlatform's version.
    const reset = await api().post(`/api/v1/roles/${director}/reset`).set(as(adminA)).expect(200);
    expect(reset.body.customized).toBe(false);
    expect(reset.body.permissions).toEqual(reset.body.defaultPermissions);

    // Never deleted; the Organization admin, Parent and Student roles can't change at all.
    await api().delete(`/api/v1/roles/${director}`).set(as(adminA)).expect(403);
    const adminRole = await roleId('Organization admin');
    await api().delete(`/api/v1/roles/${adminRole}`).set(as(adminA)).expect(403);
    await api()
      .patch(`/api/v1/roles/${adminRole}`)
      .set(as(adminA))
      .send({ permissions: [] })
      .expect(403);
    await api()
      .patch(`/api/v1/roles/${await roleId('Parent')}`)
      .set(as(adminA))
      .send({ permissions: ['audit.log.view'] })
      .expect(403);
    await api()
      .post('/api/v1/roles')
      .set(as(adminA))
      .send({ name: 'Broken', permissions: ['make.me.boss'] })
      .expect(400);
  });

  it('one person can be Principal and Branch admin of a branch at once', async () => {
    // (Ids are looked up before a request is built: requests share the test server.)
    const principal = await roleId('Principal');
    const branchAdmin = await roleId('Branch admin');
    await api()
      .post('/api/v1/users')
      .set(as(adminA))
      .send({
        name: 'Lakshmi',
        email: 'lakshmi@org-a.test',
        password: 'Principal@123',
        roles: [
          { roleId: principal, branchId: branchA },
          { roleId: branchAdmin, branchId: branchA },
        ],
      })
      .expect(201);
    const token = await loginUser(app, 'lakshmi@org-a.test', 'Principal@123');

    const me = await api().get('/api/v1/auth/me').set(as(token)).expect(200);
    expect(me.body.roleNames.sort()).toEqual(['Branch admin', 'Principal']);
    expect(me.body.grants.every((g: { branchId: string }) => g.branchId === branchA)).toBe(true);
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['students.enrolment.promote', 'attendance.record.mark']),
    );
    // Their own branch: yes (but renaming it is the organization's); the other: not even visible.
    await api().get(`/api/v1/branches/${branchA}`).set(as(token)).expect(200);
    await api()
      .patch(`/api/v1/branches/${branchA}`)
      .set(as(token))
      .send({ name: 'KPHB' })
      .expect(403);
    const superAdmin = await loginSuperAdmin(app);
    const other = await branchId(app, superAdmin, orgA, 'AMP');
    await api().get(`/api/v1/branches/${other}`).set(as(token)).expect(404);
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
      .send({ name: 'Sneaky', permissions: ['platform.branch.update'] })
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
      .send({ name: 'Bigger', permissions: ['platform.branch.update'] })
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

    // The Organization admin role only ever applies to the whole organization.
    const orgAdminRole = await roleId('Organization admin');
    await api()
      .post(`/api/v1/users/${me.body.id}/roles`)
      .set(as(adminA))
      .send({ roleId: orgAdminRole, branchId: branchA })
      .expect(400);

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

    // Taking away Director again: fine.
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
    // pageSize 100: logins and password changes are in the log too.
    const res = await api().get('/api/v1/audit-logs?pageSize=100').set(as(adminA)).expect(200);
    const actions = res.body.items.map(
      (i: { action: string; entity: string }) => `${i.action} ${i.entity}`,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'create branch',
        'update branch',
        'create role',
        'create user',
        'deactivate user',
      ]),
    );
  });
});
