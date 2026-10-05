/**
 * The parent and student portal (ADR-0022): logins linked to a guardian or a student, what they
 * may see, and that they can never use staff screens.
 *
 * Organization "por": campus KKP with siblings Teja and Sita (father Ramesh), campus AMP with
 * Kiran (mother Lakshmi). Attendance is marked today for Teja and Sita.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createOrganization,
  createTestApp,
  institutionId,
  JUNIOR_COLLEGE_LEVELS,
  loginSuperAdmin,
  loginUser,
  setClassLevels,
  SVJC,
} from './helpers';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

describe('Parent and student portal', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ampAdmin: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setModule = (key: string, enabled: boolean) =>
    api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/${key}`)
      .set(as(superAdmin))
      .send({ enabled })
      .expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'por', 'admin@por.test', [SVJC]);
    admin = await loginUser(app, 'admin@por.test', 'Admin@12345');
    for (const key of ['academic', 'students', 'attendance']) await setModule(key, true);

    ids.SVJC = await institutionId(app, superAdmin, orgId, 'SVJC');
    await setClassLevels(app, admin, ids.SVJC, JUNIOR_COLLEGE_LEVELS);
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/weekly-off`)
      .set(as(admin))
      .send({ days: [] });
    for (const code of ['KKP', 'AMP']) {
      const campus = await api()
        .post(`/api/v1/institutions/${ids.SVJC}/campuses`)
        .set(as(admin))
        .send({ name: code, code });
      ids[code] = campus.body.id;
      const post = (body: object) =>
        api().post(`/api/v1/campuses/${ids[code]}/classes`).set(as(admin)).send(body).expect(201);
      const y1 = await post({ name: '1st year', code: 'Y1' });
      const mpc = await post({ parentId: y1.body.id, name: 'MPC', code: 'MPC' });
      ids[`${code}_A`] = (
        await post({ parentId: mpc.body.id, name: 'Section A', code: 'A' })
      ).body.id;
    }
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 60);
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 200);
    const year = await api()
      .post('/api/v1/academic-years')
      .set(as(admin))
      .send({
        institutionId: ids.SVJC,
        name: 'This year',
        startsOn: start.toISOString().slice(0, 10),
        endsOn: end.toISOString().slice(0, 10),
      });
    ids.YEAR = year.body.id;

    const admit = async (name: string, campus: string, guardian: object) => {
      const res = await api()
        .post('/api/v1/students')
        .set(as(admin))
        .send({
          campusId: ids[campus],
          admissionNo: `P-${name}`,
          admissionDate: start.toISOString().slice(0, 10),
          fullName: name,
          dateOfBirth: '2010-01-01',
          gender: 'MALE',
          enrolment: { academicYearId: ids.YEAR, classId: ids[`${campus}_A`] },
          guardians: [guardian],
        })
        .expect(201);
      ids[name] = res.body.id;
      ids[`${name}_guardian`] = res.body.guardians[0].guardian.id;
    };
    await admit('Teja', 'KKP', { fullName: 'Ramesh', relation: 'FATHER', phone: '9000000001' });
    await admit('Sita', 'KKP', { existingGuardianId: ids.Teja_guardian, relation: 'FATHER' });
    await admit('Kiran', 'AMP', { fullName: 'Lakshmi', relation: 'MOTHER' });

    await api()
      .post('/api/v1/attendance/markings')
      .set(as(admin))
      .send({
        classId: ids.KKP_A,
        date: today,
        entries: [
          { studentId: ids.Teja, status: 'PRESENT' },
          { studentId: ids.Sita, status: 'ABSENT', remark: 'Fever' },
        ],
      })
      .expect(200);

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const campusAdmin = roles.body.find((r: { name: string }) => r.name === 'Campus admin');
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'AMP admin',
        email: 'amp@por.test',
        password: 'Password@123',
        roles: [{ roleId: campusAdmin.id, campusId: ids.AMP }],
      })
      .expect(201);
    ampAdmin = await loginUser(app, 'amp@por.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  const grant = (studentId: string, body: object) =>
    api()
      .post(`/api/v1/students/${studentId}/portal-access`)
      .set(as(admin))
      .send({ password: 'Portal@12345', ...body });

  it('logins can only be given when the portal module is on', async () => {
    await grant(ids.Teja, { for: 'STUDENT', email: 'teja@por.test' }).expect(403);
    await setModule('portal', true);
  });

  it("one parent login covers all the guardian's children", async () => {
    await grant(ids.Teja, {
      for: 'GUARDIAN',
      guardianId: ids.Teja_guardian,
      email: 'ramesh@por.test',
    }).expect(201);
    // Same father, via the sibling: refused, he already has a login.
    await grant(ids.Sita, {
      for: 'GUARDIAN',
      guardianId: ids.Teja_guardian,
      email: 'ramesh2@por.test',
    }).expect(409);
    // A guardian who isn't this student's.
    await grant(ids.Teja, {
      for: 'GUARDIAN',
      guardianId: ids.Kiran_guardian,
      email: 'x@por.test',
    }).expect(400);
    await grant(ids.Teja, { for: 'STUDENT', email: 'teja@por.test' }).expect(201);
    await grant(ids.Teja, { for: 'STUDENT', email: 'teja2@por.test' }).expect(409);

    const profile = await api().get(`/api/v1/students/${ids.Teja}`).set(as(admin)).expect(200);
    expect(profile.body.login.email).toBe('teja@por.test');
    expect(profile.body.guardians[0].guardian.login.email).toBe('ramesh@por.test');
  });

  it('a parent sees their children, and nobody else', async () => {
    const parent = await loginUser(app, 'ramesh@por.test', 'Portal@12345');
    const me = await api().get('/api/v1/portal/me').set(as(parent)).expect(200);
    expect(me.body.kind).toBe('parent');
    expect(me.body.students.map((s: { fullName: string }) => s.fullName)).toEqual(['Sita', 'Teja']);
    expect(me.body.students[0].enrolments[0].class.name).toBe('Section A');

    const sita = await api()
      .get(`/api/v1/portal/students/${ids.Sita}/attendance?from=${today}&to=${today}`)
      .set(as(parent))
      .expect(200);
    expect(sita.body.days[0]).toMatchObject({ status: 'ABSENT', remark: 'Fever' });
    expect(sita.body.percentage).toBe(0);

    await api().get(`/api/v1/portal/students/${ids.Kiran}`).set(as(parent)).expect(404);
  });

  it('a student sees only themselves', async () => {
    const student = await loginUser(app, 'teja@por.test', 'Portal@12345');
    const me = await api().get('/api/v1/portal/me').set(as(student)).expect(200);
    expect(me.body.students.map((s: { fullName: string }) => s.fullName)).toEqual(['Teja']);
    await api().get(`/api/v1/portal/students/${ids.Sita}`).set(as(student)).expect(404);
  });

  it('portal logins can never use staff screens, and staff never see them as users', async () => {
    const parent = await loginUser(app, 'ramesh@por.test', 'Portal@12345');
    const me = await api().get('/api/v1/auth/me').set(as(parent)).expect(200);
    expect(me.body).toMatchObject({ kind: 'parent', permissions: [], grants: [] });
    for (const path of [
      '/api/v1/students',
      '/api/v1/dashboard',
      '/api/v1/users',
      '/api/v1/roles',
    ]) {
      await api().get(path).set(as(parent)).expect(403);
    }
    // ...and staff can't use the portal.
    await api().get('/api/v1/portal/me').set(as(admin)).expect(403);

    const users = await api().get('/api/v1/users').set(as(admin)).expect(200);
    const emails = users.body.items.map((u: { email: string }) => u.email);
    expect(emails).not.toContain('ramesh@por.test');
    expect(emails).not.toContain('teja@por.test');
  });

  it("a campus admin manages only their campus's students' logins", async () => {
    await api()
      .post(`/api/v1/students/${ids.Teja}/portal-access`)
      .set(as(ampAdmin))
      .send({ for: 'STUDENT', email: 'other@por.test', password: 'Portal@12345' })
      .expect(404);
    await api()
      .post(`/api/v1/students/${ids.Kiran}/portal-access`)
      .set(as(ampAdmin))
      .send({
        for: 'GUARDIAN',
        guardianId: ids.Kiran_guardian,
        email: 'lakshmi@por.test',
        password: 'Portal@12345',
      })
      .expect(201);
  });

  it('removing a login stops it at once', async () => {
    const student = await loginUser(app, 'teja@por.test', 'Portal@12345');
    const profile = await api().get(`/api/v1/students/${ids.Teja}`).set(as(admin)).expect(200);
    await api()
      .delete(`/api/v1/students/${ids.Teja}/portal-access/${profile.body.login.id}`)
      .set(as(admin))
      .expect(200);
    await api().get('/api/v1/portal/me').set(as(student)).expect(401);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'teja@por.test', password: 'Portal@12345' })
      .expect(401);
  });

  it('switching the portal module off closes the portal', async () => {
    const parent = await loginUser(app, 'ramesh@por.test', 'Portal@12345');
    await setModule('portal', false);
    await api().get('/api/v1/portal/me').set(as(parent)).expect(403);
  });
});
