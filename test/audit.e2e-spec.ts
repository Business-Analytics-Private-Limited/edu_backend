/**
 * The audit log (ADR-0027): logins (also failed ones), password changes and document downloads
 * are recorded; the app can't change or delete entries; the super admin sees every entry.
 *
 * Organization "aud" with its admin; one student with a document.
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
  SVJC,
} from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

interface Entry {
  action: string;
  entity: string;
  actorType: string;
  actorName: string | null;
  organizationId: string | null;
  organizationName?: string | null;
  details: Record<string, unknown> | null;
}

describe('Audit log', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** The newest entries of the organization's own log. */
  const orgLog = async (): Promise<Entry[]> =>
    (await api().get('/api/v1/audit-logs?pageSize=100').set(as(admin)).expect(200)).body.items;
  const platformLog = async (query = ''): Promise<Entry[]> =>
    (
      await api()
        .get(`/api/v1/super-admin/audit-logs?pageSize=100${query}`)
        .set(as(superAdmin))
        .expect(200)
    ).body.items;

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'aud', 'admin@aud.test', [SVJC]);
    admin = await loginUser(app, 'admin@aud.test', 'Admin@12345');
  });

  afterAll(async () => {
    await app.close();
  });

  it('records logins, failed logins and why they failed', async () => {
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'admin@aud.test', password: 'Wrong@12345' })
      .expect(401);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@aud.test', password: 'Wrong@12345' })
      .expect(401);

    const log = await orgLog();
    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'login', actorName: 'aud admin' }),
        expect.objectContaining({
          action: 'login failed',
          actorName: 'aud admin',
          details: { email: 'admin@aud.test', reason: 'wrong password' },
        }),
      ]),
    );
    // An unknown email belongs to no organization: only the super admin sees it.
    expect(log.some((e) => e.details?.email === 'nobody@aud.test')).toBe(false);
    const platform = await platformLog('&organizationId=platform&action=login%20failed');
    expect(platform).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: 'unknown',
          details: { email: 'nobody@aud.test', reason: 'unknown email' },
        }),
      ]),
    );
    // Super admin logins are on the platform's log.
    expect(await platformLog('&organizationId=platform&action=login')).toEqual(
      expect.arrayContaining([expect.objectContaining({ actorType: 'super_admin' })]),
    );
  });

  it('records password changes, never the password', async () => {
    await api()
      .post('/api/v1/auth/change-password')
      .set(as(admin))
      .send({ currentPassword: 'Admin@12345', newPassword: 'Admin@123456' })
      .expect(200);
    const entry = (await orgLog()).find((e) => e.action === 'change password');
    expect(entry).toMatchObject({ entity: 'user', actorName: 'aud admin' });
    expect(JSON.stringify(entry)).not.toContain('Admin@123456');
  });

  it('records who downloaded a document', async () => {
    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/academic`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/students`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
    const svjc = await institutionId(app, superAdmin, orgId, 'SVJC');
    const campus = await api()
      .post(`/api/v1/institutions/${svjc}/campuses`)
      .set(as(admin))
      .send({ name: 'Main', code: 'MAIN' })
      .expect(201);
    const student = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send({
        campusId: campus.body.id,
        admissionNo: 'A1',
        admissionDate: '2026-06-01',
        fullName: 'Teja',
        dateOfBirth: '2010-01-01',
        gender: 'MALE',
      })
      .expect(201);
    const type = await api()
      .post('/api/v1/document-types')
      .set(as(admin))
      .send({ institutionId: svjc, name: 'Aadhaar copy' })
      .expect(201);
    const document = await api()
      .post(`/api/v1/students/${student.body.id}/documents`)
      .set(as(admin))
      .field('documentTypeId', type.body.id)
      .attach('file', PDF, 'aadhaar.pdf')
      .expect(201);
    await api()
      .get(`/api/v1/students/${student.body.id}/documents/${document.body.id}/file`)
      .set(as(admin))
      .expect(200);

    expect(await orgLog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'download document',
          details: { documentId: document.body.id },
        }),
      ]),
    );
  });

  it('the app can only add entries, never change or delete them', async () => {
    const prisma = app.get(PrismaService);
    await expect(
      prisma.forAllOrganizations((db) => db.$executeRaw`UPDATE audit_logs SET action = 'x'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.forAllOrganizations((db) => db.$executeRaw`DELETE FROM audit_logs`),
    ).rejects.toThrow(/permission denied/);
  });

  it("the super admin sees every organization's entries, with the organization's name", async () => {
    const entries = await platformLog(`&organizationId=${orgId}`);
    expect(entries.length).toBeGreaterThan(3);
    expect(entries.every((e) => e.organizationName === 'aud society')).toBe(true);
    // Only for the super admin.
    await api().get('/api/v1/super-admin/audit-logs').set(as(admin)).expect(403);
  });
});
