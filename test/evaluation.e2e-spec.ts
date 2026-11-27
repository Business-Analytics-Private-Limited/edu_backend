/**
 * The Evaluation module, part 1 (ADR-0035): exam types, exams for a part of the structure at one
 * branch or every branch, marks by hand and by CSV upload, results with ranks, locking,
 * permissions at branches, isolation.
 *
 * Organization "eva" (Intermediate): branches KKP and AMP, section Junior > MPC > Regular > A at
 * each. Students: Anil, Bhavya, Chitra in KKP A; Dev in AMP A. Subjects MAT (max 100, pass 35)
 * and PHY (max 50, pass 18).
 * Ravi = Branch admin of KKP; Jaya = Junior faculty at KKP.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  branchId,
  classId,
  createOrganization,
  createTestApp,
  createYear,
  loginSuperAdmin,
  loginUser,
  setUpIntermediate,
} from './helpers';

describe('Evaluation', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let jaya: string;
  let other: string;
  const ids: Record<string, string> = {};
  const student: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Creates the quarterly exam used by most tests (for every branch, Junior > MPC). */
  const quarterly = (extra: Record<string, unknown> = {}) => ({
    examTypeId: ids.Q,
    academicYearId: ids.YEAR,
    name: 'Quarterly 2026',
    classId: ids.JR_MPC,
    startsOn: '2026-12-07',
    endsOn: '2026-12-12',
    subjects: [
      { subjectId: ids.MAT, maxMarks: 100, passMarks: 35 },
      { subjectId: ids.PHY, maxMarks: 50, passMarks: 18 },
    ],
    ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'eva', 'admin@eva.test', {
      branches: [
        { name: 'KKP', code: 'KKP' },
        { name: 'AMP', code: 'AMP' },
      ],
      modules: ['academic', 'students', 'evaluation'],
    });
    await createOrganization(app, superAdmin, 'eva-other', 'admin@eva-other.test', {
      modules: ['academic', 'students', 'evaluation'],
    });
    admin = await loginUser(app, 'admin@eva.test', 'Admin@12345');
    other = await loginUser(app, 'admin@eva-other.test', 'Admin@12345');

    for (const code of ['KKP', 'AMP']) {
      ids[code] = await branchId(app, superAdmin, orgId, code);
      const sections = await setUpIntermediate(app, admin, ids[code], {
        groups: ['MPC'],
        sections: [{ under: ['JR', 'MPC', 'REG'], name: 'Section A', code: 'A' }],
      });
      ids[`${code}_A`] = sections.A;
    }
    ids.JR_MPC = await classId(app, admin, ['JR', 'MPC']);
    ids.YEAR = await createYear(app, admin, '2026-27', '2026-06-01', '2027-03-31', true);
    for (const [code, name] of [
      ['MAT', 'Mathematics'],
      ['PHY', 'Physics'],
    ]) {
      const s = await api()
        .post('/api/v1/subjects')
        .set(as(admin))
        .send({ code, name })
        .expect(201);
      ids[code] = s.body.id;
    }
    const admit = async (name: string, admissionNo: string, branch: string, roll: string) => {
      const s = await api()
        .post('/api/v1/students')
        .set(as(admin))
        .send({
          branchId: ids[branch],
          admissionNo,
          admissionDate: '2026-06-10',
          fullName: name,
          dateOfBirth: '2010-01-01',
          gender: 'MALE',
          enrolment: { academicYearId: ids.YEAR, classId: ids[`${branch}_A`], rollNo: roll },
        })
        .expect(201);
      student[name] = s.body.id;
    };
    await admit('Anil', 'EVA1', 'KKP', '1');
    await admit('Bhavya', 'EVA2', 'KKP', '2');
    await admit('Chitra', 'EVA3', 'KKP', '3');
    await admit('Dev', 'EVA4', 'AMP', '1');

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    for (const [email, roleName] of [
      ['ravi@eva.test', 'Branch admin'],
      ['jaya@eva.test', 'Junior faculty'],
    ]) {
      await api()
        .post('/api/v1/users')
        .set(as(admin))
        .send({
          name: email.split('@')[0],
          email,
          password: 'Password@123',
          roles: [{ roleId: role(roleName), branchId: ids.KKP }],
        })
        .expect(201);
    }
    ravi = await loginUser(app, 'ravi@eva.test', 'Password@123');
    jaya = await loginUser(app, 'jaya@eva.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('exam types: unique name and code, in use can only be switched off', async () => {
    const q = await api()
      .post('/api/v1/exam-types')
      .set(as(admin))
      .send({ name: 'Quarterly', code: 'q' })
      .expect(201);
    expect(q.body.code).toBe('Q');
    ids.Q = q.body.id;
    const again = await api()
      .post('/api/v1/exam-types')
      .set(as(admin))
      .send({ name: 'Quarterly', code: 'Q2' })
      .expect(409);
    expect(again.body.message).toBe('An exam type with this name or code already exists');
    // A branch admin may not change exam types (they belong to the whole organization).
    await api()
      .post('/api/v1/exam-types')
      .set(as(ravi))
      .send({ name: 'Weekly', code: 'WT' })
      .expect(403);
    const list = await api().get('/api/v1/exam-types').set(as(jaya)).expect(200);
    expect(list.body.map((t: { code: string }) => t.code)).toEqual(['Q']);
  });

  it('an exam is checked: dates in the year, pass marks, sections, permission at the place', async () => {
    const outside = await api()
      .post('/api/v1/exams')
      .set(as(admin))
      .send(quarterly({ endsOn: '2027-04-10' }))
      .expect(400);
    expect(outside.body.message).toMatch(/inside 2026-27/);
    const pass = await api()
      .post('/api/v1/exams')
      .set(as(admin))
      .send(quarterly({ subjects: [{ subjectId: ids.MAT, maxMarks: 50, passMarks: 60 }] }))
      .expect(400);
    expect(pass.body.message).toMatch(/pass marks are above the maximum/);
    // Ravi works at KKP only: an exam for every branch needs the whole organization.
    await api().post('/api/v1/exams').set(as(ravi)).send(quarterly()).expect(403);

    const exam = await api().post('/api/v1/exams').set(as(admin)).send(quarterly()).expect(201);
    expect(exam.body.sections).toBe(2);
    ids.EXAM = exam.body.id;
    const dup = await api().post('/api/v1/exams').set(as(admin)).send(quarterly()).expect(409);
    expect(dup.body.message).toBe('An exam with this name already exists in this academic year');

    const detail = await api().get(`/api/v1/exams/${ids.EXAM}`).set(as(jaya)).expect(200);
    expect(detail.body).toMatchObject({
      appliesTo: { label: 'Junior (1st Year) › MPC' },
      branch: null,
      status: 'OPEN',
    });
    expect(detail.body.subjects.map((s: { code: string }) => s.code)).toEqual(['MAT', 'PHY']);
    expect(
      detail.body.sections.map((s: { branchName: string; students: number }) => [
        s.branchName,
        s.students,
      ]),
    ).toEqual([
      ['AMP', 1],
      ['KKP', 3],
    ]);
  });

  it('marks by hand: a section grid, checked against the maximum and the section', async () => {
    const grid = await api()
      .get(`/api/v1/exams/${ids.EXAM}/marks?sectionId=${ids.KKP_A}`)
      .set(as(jaya))
      .expect(200);
    expect(grid.body.students.map((s: { fullName: string }) => s.fullName)).toEqual([
      'Anil',
      'Bhavya',
      'Chitra',
    ]);
    expect(grid.body.canEnter).toBe(true);

    const tooHigh = await api()
      .put(`/api/v1/exams/${ids.EXAM}/marks`)
      .set(as(jaya))
      .send({
        sectionId: ids.KKP_A,
        entries: [{ studentId: student.Anil, subjectId: ids.PHY, status: 'PRESENT', marks: 55 }],
      })
      .expect(400);
    expect(tooHigh.body.message).toMatch(/above the maximum of 50/);
    const wrongSection = await api()
      .put(`/api/v1/exams/${ids.EXAM}/marks`)
      .set(as(jaya))
      .send({
        sectionId: ids.KKP_A,
        entries: [{ studentId: student.Dev, subjectId: ids.MAT, status: 'PRESENT', marks: 50 }],
      })
      .expect(400);
    expect(wrongSection.body.message).toMatch(/not in this section/);
    // Jaya works at KKP: AMP's grid is not hers to fill.
    await api()
      .put(`/api/v1/exams/${ids.EXAM}/marks`)
      .set(as(jaya))
      .send({
        sectionId: ids.AMP_A,
        entries: [{ studentId: student.Dev, subjectId: ids.MAT, status: 'PRESENT', marks: 50 }],
      })
      .expect(403);

    const saved = await api()
      .put(`/api/v1/exams/${ids.EXAM}/marks`)
      .set(as(jaya))
      .send({
        sectionId: ids.KKP_A,
        entries: [
          { studentId: student.Anil, subjectId: ids.MAT, status: 'PRESENT', marks: 90 },
          { studentId: student.Anil, subjectId: ids.PHY, status: 'PRESENT', marks: 40 },
        ],
      })
      .expect(200);
    expect(saved.body).toEqual({ saved: 2, cleared: 0 });
  });

  it('CSV upload: check first, then save the valid rows; the rest are listed with reasons', async () => {
    const rows = [
      { admissionNo: 'EVA2', name: 'Bhavya', MAT: '90', PHY: '40' },
      { admissionNo: 'EVA3', name: 'Chitra', MAT: '30', PHY: 'AB' },
      { admissionNo: 'EVA2', name: 'twice', MAT: '10', PHY: '10' },
      { admissionNo: 'NOPE', name: 'Nobody', MAT: '10', PHY: '10' },
      { admissionNo: 'EVA4', name: 'Dev', MAT: '101', PHY: 'x' },
      { admissionNo: 'EVA1', name: 'Anil', MAT: '', PHY: '', Remarks: 'good' },
    ];
    const check = await api()
      .post(`/api/v1/exams/${ids.EXAM}/marks/upload`)
      .set(as(admin))
      .send({ dryRun: true, fileName: 'quarterly.csv', rows })
      .expect(200);
    expect(check.body).toMatchObject({
      totalRows: 6,
      readyRows: 2,
      marksToSave: 4,
      saved: 0,
      upload: null,
    });
    expect(check.body.unknownColumns).toEqual(['Remarks']);
    const reasons = Object.fromEntries(
      check.body.excluded.map((e: { row: number; reasons: string[] }) => [
        e.row,
        e.reasons.join(' | '),
      ]),
    );
    expect(reasons[4]).toMatch(/already in an earlier row/);
    expect(reasons[5]).toMatch(/no student with admission number NOPE/);
    expect(reasons[6]).toMatch(/MAT 101 is above the maximum of 100/);
    expect(reasons[6]).toMatch(/PHY "x" is not a mark/);
    expect(reasons[7]).toMatch(/no marks in this row/);

    // Ravi (KKP) uploads: Dev is at AMP, so his row is not Ravi's to save.
    const byRavi = await api()
      .post(`/api/v1/exams/${ids.EXAM}/marks/upload`)
      .set(as(ravi))
      .send({ dryRun: true, rows: [{ admissionNo: 'EVA4', MAT: '60', PHY: '30' }] })
      .expect(200);
    expect(byRavi.body.excluded[0].reasons[0]).toMatch(/at this student's branch/);

    const saved = await api()
      .post(`/api/v1/exams/${ids.EXAM}/marks/upload`)
      .set(as(admin))
      .send({ fileName: 'quarterly.csv', rows })
      .expect(200);
    expect(saved.body).toMatchObject({ saved: 4, upload: { code: 'MKS-0001' } });
    const record = await api()
      .get(`/api/v1/marks-uploads/${saved.body.upload.id}`)
      .set(as(admin))
      .expect(200);
    expect(record.body).toMatchObject({
      code: 'MKS-0001',
      totalRows: 6,
      savedCount: 2,
      excludedCount: 4,
    });

    // Dev's marks, from AMP's admin view of the file.
    await api()
      .post(`/api/v1/exams/${ids.EXAM}/marks/upload`)
      .set(as(admin))
      .send({ rows: [{ 'Admission No': 'eva4', Mathematics: '50', PHY: 'EX' }] })
      .expect(200);
  });

  it('results: totals over subjects not exempt, pass / fail, ranks with ties', async () => {
    const res = await api().get(`/api/v1/exams/${ids.EXAM}/results`).set(as(admin)).expect(200);
    const by = Object.fromEntries(
      res.body.students.map((s: { fullName: string }) => [s.fullName, s]),
    );
    expect(by.Anil).toMatchObject({
      total: 130,
      maxTotal: 150,
      percentage: 86.67,
      result: 'PASS',
      examRank: 1,
      sectionRank: 1,
    });
    expect(by.Bhavya).toMatchObject({ total: 130, result: 'PASS', examRank: 1, sectionRank: 1 });
    expect(by.Chitra).toMatchObject({ total: 30, result: 'FAIL', examRank: 4 }); // absent in PHY
    expect(by.Dev).toMatchObject({
      total: 50,
      maxTotal: 100,
      percentage: 50,
      result: 'PASS',
      examRank: 3,
      sectionRank: 1,
    });
    expect(res.body.summary).toMatchObject({ students: 4, passed: 3, failed: 1, incomplete: 0 });

    // Jaya (KKP) sees KKP's students only, with the same exam ranks.
    const kkp = await api().get(`/api/v1/exams/${ids.EXAM}/results`).set(as(jaya)).expect(200);
    expect(kkp.body.students.map((s: { fullName: string }) => s.fullName).sort()).toEqual([
      'Anil',
      'Bhavya',
      'Chitra',
    ]);
  });

  it('a locked exam takes no marks; subjects with marks stay; an exam with marks is not deleted', async () => {
    await api().post(`/api/v1/exams/${ids.EXAM}/lock`).set(as(jaya)).expect(403);
    await api().post(`/api/v1/exams/${ids.EXAM}/lock`).set(as(admin)).expect(200);
    const locked = await api()
      .post(`/api/v1/exams/${ids.EXAM}/marks/upload`)
      .set(as(admin))
      .send({ rows: [{ admissionNo: 'EVA1', MAT: '10' }] })
      .expect(400);
    expect(locked.body.message).toMatch(/locked/);
    await api().post(`/api/v1/exams/${ids.EXAM}/unlock`).set(as(admin)).expect(200);

    const drop = await api()
      .patch(`/api/v1/exams/${ids.EXAM}`)
      .set(as(admin))
      .send({ subjects: [{ subjectId: ids.MAT, maxMarks: 100, passMarks: 35 }] })
      .expect(400);
    expect(drop.body.message).toMatch(/can't be removed/);
    const lower = await api()
      .patch(`/api/v1/exams/${ids.EXAM}`)
      .set(as(admin))
      .send({
        subjects: [
          { subjectId: ids.MAT, maxMarks: 80, passMarks: 30 },
          { subjectId: ids.PHY, maxMarks: 50, passMarks: 18 },
        ],
      })
      .expect(400);
    expect(lower.body.message).toMatch(/already entered/);
    await api().delete(`/api/v1/exams/${ids.EXAM}`).set(as(admin)).expect(400);
    await api().delete(`/api/v1/exam-types/${ids.Q}`).set(as(admin)).expect(400);
  });

  it("a branch's exam: created by its branch staff with the permission, seen only there", async () => {
    // Ravi (Branch admin) has no "create exam" by default; the organization admin creates one for KKP.
    await api()
      .post('/api/v1/exams')
      .set(as(ravi))
      .send(quarterly({ name: 'KKP weekly', branchId: ids.KKP }))
      .expect(403);
    const kkp = await api()
      .post('/api/v1/exams')
      .set(as(admin))
      .send(quarterly({ name: 'KKP weekly', classId: ids.KKP_A }))
      .expect(201);
    expect(kkp.body.sections).toBe(1);
    const exam = await api().get(`/api/v1/exams/${kkp.body.id}`).set(as(admin)).expect(200);
    expect(exam.body.branch.name).toBe('KKP');
    const list = await api().get('/api/v1/exams').set(as(jaya)).expect(200);
    expect(list.body.map((e: { name: string }) => e.name).sort()).toEqual([
      'KKP weekly',
      'Quarterly 2026',
    ]);
    await api().delete(`/api/v1/exams/${kkp.body.id}`).set(as(admin)).expect(200);
  });

  it('each section has its own subjects: offered on the form, expected in marks and results', async () => {
    // Chemistry is attached to KKP's Section A only.
    const chem = await api()
      .post('/api/v1/subjects')
      .set(as(admin))
      .send({ code: 'CHEM', name: 'Chemistry' })
      .expect(201);
    ids.CHEM = chem.body.id;
    await api()
      .put(`/api/v1/classes/${ids.KKP_A}/subjects`)
      .set(as(admin))
      .send({ subjectIds: [ids.CHEM] })
      .expect(200);

    // AMP's section has no subjects yet: it is counted as "not set up" (it would take all).
    const options = () =>
      api().get(`/api/v1/exams/subject-options?classId=${ids.JR_MPC}`).set(as(admin)).expect(200);
    const before = await options();
    expect(before.body.sections).toBe(2);
    expect(before.body.sectionsWithoutSubjects).toBe(1);
    expect(before.body.subjects.map((s: { code: string }) => s.code)).toEqual(['CHEM']);

    // Mathematics on the whole MPC group: every MPC section has it.
    await api()
      .put(`/api/v1/classes/${ids.JR_MPC}/subjects`)
      .set(as(admin))
      .send({ subjectIds: [ids.MAT] })
      .expect(200);
    const after = await options();
    expect(after.body.sectionsWithoutSubjects).toBe(0);
    expect(after.body.subjects).toEqual([
      expect.objectContaining({
        code: 'CHEM',
        sections: 1,
        attachedTo: [expect.stringContaining('Section A')],
      }),
      expect.objectContaining({
        code: 'MAT',
        sections: 2,
        attachedTo: [expect.stringContaining('MPC')],
      }),
    ]);
    expect(after.body.otherSubjects.map((s: { code: string }) => s.code)).toEqual(['PHY']);
    await api()
      .get(`/api/v1/exams/subject-options?classId=${ids.JR_MPC}`)
      .set(as(jaya))
      .expect(403);

    // An exam with Mathematics (every section, with a portion) and Chemistry (KKP only).
    const created = await api()
      .post('/api/v1/exams')
      .set(as(admin))
      .send(
        quarterly({
          name: 'Unit test 1',
          subjects: [
            { subjectId: ids.MAT, maxMarks: 25, passMarks: 9, portion: ' Ch 1-4, Trigonometry ' },
            { subjectId: ids.CHEM, maxMarks: 25, passMarks: 9 },
          ],
        }),
      )
      .expect(201);
    const examId = created.body.id;
    const exam = await api().get(`/api/v1/exams/${examId}`).set(as(admin)).expect(200);
    expect(exam.body.subjects[0].portion).toBe('Ch 1-4, Trigonometry');
    const section = (branch: string) =>
      exam.body.sections.find((s: { id: string }) => s.id === ids[`${branch}_A`]);
    expect(section('KKP').subjectIds.sort()).toEqual([ids.MAT, ids.CHEM].sort());
    expect(section('KKP').marksExpected).toBe(6); // 3 students x 2 subjects
    expect(section('AMP').subjectIds).toEqual([ids.MAT]);
    expect(section('AMP').marksExpected).toBe(1);

    // AMP's grid has no Chemistry column, and Chemistry can't be saved there.
    const grid = await api()
      .get(`/api/v1/exams/${examId}/marks?sectionId=${ids.AMP_A}`)
      .set(as(admin))
      .expect(200);
    expect(grid.body.subjects.map((s: { code: string }) => s.code)).toEqual(['MAT']);
    const refused = await api()
      .put(`/api/v1/exams/${examId}/marks`)
      .set(as(admin))
      .send({
        sectionId: ids.AMP_A,
        entries: [{ studentId: student.Dev, subjectId: ids.CHEM, status: 'PRESENT', marks: 20 }],
      })
      .expect(400);
    expect(refused.body.message).toContain('CHEM is not a subject of');

    // Upload: Chemistry for Dev is left out with the reason; "-" means nothing to save.
    const upload = await api()
      .post(`/api/v1/exams/${examId}/marks/upload`)
      .set(as(admin))
      .send({
        rows: [
          { admissionNo: 'EVA1', MAT: '20', CHEM: '15' },
          { admissionNo: 'EVA4', MAT: '18', CHEM: '12' },
          { admissionNo: 'EVA2', MAT: '22', CHEM: '-' },
        ],
      })
      .expect(200);
    expect(upload.body.readyRows).toBe(2);
    expect(upload.body.excluded).toEqual([
      expect.objectContaining({
        row: 3,
        reasons: ["CHEM is not a subject of this student's section"],
      }),
    ]);
    await api()
      .post(`/api/v1/exams/${examId}/marks/upload`)
      .set(as(admin))
      .send({ rows: [{ admissionNo: 'EVA4', MAT: '18', CHEM: '-' }] })
      .expect(200);

    // Results: Dev is complete with Mathematics alone; Bhavya still misses Chemistry.
    const results = await api().get(`/api/v1/exams/${examId}/results`).set(as(admin)).expect(200);
    const of = (name: string) =>
      results.body.students.find((s: { fullName: string }) => s.fullName === name);
    expect(of('Dev')).toMatchObject({
      subjectIds: [ids.MAT],
      total: 18,
      maxTotal: 25,
      result: 'PASS',
    });
    expect(of('Anil')).toMatchObject({ total: 35, maxTotal: 50, result: 'PASS' });
    expect(of('Bhavya').result).toBe('INCOMPLETE');
  });

  it('works only with the module switched on, and another organization sees none of it', async () => {
    await api().get(`/api/v1/exams/${ids.EXAM}`).set(as(other)).expect(404);
    await api().get(`/api/v1/exams/${ids.EXAM}/results`).set(as(other)).expect(404);
    const otherList = await api().get('/api/v1/exams').set(as(other)).expect(200);
    expect(otherList.body).toEqual([]);

    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/evaluation`)
      .set(as(superAdmin))
      .send({ enabled: false })
      .expect(200);
    const off = await loginUser(app, 'admin@eva.test', 'Admin@12345');
    await api().get('/api/v1/exams').set(as(off)).expect(403);
  });
});
