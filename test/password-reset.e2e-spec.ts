/**
 * Admin-issued password reset (ADR-0036): an admin gives a staff member who forgot their password
 * a new temporary one, which must be changed at the next login. The super admin can do the same
 * for an organization's admins.
 *
 * Organization "pw-reset" with branches KPHB and Ameerpet: Meena is Branch admin at KPHB, Ravi is
 * Senior faculty at KPHB, Sita is Senior faculty at Ameerpet. Organization "pw-other" is next door.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { branchId, createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

/** What a generated temporary password looks like: three groups of four, e.g. "Kq7m-Xp3d-Rt9w". */
const TEMPORARY_PASSWORD = /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/;

describe('Password reset', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string; // the organization admin
  let otherAdmin: string; // organization "pw-other"'s admin
  let meena: string; // Branch admin at KPHB
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** A login from its own visitor address, so the 10-per-minute limit doesn't get in the way. */
  let visitor = 0;
  const login = (email: string, password: string) =>
    api()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', `10.0.36.${++visitor}`)
      .send({ email, password });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'pw-reset', 'admin@reset.test', {
      branches: [
        { name: 'KPHB', code: 'KPHB' },
        { name: 'Ameerpet', code: 'AMP' },
      ],
    });
    await createOrganization(app, superAdmin, 'pw-other', 'admin@pw-other.test');
    admin = await loginUser(app, 'admin@reset.test', 'Admin@12345');
    otherAdmin = await loginUser(app, 'admin@pw-other.test', 'Admin@12345');

    const kphb = await branchId(app, superAdmin, orgId, 'KPHB');
    const amp = await branchId(app, superAdmin, orgId, 'AMP');
    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    const staff = [
      { key: 'meena', role: 'Branch admin', branch: kphb },
      { key: 'ravi', role: 'Senior faculty', branch: kphb },
      { key: 'sita', role: 'Senior faculty', branch: amp },
    ];
    for (const s of staff) {
      const res = await api()
        .post('/api/v1/users')
        .set(as(admin))
        .send({
          name: s.key,
          email: `${s.key}@reset.test`,
          password: 'Staff@12345',
          roles: [{ roleId: role(s.role), branchId: s.branch }],
        })
        .expect(201);
      ids[s.key] = res.body.id;
    }
    const me = await api().get('/api/v1/auth/me').set(as(admin)).expect(200);
    ids.admin = me.body.id;
    meena = await loginUser(app, 'meena@reset.test', 'Staff@12345');
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives a new temporary password that must be changed at the next login', async () => {
    const ravi = await loginUser(app, 'ravi@reset.test', 'Staff@12345'); // changes it to "...-new1"

    const res = await api()
      .post(`/api/v1/users/${ids.ravi}/reset-password`)
      .set(as(admin))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user).toEqual({ id: ids.ravi, name: 'ravi', email: 'ravi@reset.test' });
    const temporary: string = res.body.temporaryPassword;
    expect(temporary).toMatch(TEMPORARY_PASSWORD);

    // Logged out everywhere, and the old password no longer works.
    await api().get('/api/v1/auth/me').set(as(ravi)).expect(401);
    await login('ravi@reset.test', 'Staff@12345-new1').expect(401);

    // The temporary one works, but only to change it.
    const first = await login('ravi@reset.test', temporary).expect(200);
    expect(first.body.user.mustChangePassword).toBe(true);
    const blocked = await api().get('/api/v1/branches').set(as(first.body.accessToken)).expect(403);
    expect(blocked.body.message).toBe('Change your temporary password first');
    await api()
      .post('/api/v1/auth/change-password')
      .set(as(first.body.accessToken))
      .send({ currentPassword: temporary, newPassword: 'MyOwnPass99' })
      .expect(200);
    const after = await login('ravi@reset.test', 'MyOwnPass99').expect(200);
    expect(after.body.user.mustChangePassword).toBe(false);
  });

  it('lifts a lockout from failed logins', async () => {
    for (let i = 0; i < 5; i++) await login('sita@reset.test', 'wrong-password').expect(401);
    await login('sita@reset.test', 'Staff@12345').expect(401); // locked

    const res = await api()
      .post(`/api/v1/users/${ids.sita}/reset-password`)
      .set(as(admin))
      .expect(200);
    await login('sita@reset.test', res.body.temporaryPassword).expect(200);
  });

  it('every reset makes a different password', async () => {
    const a = await api().post(`/api/v1/users/${ids.sita}/reset-password`).set(as(admin));
    const b = await api().post(`/api/v1/users/${ids.sita}/reset-password`).set(as(admin));
    expect(a.body.temporaryPassword).not.toBe(b.body.temporaryPassword);
    await login('sita@reset.test', a.body.temporaryPassword).expect(401); // replaced by b
    await login('sita@reset.test', b.body.temporaryPassword).expect(200);
  });

  it('your own password you change yourself', async () => {
    const res = await api()
      .post(`/api/v1/users/${ids.admin}/reset-password`)
      .set(as(admin))
      .expect(400);
    expect(res.body.message).toBe('To change your own password, use Change password');
  });

  it("a Branch admin resets their branch's staff, not another branch's or the admin's", async () => {
    await api().post(`/api/v1/users/${ids.ravi}/reset-password`).set(as(meena)).expect(200);
    // Ameerpet's staff are not even visible to a KPHB Branch admin.
    await api().post(`/api/v1/users/${ids.sita}/reset-password`).set(as(meena)).expect(404);
    // The Organization admin has roles beyond a Branch admin's reach.
    await api().post(`/api/v1/users/${ids.admin}/reset-password`).set(as(meena)).expect(404);
  });

  it('needs access.user.update', async () => {
    const sitaPassword = (
      await api().post(`/api/v1/users/${ids.sita}/reset-password`).set(as(admin)).expect(200)
    ).body.temporaryPassword;
    const sita = await loginUser(app, 'sita@reset.test', sitaPassword);
    await api().post(`/api/v1/users/${ids.ravi}/reset-password`).set(as(sita)).expect(403);
  });

  it("organization B can't reset organization A's users", async () => {
    await api().post(`/api/v1/users/${ids.ravi}/reset-password`).set(as(otherAdmin)).expect(404);
  });

  it('is in the audit log, without the password', async () => {
    const res = await api().get('/api/v1/audit-logs?pageSize=100').set(as(admin)).expect(200);
    const resets = res.body.items.filter(
      (i: { action: string; entityId: string }) =>
        i.action === 'reset password' && i.entityId === ids.ravi,
    );
    expect(resets.length).toBeGreaterThan(0);
    expect(resets[0].details).toEqual({ user: 'ravi' });
    // The other organization doesn't see it.
    const other = await api().get('/api/v1/audit-logs?pageSize=100').set(as(otherAdmin));
    expect(other.body.items.some((i: { entityId: string }) => i.entityId === ids.ravi)).toBe(false);
  });

  describe('by the super admin', () => {
    const resetAdmin = (organizationId: string, userId: string, token = superAdmin) =>
      api()
        .post(`/api/v1/super-admin/organizations/${organizationId}/admins/${userId}/reset-password`)
        .set(as(token));

    it("resets an organization admin's password", async () => {
      const res = await resetAdmin(orgId, ids.admin).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.user.email).toBe('admin@reset.test');
      expect(res.body.temporaryPassword).toMatch(TEMPORARY_PASSWORD);

      await api().get('/api/v1/auth/me').set(as(admin)).expect(401); // logged out
      const first = await login('admin@reset.test', res.body.temporaryPassword).expect(200);
      expect(first.body.user.mustChangePassword).toBe(true);
      await api()
        .post('/api/v1/auth/change-password')
        .set(as(first.body.accessToken))
        .send({ currentPassword: res.body.temporaryPassword, newPassword: 'AdminAgain99' })
        .expect(200);
      admin = (await login('admin@reset.test', 'AdminAgain99').expect(200)).body.accessToken;
    });

    it('only for admins of that organization; other staff are reset by their own admins', async () => {
      await resetAdmin(orgId, ids.ravi).expect(404);
      const other = await api().get('/api/v1/auth/me').set(as(otherAdmin)).expect(200);
      await resetAdmin(orgId, other.body.id).expect(404); // an admin, but of another organization
    });

    it('organization users cannot call it', async () => {
      await resetAdmin(orgId, ids.admin, admin).expect(403);
    });
  });
});
