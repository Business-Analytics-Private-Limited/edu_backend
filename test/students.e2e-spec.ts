/**
 * The Students module, part 1 (ADR-0020): admission, guardians (siblings), enrolments in
 * sections, status changes, campus admin limits, isolation.
 *
 * Organization "stu": institution SVJC (junior college: Year -> Group -> Section), campuses KKP
 * and AMP, academic year 2026-27 (active). KKP: 1st year -> MPC -> A, B. AMP: 1st year -> MPC -> A.
 * Ravi is Campus admin of KKP.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Students', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let other: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Builds 1st year -> MPC -> sections on a campus; returns the ids by code. */
  async function buildClasses(campus: string, sections: string[]) {
    const post = (body: object) =>
      api().post(`/api/v1/campuses/${ids[campus]}/classes`).set(as(admin)).send(body).expect(201);
    const year = await post({ name: '1st year', code: 'Y1' });
    const mpc = await post({ parentId: year.body.id, name: 'MPC', code: 'MPC' });
    ids[`${campus}_MPC`] = mpc.body.id;
    for (const s of sections) {
      const section = await post({ parentId: mpc.body.id, name: `Section ${s}`, code: s });
      ids[`${campus}_${s}`] = section.body.id;
    }
  }

  /** Admission body with sensible defaults. */
  const admission = (overrides: object) => ({
    campusId: ids.KKP,
    admissionNo: `ADM${Math.random().toString(36).slice(2, 8)}`,
    admissionDate: '2026-06-01',
    fullName: 'Student',
    dateOfBirth: '2010-05-14',
    gender: 'MALE',
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'stu', 'admin@stu.test');
    await createOrganization(app, superAdmin, 'stu-other', 'admin@stu-other.test');
    admin = await loginUser(app, 'admin@stu.test', 'Admin@12345');
    other = await loginUser(app, 'admin@stu-other.test', 'Admin@12345');

    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/academic`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);

    const svjc = await api()
      .post('/api/v1/institutions')
      .set(as(admin))
      .send({ name: 'Sri Vidya Junior College', code: 'SVJC', type: 'JUNIOR_COLLEGE' });
    ids.SVJC = svjc.body.id;
    for (const code of ['KKP', 'AMP']) {
      const campus = await api()
        .post(`/api/v1/institutions/${ids.SVJC}/campuses`)
        .set(as(admin))
        .send({ name: code, code });
      ids[code] = campus.body.id;
    }
    await buildClasses('KKP', ['A', 'B']);
    await buildClasses('AMP', ['A']);

    const year = await api().post('/api/v1/academic-years').set(as(admin)).send({
      institutionId: ids.SVJC,
      name: '2026-27',
      startsOn: '2026-06-01',
      endsOn: '2027-03-31',
    });
    ids.YEAR = year.body.id;
    await api().post(`/api/v1/academic-years/${ids.YEAR}/activate`).set(as(admin)).expect(200);
    const batch = await api()
      .post('/api/v1/batches')
      .set(as(admin))
      .send({ institutionId: ids.SVJC, name: '2026-28 batch', code: 'B2026', stage: 'Junior' });
    ids.BATCH = batch.body.id;

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const campusAdmin = roles.body.find((r: { name: string }) => r.name === 'Campus admin');
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'Ravi',
        email: 'ravi@stu.test',
        password: 'Password@123',
        roles: [{ roleId: campusAdmin.id, campusId: ids.KKP }],
      })
      .expect(201);
    ravi = await loginUser(app, 'ravi@stu.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('works only when the Students module is switched on', async () => {
    await api().get('/api/v1/students').set(as(admin)).expect(403);
    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/students`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
    await api().get('/api/v1/students').set(as(admin)).expect(200);
  });

  it('admits a student with a section, a batch and a guardian in one go', async () => {
    const res = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(
        admission({
          admissionNo: 'SVJC260001',
          fullName: 'Ravi Teja',
          batchId: ids.BATCH,
          enrolment: { academicYearId: ids.YEAR, classId: ids.KKP_A, rollNo: '1' },
          guardians: [{ fullName: 'Ramesh', relation: 'FATHER', phone: '9876543210' }],
        }),
      )
      .expect(201);
    ids.TEJA = res.body.id;
    expect(res.body.batch.name).toBe('2026-28 batch');
    expect(res.body.enrolments[0]).toMatchObject({ rollNo: '1', status: 'ACTIVE' });
    expect(res.body.enrolments[0].class.name).toBe('Section A');
    expect(res.body.guardians[0]).toMatchObject({ relation: 'FATHER', isPrimary: true });
    expect(res.body.statusChanges).toHaveLength(1);
  });

  it('refuses a duplicate admission number and a wrong section', async () => {
    await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(admission({ admissionNo: 'SVJC260001' }))
      .expect(409);
    // A group (MPC) is not a section.
    await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(admission({ enrolment: { academicYearId: ids.YEAR, classId: ids.KKP_MPC } }))
      .expect(400);
    // A section of another campus.
    await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(admission({ enrolment: { academicYearId: ids.YEAR, classId: ids.AMP_A } }))
      .expect(400);
  });

  it('links a sibling to the same guardian', async () => {
    const found = await api().get('/api/v1/guardians?phone=98765').set(as(admin)).expect(200);
    expect(found.body).toHaveLength(1);
    const sibling = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(
        admission({
          fullName: 'Sita Teja',
          gender: 'FEMALE',
          enrolment: { academicYearId: ids.YEAR, classId: ids.KKP_B },
          guardians: [{ existingGuardianId: found.body[0].id, relation: 'FATHER' }],
        }),
      )
      .expect(201);
    ids.SITA = sibling.body.id;
    const again = await api().get('/api/v1/guardians?phone=98765').set(as(admin)).expect(200);
    expect(again.body[0].students).toHaveLength(2);
  });

  it('a campus admin sees and admits students of their campus only', async () => {
    const atAmp = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(admission({ campusId: ids.AMP, fullName: 'Ameerpet Kid' }))
      .expect(201);
    ids.AMP_KID = atAmp.body.id;

    const list = await api().get('/api/v1/students').set(as(ravi)).expect(200);
    const names = list.body.items.map((s: { fullName: string }) => s.fullName);
    expect(names).toEqual(expect.arrayContaining(['Ravi Teja', 'Sita Teja']));
    expect(names).not.toContain('Ameerpet Kid');
    await api().get(`/api/v1/students/${ids.AMP_KID}`).set(as(ravi)).expect(404);

    await api()
      .post('/api/v1/students')
      .set(as(ravi))
      .send(admission({ campusId: ids.AMP }))
      .expect(403);
    await api().post('/api/v1/students').set(as(ravi)).send(admission({})).expect(201);
  });

  it('lists students by class (a whole group) and by search', async () => {
    const group = await api()
      .get(`/api/v1/students?classId=${ids.KKP_MPC}`)
      .set(as(admin))
      .expect(200);
    expect(group.body.items.map((s: { fullName: string }) => s.fullName).sort()).toEqual([
      'Ravi Teja',
      'Sita Teja',
    ]);
    const search = await api().get('/api/v1/students?search=sita').set(as(admin)).expect(200);
    expect(search.body.items).toHaveLength(1);
  });

  it('moves a student to another section; roll numbers are unique in a section', async () => {
    const teja = await api().get(`/api/v1/students/${ids.TEJA}`).set(as(ravi)).expect(200);
    const enrolmentId = teja.body.enrolments[0].id;
    await api()
      .patch(`/api/v1/students/${ids.TEJA}/enrolments/${enrolmentId}`)
      .set(as(ravi))
      .send({ classId: ids.KKP_B, rollNo: '1' })
      .expect(200);
    // Sita (also in B) can't take roll number 1.
    const sita = await api().get(`/api/v1/students/${ids.SITA}`).set(as(admin)).expect(200);
    await api()
      .patch(`/api/v1/students/${ids.SITA}/enrolments/${sita.body.enrolments[0].id}`)
      .set(as(admin))
      .send({ rollNo: '1' })
      .expect(409);
    // A section of another campus: refused.
    await api()
      .patch(`/api/v1/students/${ids.TEJA}/enrolments/${enrolmentId}`)
      .set(as(admin))
      .send({ classId: ids.AMP_A })
      .expect(400);
  });

  it('a status change is kept in the history and ends the active enrolment', async () => {
    const res = await api()
      .post(`/api/v1/students/${ids.TEJA}/status`)
      .set(as(admin))
      .send({ status: 'DISCONTINUED', effectiveOn: '2026-12-01', reason: 'Moved city' })
      .expect(200);
    expect(res.body.status).toBe('DISCONTINUED');
    expect(res.body.statusChanges).toHaveLength(2);
    expect(res.body.enrolments[0].status).toBe('LEFT');
    await api()
      .post(`/api/v1/students/${ids.TEJA}/status`)
      .set(as(admin))
      .send({ status: 'DISCONTINUED', effectiveOn: '2026-12-02' })
      .expect(400);
  });

  it('deleting a mistake keeps a guardian who still has another child', async () => {
    await api().delete(`/api/v1/students/${ids.TEJA}`).set(as(ravi)).expect(403); // no delete right
    await api().delete(`/api/v1/students/${ids.TEJA}`).set(as(admin)).expect(200);
    const sita = await api().get(`/api/v1/students/${ids.SITA}`).set(as(admin)).expect(200);
    expect(sita.body.guardians[0].guardian.fullName).toBe('Ramesh');
  });

  it('another organization sees none of it', async () => {
    const otherOrg = await api().get('/api/v1/organization').set(as(other)).expect(200);
    for (const key of ['academic', 'students']) {
      await api()
        .put(`/api/v1/super-admin/organizations/${otherOrg.body.id}/modules/${key}`)
        .set(as(superAdmin))
        .send({ enabled: true })
        .expect(200);
    }
    expect((await api().get('/api/v1/students').set(as(other)).expect(200)).body.items).toEqual([]);
    await api().get(`/api/v1/students/${ids.SITA}`).set(as(other)).expect(404);
    expect(
      (await api().get('/api/v1/guardians?phone=98765').set(as(other)).expect(200)).body,
    ).toEqual([]);
  });
});
