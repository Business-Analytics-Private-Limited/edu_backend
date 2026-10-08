/**
 * Student documents and file storage (ADR-0023): document types, upload with content checks,
 * verify / reject, download, delete, branch limits, the portal, isolation.
 *
 * Organization "doc": branches KKP (student Teja, father Ramesh) and AMP. Ravi = Branch admin of
 * KKP; Jaya = Junior faculty at KKP (no document permissions).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { branchId, createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const FAKE_PDF = Buffer.from('MZ this is really a program, not a PDF');

describe('Student documents', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let jaya: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const upload = (token: string, studentId: string, typeId: string, file: Buffer, name: string) =>
    api()
      .post(`/api/v1/students/${studentId}/documents`)
      .set(as(token))
      .field('documentTypeId', typeId)
      .attach('file', file, name);

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'doc', 'admin@doc.test', {
      branches: [
        { name: 'KKP', code: 'KKP' },
        { name: 'AMP', code: 'AMP' },
      ],
      modules: ['academic', 'students', 'portal'],
    });
    admin = await loginUser(app, 'admin@doc.test', 'Admin@12345');
    ids.KKP = await branchId(app, superAdmin, orgId, 'KKP');
    ids.AMP = await branchId(app, superAdmin, orgId, 'AMP');
    const student = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send({
        branchId: ids.KKP,
        admissionNo: 'D1',
        admissionDate: '2026-06-01',
        fullName: 'Teja',
        dateOfBirth: '2010-01-01',
        gender: 'MALE',
        guardians: [{ fullName: 'Ramesh', relation: 'FATHER' }],
      })
      .expect(201);
    ids.TEJA = student.body.id;
    ids.RAMESH = student.body.guardians[0].guardian.id;

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    for (const [email, name] of [
      ['ravi@doc.test', 'Branch admin'],
      ['jaya@doc.test', 'Junior faculty'],
    ]) {
      await api()
        .post('/api/v1/users')
        .set(as(admin))
        .send({
          name: email.split('@')[0],
          email,
          password: 'Password@123',
          roles: [{ roleId: role(name), branchId: ids.KKP }],
        })
        .expect(201);
    }
    ravi = await loginUser(app, 'ravi@doc.test', 'Password@123');
    jaya = await loginUser(app, 'jaya@doc.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it("document types: the organization's list, required and visible in the portal", async () => {
    const add = (body: object) =>
      api().post('/api/v1/document-types').set(as(admin)).send(body).expect(201);
    ids.TC = (
      await add({ name: 'Transfer certificate', isRequired: true, visibleInPortal: true })
    ).body.id;
    ids.AADHAAR = (await add({ name: 'Aadhaar copy', isRequired: true })).body.id;
    // A branch admin can't change the organization's list.
    await api().post('/api/v1/document-types').set(as(ravi)).send({ name: 'Photo' }).expect(403);
    const types = await api().get('/api/v1/document-types').set(as(ravi)).expect(200);
    expect(types.body.map((t: { name: string }) => t.name)).toEqual([
      'Aadhaar copy',
      'Transfer certificate',
    ]);
  });

  it('upload: real PDF / JPG / PNG only, up to 5 MB', async () => {
    await upload(ravi, ids.TEJA, ids.TC, FAKE_PDF, 'tc.pdf').expect(400);
    await upload(ravi, ids.TEJA, ids.TC, Buffer.alloc(6 * 1024 * 1024, 0x25), 'big.pdf').expect(
      413,
    );
    const tc = await upload(ravi, ids.TEJA, ids.TC, PDF, '../../etc/tc.pdf').expect(201);
    expect(tc.body).toMatchObject({ status: 'UPLOADED', uploadedByName: 'ravi' });
    expect(tc.body.file).toMatchObject({ originalName: 'tc.pdf', mimeType: 'application/pdf' });
    ids.TC_DOC = tc.body.id;
    ids.AADHAAR_DOC = (
      await upload(ravi, ids.TEJA, ids.AADHAAR, PNG, 'aadhaar.png').expect(201)
    ).body.id;

    const list = await api()
      .get(`/api/v1/students/${ids.TEJA}/documents`)
      .set(as(ravi))
      .expect(200);
    expect(list.body.documents).toHaveLength(2);
    expect(list.body.missing).toEqual([]);
  });

  it('download gives the same bytes back', async () => {
    const res = await api()
      .get(`/api/v1/students/${ids.TEJA}/documents/${ids.TC_DOC}/file`)
      .set(as(ravi))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''tc.pdf");
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
  });

  it('verify / reject (a rejection needs a reason); a rejected required document is missing again', async () => {
    await api()
      .patch(`/api/v1/students/${ids.TEJA}/documents/${ids.TC_DOC}`)
      .set(as(ravi))
      .send({ status: 'VERIFIED' })
      .expect(200);
    await api()
      .patch(`/api/v1/students/${ids.TEJA}/documents/${ids.AADHAAR_DOC}`)
      .set(as(ravi))
      .send({ status: 'REJECTED' })
      .expect(400);
    await api()
      .patch(`/api/v1/students/${ids.TEJA}/documents/${ids.AADHAAR_DOC}`)
      .set(as(ravi))
      .send({ status: 'REJECTED', note: 'Blurred' })
      .expect(200);
    const list = await api()
      .get(`/api/v1/students/${ids.TEJA}/documents`)
      .set(as(ravi))
      .expect(200);
    expect(list.body.missing.map((t: { name: string }) => t.name)).toEqual(['Aadhaar copy']);
  });

  it('permissions and places', async () => {
    // A junior faculty member has no document permissions.
    await api().get(`/api/v1/students/${ids.TEJA}/documents`).set(as(jaya)).expect(403);
    await upload(jaya, ids.TEJA, ids.TC, PDF, 'tc.pdf').expect(403);
    // A student of another branch is out of Ravi's reach.
    const amp = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send({
        branchId: ids.AMP,
        admissionNo: 'D2',
        admissionDate: '2026-06-01',
        fullName: 'Kiran',
        dateOfBirth: '2010-01-01',
        gender: 'MALE',
      })
      .expect(201);
    await upload(ravi, amp.body.id, ids.TC, PDF, 'tc.pdf').expect(404);
  });

  it('the portal shows only documents of types visible to parents', async () => {
    await api()
      .post(`/api/v1/students/${ids.TEJA}/portal-access`)
      .set(as(admin))
      .send({
        for: 'GUARDIAN',
        guardianId: ids.RAMESH,
        email: 'ramesh@doc.test',
        password: 'Portal@12345',
      })
      .expect(201);
    const parent = await loginUser(app, 'ramesh@doc.test', 'Portal@12345');
    const list = await api()
      .get(`/api/v1/portal/students/${ids.TEJA}/documents`)
      .set(as(parent))
      .expect(200);
    expect(list.body.map((d: { documentType: { name: string } }) => d.documentType.name)).toEqual([
      'Transfer certificate',
    ]);
    await api()
      .get(`/api/v1/portal/students/${ids.TEJA}/documents/${ids.TC_DOC}/file`)
      .set(as(parent))
      .expect(200);
    await api()
      .get(`/api/v1/portal/students/${ids.TEJA}/documents/${ids.AADHAAR_DOC}/file`)
      .set(as(parent))
      .expect(404);
    // Staff download routes refuse portal logins.
    await api()
      .get(`/api/v1/students/${ids.TEJA}/documents/${ids.TC_DOC}/file`)
      .set(as(parent))
      .expect(403);
  });

  it('delete removes the document; a type in use cannot be deleted', async () => {
    await api().delete(`/api/v1/document-types/${ids.TC}`).set(as(admin)).expect(400);
    await api()
      .delete(`/api/v1/students/${ids.TEJA}/documents/${ids.AADHAAR_DOC}`)
      .set(as(ravi))
      .expect(200);
    await api()
      .get(`/api/v1/students/${ids.TEJA}/documents/${ids.AADHAAR_DOC}/file`)
      .set(as(ravi))
      .expect(404);
  });

  it('another organization sees none of it', async () => {
    const otherOrg = await createOrganization(app, superAdmin, 'doc-other', 'admin@doc-other.test');
    for (const key of ['academic', 'students']) {
      await api()
        .put(`/api/v1/super-admin/organizations/${otherOrg}/modules/${key}`)
        .set(as(superAdmin))
        .send({ enabled: true })
        .expect(200);
    }
    const other = await loginUser(app, 'admin@doc-other.test', 'Admin@12345');
    await api()
      .get(`/api/v1/students/${ids.TEJA}/documents/${ids.TC_DOC}/file`)
      .set(as(other))
      .expect(404);
    expect((await api().get('/api/v1/document-types').set(as(other)).expect(200)).body).toEqual([]);
  });
});
