/**
 * Login security (ADR-0028): temporary passwords must be changed first, logout ends the session,
 * a password change ends the other sessions, 5 failed logins lock the account, rate limits count
 * per visitor (X-Forwarded-For from the web apps), and two-step login for super admins.
 *
 * Organization "sec" with its admin; Ravi is a staff member with a temporary password.
 */
import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Login security', () => {
  let app: INestApplication;
  let superAdmin: string;
  let admin: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** A login from a given visitor address, as the web apps forward it. */
  const login = (email: string, password: string, from: string, code?: string) =>
    api().post('/api/v1/auth/login').set('X-Forwarded-For', from).send({ email, password, code });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    await createOrganization(app, superAdmin, 'sec', 'admin@sec.test');
    admin = await loginUser(app, 'admin@sec.test', 'Admin@12345');
    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'Ravi',
        email: 'ravi@sec.test',
        password: 'Temporary@123',
        roles: [{ roleId: roles.body.find((r: { name: string }) => r.name === 'Director').id }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a temporary password must be changed before anything else', async () => {
    const res = await login('ravi@sec.test', 'Temporary@123', '198.51.100.1').expect(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    const token = res.body.accessToken;

    const blocked = await api().get('/api/v1/dashboard').set(as(token)).expect(403);
    expect(blocked.body.message).toBe('Change your temporary password first');
    await api().get('/api/v1/auth/me').set(as(token)).expect(200);
    await api()
      .post('/api/v1/auth/change-password')
      .set(as(token))
      .send({ currentPassword: 'Temporary@123', newPassword: 'Temporary@123' })
      .expect(400);
    await api()
      .post('/api/v1/auth/change-password')
      .set(as(token))
      .send({ currentPassword: 'Temporary@123', newPassword: 'MyOwnPassword1' })
      .expect(200);
    await api().get('/api/v1/dashboard').set(as(token)).expect(200);
  });

  it('logout ends the session at once', async () => {
    const token = (await login('ravi@sec.test', 'MyOwnPassword1', '198.51.100.2').expect(200)).body
      .accessToken;
    await api().post('/api/v1/auth/logout').set(as(token)).expect(200);
    const res = await api().get('/api/v1/auth/me').set(as(token)).expect(401);
    expect(res.body.message).toBe('Your session has ended; please log in again');
  });

  it('a password change ends the other sessions, not this one', async () => {
    const laptop = (await login('ravi@sec.test', 'MyOwnPassword1', '198.51.100.3').expect(200)).body
      .accessToken;
    const phone = (await login('ravi@sec.test', 'MyOwnPassword1', '198.51.100.3').expect(200)).body
      .accessToken;
    await api()
      .post('/api/v1/auth/change-password')
      .set(as(laptop))
      .send({ currentPassword: 'MyOwnPassword1', newPassword: 'MyOwnPassword2' })
      .expect(200);
    await api().get('/api/v1/auth/me').set(as(phone)).expect(401);
    await api().get('/api/v1/auth/me').set(as(laptop)).expect(200);
  });

  it('5 failed logins in a row lock the account for 15 minutes', async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await login('ravi@sec.test', 'Wrong@12345', '203.0.113.7').expect(401);
      expect(res.body.message).toBe('Email or password is wrong');
    }
    const fifth = await login('ravi@sec.test', 'Wrong@12345', '203.0.113.7').expect(401);
    expect(fifth.body.message).toBe('Too many failed logins. Try again in 15 minute(s).');
    // Even the right password is refused while locked.
    await login('ravi@sec.test', 'MyOwnPassword2', '203.0.113.8').expect(401);

    // The attempts are in the audit log, with the visitor's address.
    const log = await api().get('/api/v1/audit-logs?pageSize=50').set(as(admin)).expect(200);
    expect(log.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'login failed',
          details: expect.objectContaining({
            reason: 'wrong password; account locked for 15 minutes',
            ip: '203.0.113.7',
          }),
        }),
      ]),
    );

    // When the lock runs out, the right password works again.
    await app.get(PrismaService).forAllOrganizations((db) =>
      db.user.update({
        where: { email: 'ravi@sec.test' },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      }),
    );
    await login('ravi@sec.test', 'MyOwnPassword2', '203.0.113.8').expect(200);
  });

  it('the login limit counts per visitor, not for everyone together', async () => {
    for (let i = 0; i < 10; i++) {
      await login('nobody@sec.test', 'Wrong@12345', '192.0.2.50').expect(401);
    }
    await login('nobody@sec.test', 'Wrong@12345', '192.0.2.50').expect(429);
    // Another visitor is not affected.
    await login('ravi@sec.test', 'MyOwnPassword2', '192.0.2.51').expect(200);
  });

  it('super admins can turn on two-step login', async () => {
    const auth = as(superAdmin);
    const setup = await api().post('/api/v1/auth/two-factor/setup').set(auth).expect(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    const secret: string = setup.body.secret;

    // The secret is stored encrypted, never as it is.
    const stored = await app
      .get(PrismaService)
      .superAdmin.findUniqueOrThrow({ where: { email: 'superadmin@test.local' } });
    expect(stored.totpSecret).toMatch(/^v1\./);
    expect(stored.totpSecret).not.toContain(secret);

    await api()
      .post('/api/v1/auth/two-factor/enable')
      .set(auth)
      .send({ code: '000000' })
      .expect(400);
    await api()
      .post('/api/v1/auth/two-factor/enable')
      .set(auth)
      .send({ code: authenticator.generate(secret) })
      .expect(200);

    const superLogin = (code?: string) =>
      api()
        .post('/api/v1/auth/super-admin/login')
        .set('X-Forwarded-For', '192.0.2.60')
        .send({ email: 'superadmin@test.local', password: 'SuperAdmin@123', code });
    const noCode = await superLogin().expect(401);
    expect(noCode.body).toMatchObject({ twoFactorRequired: true });
    await superLogin('000000').expect(401);
    const ok = await superLogin(authenticator.generate(secret)).expect(200);

    // Off again (needs the password and a code), so the other test files can log in.
    await api()
      .post('/api/v1/auth/two-factor/disable')
      .set(as(ok.body.accessToken))
      .send({ password: 'SuperAdmin@123', code: authenticator.generate(secret) })
      .expect(200);
  });
});
