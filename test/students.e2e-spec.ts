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
    orgId = await createOrganization(app, superAdmin, 'stu', 'admin@stu.test', [SVJC]);
    await createOrganization(app, superAdmin, 'stu-other', 'admin@stu-other.test');
    admin = await loginUser(app, 'admin@stu.test', 'Admin@12345');
    other = await loginUser(app, 'admin@stu-other.test', 'Admin@12345');

    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/academic`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);

    ids.SVJC = await institutionId(app, superAdmin, orgId, 'SVJC');
    await setClassLevels(app, admin, ids.SVJC, JUNIOR_COLLEGE_LEVELS);
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

  it('promotion: preview suggests the next year by the same path', async () => {
    // Next year's classes on KKP, and the next academic year.
    const post = (body: object) =>
      api().post(`/api/v1/campuses/${ids.KKP}/classes`).set(as(admin)).send(body).expect(201);
    const y2 = await post({ name: '2nd year', code: 'Y2', sortOrder: 1 });
    const mpc2 = await post({ parentId: y2.body.id, name: 'MPC', code: 'MPC' });
    for (const s of ['A', 'B']) {
      const section = await post({ parentId: mpc2.body.id, name: `Section ${s}`, code: s });
      ids[`KKP2_${s}`] = section.body.id;
    }
    const year2 = await api()
      .post('/api/v1/academic-years')
      .set(as(admin))
      .send({
        institutionId: ids.SVJC,
        name: '2027-28',
        startsOn: '2027-06-01',
        endsOn: '2028-03-31',
      })
      .expect(201);
    ids.YEAR2 = year2.body.id;

    // Two more students in Section A with roll numbers.
    for (const [name, roll] of [
      ['Anil', '1'],
      ['Bhavya', '2'],
    ]) {
      await api()
        .post('/api/v1/students')
        .set(as(admin))
        .send(
          admission({
            fullName: name,
            batchId: ids.BATCH,
            enrolment: { academicYearId: ids.YEAR, classId: ids.KKP_A, rollNo: roll },
          }),
        )
        .expect(201);
    }

    const preview = await api()
      .get(
        `/api/v1/promotions/preview?campusId=${ids.KKP}&fromYearId=${ids.YEAR}&toYearId=${ids.YEAR2}`,
      )
      .set(as(admin))
      .expect(200);
    const rowA = preview.body.rows.find((r: { from: { id: string } }) => r.from.id === ids.KKP_A);
    expect(rowA.from.label).toBe('1st year › MPC › Section A');
    expect(rowA.suggestion).toEqual({ kind: 'section', sectionId: ids.KKP2_A });
    expect(rowA.students.map((st: { fullName: string }) => st.fullName).sort()).toEqual([
      'Anil',
      'Bhavya',
    ]);
    const rowB = preview.body.rows.find((r: { from: { id: string } }) => r.from.id === ids.KKP_B);
    expect(rowB.suggestion).toEqual({ kind: 'section', sectionId: ids.KKP2_B });
  });

  it('promotion needs the promote permission, at the campus', async () => {
    // A Campus admin may move students between sections, but not promote by default.
    await api()
      .get(
        `/api/v1/promotions/preview?campusId=${ids.KKP}&fromYearId=${ids.YEAR}&toYearId=${ids.YEAR2}`,
      )
      .set(as(ravi))
      .expect(403);
    // Backwards (to an earlier year): refused.
    await api()
      .get(
        `/api/v1/promotions/preview?campusId=${ids.KKP}&fromYearId=${ids.YEAR2}&toYearId=${ids.YEAR}`,
      )
      .set(as(admin))
      .expect(400);
  });

  it('promotion: apply moves students on, keeps roll numbers and moves the batch to its next stage', async () => {
    const body = {
      campusId: ids.KKP,
      fromYearId: ids.YEAR,
      toYearId: ids.YEAR2,
      batchStage: 'Senior',
      keepRollNumbers: true,
      mapping: [
        { fromSectionId: ids.KKP_A, toSectionId: ids.KKP2_A },
        { fromSectionId: ids.KKP_B, toSectionId: ids.KKP2_B },
      ],
    };
    const res = await api().post('/api/v1/promotions').set(as(admin)).send(body).expect(200);
    expect(res.body).toMatchObject({ promoted: 3, graduated: 0, batchesMoved: 1 });

    const list = await api()
      .get(`/api/v1/students?academicYearId=${ids.YEAR2}&search=Anil`)
      .set(as(admin))
      .expect(200);
    const anil = await api()
      .get(`/api/v1/students/${list.body.items[0].id}`)
      .set(as(admin))
      .expect(200);
    ids.ANIL = anil.body.id;
    expect(anil.body.enrolments.map((e: { status: string }) => e.status)).toEqual([
      'ACTIVE',
      'PROMOTED',
    ]);
    expect(anil.body.enrolments[0]).toMatchObject({ rollNo: '1' });
    expect(anil.body.batch.stage).toBe('Senior');

    // Applying again changes nothing: they are already placed in 2027-28.
    const again = await api().post('/api/v1/promotions').set(as(admin)).send(body).expect(200);
    expect(again.body.promoted).toBe(0);
  });

  it('shuffle: moves chosen students to another section of the same campus', async () => {
    const res = await api()
      .post('/api/v1/enrolments/move')
      .set(as(ravi))
      .send({ academicYearId: ids.YEAR2, studentIds: [ids.ANIL], toSectionId: ids.KKP2_B })
      .expect(200);
    expect(res.body.moved).toBe(1);
    const anil = await api().get(`/api/v1/students/${ids.ANIL}`).set(as(admin)).expect(200);
    expect(anil.body.enrolments[0].class.name).toBe('Section B');
    expect(anil.body.enrolments[0].rollNo).toBeNull();

    // A section of another campus: refused.
    await api()
      .post('/api/v1/enrolments/move')
      .set(as(admin))
      .send({ academicYearId: ids.YEAR2, studentIds: [ids.ANIL], toSectionId: ids.AMP_A })
      .expect(400);
  });

  it('promotion: after the last year, students finish and become alumni', async () => {
    const year3 = await api()
      .post('/api/v1/academic-years')
      .set(as(admin))
      .send({
        institutionId: ids.SVJC,
        name: '2028-29',
        startsOn: '2028-06-01',
        endsOn: '2029-03-31',
      })
      .expect(201);
    const preview = await api()
      .get(
        `/api/v1/promotions/preview?campusId=${ids.KKP}&fromYearId=${ids.YEAR2}&toYearId=${year3.body.id}`,
      )
      .set(as(admin))
      .expect(200);
    expect(
      preview.body.rows.every(
        (r: { suggestion: { kind: string } }) => r.suggestion.kind === 'graduate',
      ),
    ).toBe(true);
    const res = await api()
      .post('/api/v1/promotions')
      .set(as(admin))
      .send({
        campusId: ids.KKP,
        fromYearId: ids.YEAR2,
        toYearId: year3.body.id,
        mapping: preview.body.rows.map((r: { from: { id: string } }) => ({
          fromSectionId: r.from.id,
          graduate: true,
        })),
      })
      .expect(200);
    expect(res.body.graduated).toBe(3);
    const anil = await api().get(`/api/v1/students/${ids.ANIL}`).set(as(admin)).expect(200);
    expect(anil.body.status).toBe('ALUMNI');
    expect(anil.body.enrolments[0].status).toBe('COMPLETED');
  });

  it('undo: promotions are undone newest first, once, and only while nothing changed', async () => {
    await api().get(`/api/v1/promotions?campusId=${ids.KKP}`).set(as(ravi)).expect(403);
    const runs = await api()
      .get(`/api/v1/promotions?campusId=${ids.KKP}`)
      .set(as(admin))
      .expect(200);
    expect(
      runs.body.map((r: { fromYear: string; toYear: string }) => `${r.fromYear}>${r.toYear}`),
    ).toEqual(['2027-28>2028-29', '2026-27>2027-28']);
    const [finishRun, firstRun] = runs.body;

    // The first promotion's students have moved on since (they finished): refused.
    const refused = await api()
      .post(`/api/v1/promotions/${firstRun.id}/undo`)
      .set(as(admin))
      .expect(400);
    expect(refused.body.message).toMatch(/changed since/);

    // Undo "finished": they are active again, in their 2027-28 section.
    await api().post(`/api/v1/promotions/${finishRun.id}/undo`).set(as(admin)).expect(200);
    await api().post(`/api/v1/promotions/${finishRun.id}/undo`).set(as(admin)).expect(400);
    let anil = await api().get(`/api/v1/students/${ids.ANIL}`).set(as(admin)).expect(200);
    expect(anil.body.status).toBe('ACTIVE');
    expect(anil.body.statusChanges[0].reason).toBe('Promotion undone');
    expect(anil.body.enrolments[0]).toMatchObject({ status: 'ACTIVE' });

    // Now the first promotion can be undone too: back in 1st year, batch back to Junior.
    await api().post(`/api/v1/promotions/${firstRun.id}/undo`).set(as(admin)).expect(200);
    anil = await api().get(`/api/v1/students/${ids.ANIL}`).set(as(admin)).expect(200);
    expect(anil.body.enrolments).toHaveLength(1);
    expect(anil.body.enrolments[0]).toMatchObject({ status: 'ACTIVE', rollNo: '1' });
    expect(anil.body.enrolments[0].academicYear.name).toBe('2026-27');
    expect(anil.body.batch.stage).toBe('Junior');
  });

  it('automatic admission numbers follow the institution pattern and skip taken numbers', async () => {
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/admission-numbering`)
      .set(as(admin))
      .send({ pattern: '{CODE}{YY}{SEQ:4}{SEQ:2}' })
      .expect(400);
    const set = await api()
      .put(`/api/v1/institutions/${ids.SVJC}/admission-numbering`)
      .set(as(admin))
      .send({ pattern: '{CODE}{YY}{SEQ:4}' })
      .expect(200);
    expect(set.body.example).toMatch(/^SVJC\d{2}0001$/);

    const admit = (overrides: object) =>
      api()
        .post('/api/v1/students')
        .set(as(admin))
        .send({
          ...admission({ admissionDate: '2026-06-02' }),
          admissionNo: undefined,
          ...overrides,
        })
        .expect(201);
    expect((await admit({})).body.admissionNo).toBe('SVJC260001');
    expect((await admit({})).body.admissionNo).toBe('SVJC260002');
    await admit({ admissionNo: 'SVJC260003' }); // typed by hand
    expect((await admit({})).body.admissionNo).toBe('SVJC260004');
  });

  it('a student moves to another campus with their section; both campuses are needed', async () => {
    const res = await api()
      .post('/api/v1/students')
      .set(as(admin))
      .send(
        admission({
          fullName: 'Mover',
          enrolment: { academicYearId: ids.YEAR, classId: ids.KKP_A, rollNo: '30' },
        }),
      )
      .expect(201);
    const id = res.body.id;
    // Ravi looks after KKP only: refused.
    await api()
      .post(`/api/v1/students/${id}/transfer`)
      .set(as(ravi))
      .send({ toCampusId: ids.AMP, toSectionId: ids.AMP_A })
      .expect(403);
    // A current section needs a section on the new campus.
    await api()
      .post(`/api/v1/students/${id}/transfer`)
      .set(as(admin))
      .send({ toCampusId: ids.AMP })
      .expect(400);
    const moved = await api()
      .post(`/api/v1/students/${id}/transfer`)
      .set(as(admin))
      .send({ toCampusId: ids.AMP, toSectionId: ids.AMP_A, reason: 'Closer to home' })
      .expect(200);
    expect(moved.body.campus.id).toBe(ids.AMP);
    expect(moved.body.enrolments[0].class.id).toBe(ids.AMP_A);
    expect(moved.body.enrolments[0].rollNo).toBeNull();
    // Now outside Ravi's campus.
    await api().get(`/api/v1/students/${id}`).set(as(ravi)).expect(404);
  });

  it('import: checks every row and saves all or nothing', async () => {
    const good = {
      admissionNo: 'IMP001',
      admissionDate: '01/06/2026',
      fullName: 'Imported One',
      dateOfBirth: '2010-01-15',
      gender: 'F',
      batch: 'b2026',
      section: 'Y1 / MPC / A',
      rollNo: '40',
      guardianName: 'Parent One',
      guardianRelation: 'mother',
      guardianPhone: '9111111111',
    };
    const bad = [
      good,
      { ...good, admissionNo: 'IMP002', gender: 'x', dateOfBirth: '31/02/2010', rollNo: '41' },
      { ...good, admissionNo: 'IMP001', rollNo: '42' },
      { ...good, admissionNo: 'IMP003', section: 'Y9/XYZ/Q' },
    ];
    const body = { campusId: ids.KKP, academicYearId: ids.YEAR, rows: bad };
    const checked = await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send({ ...body, dryRun: true })
      .expect(200);
    expect(checked.body.ok).toBe(false);
    expect([...new Set(checked.body.errors.map((e: { row: number }) => e.row))]).toEqual([3, 4, 5]);

    // With problems, even without dryRun nothing is saved.
    const refused = await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send(body)
      .expect(200);
    expect(refused.body.imported).toBe(0);
    expect((await api().get('/api/v1/students?search=Imported').set(as(admin))).body.total).toBe(0);

    const imported = await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send({
        ...body,
        rows: [good, { ...good, admissionNo: '', fullName: 'Imported Two', rollNo: '' }],
      })
      .expect(200);
    expect(imported.body).toMatchObject({ ok: true, imported: 2 });
    const list = await api().get('/api/v1/students?search=Imported').set(as(admin)).expect(200);
    expect(list.body.total).toBe(2);
    const one = list.body.items.find((x: { fullName: string }) => x.fullName === 'Imported One');
    const profile = await api().get(`/api/v1/students/${one.id}`).set(as(admin)).expect(200);
    expect(profile.body.enrolments[0]).toMatchObject({ rollNo: '40' });
    expect(profile.body.batch.name).toBe('2026-28 batch');
    expect(profile.body.guardians[0]).toMatchObject({ relation: 'MOTHER', isPrimary: true });
    const two = list.body.items.find((x: { fullName: string }) => x.fullName === 'Imported Two');
    expect(two.admissionNo).toMatch(/^SVJC26\d{4}$/);

    // Importing to another campus: refused for Ravi.
    await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send({ campusId: ids.AMP, rows: [good], dryRun: true })
      .expect(403);
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
