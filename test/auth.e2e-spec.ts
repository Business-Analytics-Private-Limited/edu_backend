/**
 * Login and "who am I".
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginSuperAdmin } from './helpers';

describe('Login', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('health check works without login', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('super admin can log in and see who they are', async () => {
    const token = await loginSuperAdmin(app);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body).toMatchObject({ type: 'super_admin', email: 'superadmin@test.local' });
  });

  it('a wrong password gives the same message as an unknown email', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/super-admin/login')
      .send({ email: 'superadmin@test.local', password: 'wrong' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/super-admin/login')
      .send({ email: 'nobody@test.local', password: 'wrong' })
      .expect(401);
    expect(wrongPassword.body.message).toBe('Email or password is wrong');
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('refuses requests without a token, or with a fake one', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('checks request bodies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', extra: 'field' })
      .expect(400);
    const messages: string[] = res.body.message;
    expect(messages).toEqual(
      expect.arrayContaining(['email must be an email', 'property extra should not exist']),
    );
  });
});
