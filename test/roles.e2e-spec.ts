/**
 * Predefined roles changed by an organization (ADR-0029): the organization's copy becomes
 * "customized"; the super admin's later changes skip it but reach the other organizations;
 * "reset" brings back EduPlatform's version; a restart keeps customized permissions.
 *
 * Organizations "rol-a" (customizes Principal) and "rol-b" (doesn't).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PredefinedRolesService } from '../src/modules/roles/predefined-roles.service';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

interface Role {
  id: string;
  name: string;
  permissions: string[];
  customized: boolean;
  editable: boolean;
  defaultPermissions: string[] | null;
}

describe('Predefined roles changed by an organization', () => {
  let app: INestApplication;
  let superAdmin: string;
  let adminA: string;
  let adminB: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const principalOf = async (token: string): Promise<Role> =>
    (await api().get('/api/v1/roles').set(as(token)).expect(200)).body.find(
      (r: Role) => r.name === 'Principal',
    );

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    await createOrganization(app, superAdmin, 'rol-a', 'admin@rol-a.test');
    await createOrganization(app, superAdmin, 'rol-b', 'admin@rol-b.test');
    adminA = await loginUser(app, 'admin@rol-a.test', 'Admin@12345');
    adminB = await loginUser(app, 'admin@rol-b.test', 'Admin@12345');
  });

  afterAll(async () => {
    // Leave the Principal template as the other test files expect it.
    await api()
      .post('/api/v1/super-admin/predefined-roles/principal/reset')
      .set(as(superAdmin))
      .expect(200);
    await app.close();
  });

  it('says which roles can be changed', async () => {
    const roles: Role[] = (await api().get('/api/v1/roles').set(as(adminA)).expect(200)).body;
    const editable = Object.fromEntries(roles.map((r) => [r.name, r.editable]));
    expect(editable).toMatchObject({
      'Organization admin': false,
      Director: true,
      Principal: true,
      'Campus admin': true,
      'Senior faculty': true,
      'Junior faculty': true,
      'DTP operator': true,
      Parent: false,
      Student: false,
    });
  });

  it("the super admin's changes skip customized copies and reach the others", async () => {
    const principalA = await principalOf(adminA);
    await api()
      .patch(`/api/v1/roles/${principalA.id}`)
      .set(as(adminA))
      .send({
        permissions: [...principalA.permissions, 'access.role.view'].filter(
          (p, i, a) => a.indexOf(p) === i,
        ),
      })
      .expect(200);
    const customizedPermissions = (await principalOf(adminA)).permissions;

    const update = await api()
      .put('/api/v1/super-admin/predefined-roles/principal')
      .set(as(superAdmin))
      .send({ permissions: ['students.student.view'] })
      .expect(200);
    expect(update.body.customizedIn).toBe(1);

    expect((await principalOf(adminB)).permissions).toEqual(['students.student.view']);
    const a = await principalOf(adminA);
    expect(a).toMatchObject({ customized: true, defaultPermissions: ['students.student.view'] });
    expect(a.permissions).toEqual(customizedPermissions);

    const list = await api()
      .get('/api/v1/super-admin/predefined-roles')
      .set(as(superAdmin))
      .expect(200);
    expect(list.body.find((t: { key: string }) => t.key === 'principal').customizedIn).toBe(1);
  });

  it('a restart keeps customized permissions', async () => {
    const before = (await principalOf(adminA)).permissions;
    await app.get(PredefinedRolesService).onApplicationBootstrap();
    expect((await principalOf(adminA)).permissions).toEqual(before);
  });

  it("reset brings back EduPlatform's version, and later changes reach it again", async () => {
    const principalA = await principalOf(adminA);
    await api().post(`/api/v1/roles/${principalA.id}/reset`).set(as(adminA)).expect(200);
    expect(await principalOf(adminA)).toMatchObject({
      customized: false,
      permissions: ['students.student.view'],
    });

    await api()
      .put('/api/v1/super-admin/predefined-roles/principal')
      .set(as(superAdmin))
      .send({ permissions: ['students.student.view', 'audit.log.view'] })
      .expect(200);
    expect((await principalOf(adminA)).permissions).toEqual([
      'students.student.view',
      'audit.log.view',
    ]);
  });

  it('changes and resets are in the audit log', async () => {
    const log = await api().get('/api/v1/audit-logs?pageSize=100').set(as(adminA)).expect(200);
    const actions = log.body.items.map(
      (e: { action: string; entity: string }) => `${e.action} ${e.entity}`,
    );
    expect(actions).toEqual(expect.arrayContaining(['update role', 'reset role']));
  });
});
