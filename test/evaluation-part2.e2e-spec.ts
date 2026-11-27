/**
 * The Evaluation module, part 2 (ADR-0036): syllabus chapters ticked on exams, grading schemes
 * and grades on results, report card settings and PDFs (one and in bulk), overviews, and
 * results in the parent / student portal. Also: permissions at branches and isolation.
 *
 * Organization "evb" (Intermediate): branches KKP and AMP, section Junior > MPC > Regular > A at
 * each. Students: Anil, Bhavya in KKP A; Dev in AMP A. Subjects MAT (max 100, pass 35) and
 * PHY (max 50, pass 18). Jaya = Junior faculty at KKP.
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

/** Collects a binary response (PDF, image) into a Buffer. */
function binary(res: request.Response, done: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

/** The smallest valid PNG (1 x 1 pixel). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Evaluation, part 2', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let jaya: string;
  let other: string;
  const ids: Record<string, string> = {};
  const student: Record<string, string> = {};
  const chapter: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'evb', 'admin@evb.test', {
      branches: [
        { name: 'KKP', code: 'KKP' },
        { name: 'AMP', code: 'AMP' },
      ],
      modules: ['academic', 'students', 'evaluation', 'portal'],
    });
    await createOrganization(app, superAdmin, 'evb-other', 'admin@evb-other.test', {
      modules: ['academic', 'students', 'evaluation'],
    });
    admin = await loginUser(app, 'admin@evb.test', 'Admin@12345');
    other = await loginUser(app, 'admin@evb-other.test', 'Admin@12345');
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
          guardians: [{ fullName: `${name} parent`, relation: 'FATHER', phone: '9876543210' }],
        })
        .expect(201);
      student[name] = s.body.id;
    };
    await admit('Anil', 'EVB1', 'KKP', '1');
    await admit('Bhavya', 'EVB2', 'KKP', '2');
    await admit('Dev', 'EVB3', 'AMP', '1');

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const role = roles.body.find((r: { name: string }) => r.name === 'Junior faculty').id;
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'jaya',
        email: 'jaya@evb.test',
        password: 'Password@123',
        roles: [{ roleId: role, branchId: ids.KKP }],
      })
      .expect(201);
    jaya = await loginUser(app, 'jaya@evb.test', 'Password@123');
    const q = await api()
      .post('/api/v1/exam-types')
      .set(as(admin))
      .send({ name: 'Quarterly', code: 'Q' })
      .expect(201);
    ids.Q = q.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('syllabus: chapters per subject, in order, unique names, managed for the whole organization', async () => {
    await api()
      .post(`/api/v1/subjects/${ids.MAT}/chapters`)
      .set(as(admin))
      .send({ names: ['Sets', 'Relations and functions', 'Trigonometric ratios'] })
      .expect(201);
    const dup = await api()
      .post(`/api/v1/subjects/${ids.MAT}/chapters`)
      .set(as(admin))
      .send({ names: ['sets'] })
      .expect(409);
    expect(dup.body.message).toMatch(/already has the chapter "Sets"/);
    await api()
      .post(`/api/v1/subjects/${ids.PHY}/chapters`)
      .set(as(admin))
      .send({ names: ['Units and measurement'] })
      .expect(201);
    // Jaya may see the syllabus but not change it.
    await api()
      .post(`/api/v1/subjects/${ids.MAT}/chapters`)
      .set(as(jaya))
      .send({ names: ['Limits'] })
      .expect(403);

    const list = await api().get(`/api/v1/subjects/${ids.MAT}/chapters`).set(as(jaya)).expect(200);
    expect(list.body.chapters.map((c: { name: string }) => c.name)).toEqual([
      'Sets',
      'Relations and functions',
      'Trigonometric ratios',
    ]);
    for (const c of list.body.chapters) chapter[c.name] = c.id;
    const phy = await api().get(`/api/v1/subjects/${ids.PHY}/chapters`).set(as(admin)).expect(200);
    chapter.Units = phy.body.chapters[0].id;

    await api()
      .put(`/api/v1/subjects/${ids.MAT}/chapters/order`)
      .set(as(admin))
      .send({
        chapterIds: [
          chapter['Trigonometric ratios'],
          chapter.Sets,
          chapter['Relations and functions'],
        ],
      })
      .expect(200);
    const after = await api().get(`/api/v1/subjects/${ids.MAT}/chapters`).set(as(admin));
    expect(after.body.chapters[0].name).toBe('Trigonometric ratios');
    await api()
      .put(`/api/v1/subjects/${ids.MAT}/chapters/order`)
      .set(as(admin))
      .send({ chapterIds: [chapter.Sets] })
      .expect(400);
  });

  it('grading schemes: bands checked, the first is the default, a used scheme is kept', async () => {
    const noZero = await api()
      .post('/api/v1/grading-schemes')
      .set(as(admin))
      .send({
        name: 'Bad',
        bands: [
          { grade: 'A', minPercentage: 80 },
          { grade: 'B', minPercentage: 40 },
        ],
      })
      .expect(400);
    expect(noZero.body.message).toMatch(/start at 0 %/);
    const board = await api()
      .post('/api/v1/grading-schemes')
      .set(as(admin))
      .send({
        name: 'Board grades',
        bands: [
          { grade: 'A+', minPercentage: 90, gradePoint: 10, remark: 'Outstanding' },
          { grade: 'A', minPercentage: 75, gradePoint: 9 },
          { grade: 'B', minPercentage: 60, gradePoint: 8 },
          { grade: 'C', minPercentage: 35, gradePoint: 6 },
          { grade: 'D', minPercentage: 0, gradePoint: 0 },
        ],
      })
      .expect(201);
    expect(board.body).toMatchObject({ isDefault: true, name: 'Board grades' });
    expect(board.body.bands.map((b: { grade: string }) => b.grade)).toEqual([
      'A+',
      'A',
      'B',
      'C',
      'D',
    ]);
    ids.BOARD = board.body.id;
    const simple = await api()
      .post('/api/v1/grading-schemes')
      .set(as(admin))
      .send({
        name: 'Simple',
        bands: [
          { grade: 'Good', minPercentage: 50 },
          { grade: 'Try again', minPercentage: 0 },
        ],
      })
      .expect(201);
    expect(simple.body.isDefault).toBe(false);
    ids.SIMPLE = simple.body.id;
    await api()
      .post('/api/v1/grading-schemes')
      .set(as(jaya))
      .send({
        name: 'X',
        bands: [
          { grade: 'A', minPercentage: 0 },
          { grade: 'B', minPercentage: 1 },
        ],
      })
      .expect(403);
    const list = await api().get('/api/v1/grading-schemes').set(as(jaya)).expect(200);
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(['Board grades', 'Simple']);
  });

  it("an exam ticks chapters of its subjects' syllabus only", async () => {
    const exam = (subjects: object[], extra: object = {}) =>
      api()
        .post('/api/v1/exams')
        .set(as(admin))
        .send({
          examTypeId: ids.Q,
          academicYearId: ids.YEAR,
          name: 'Quarterly 2026',
          classId: ids.JR_MPC,
          startsOn: '2026-12-07',
          endsOn: '2026-12-12',
          subjects,
          ...extra,
        });
    const wrong = await exam([
      { subjectId: ids.MAT, maxMarks: 100, passMarks: 35, chapterIds: [chapter.Units] },
      { subjectId: ids.PHY, maxMarks: 50, passMarks: 18 },
    ]).expect(400);
    expect(wrong.body.message).toMatch(/not in this subject's syllabus/);
    const created = await exam([
      {
        subjectId: ids.MAT,
        maxMarks: 100,
        passMarks: 35,
        chapterIds: [chapter.Sets, chapter['Trigonometric ratios']],
      },
      { subjectId: ids.PHY, maxMarks: 50, passMarks: 18, chapterIds: [chapter.Units] },
    ]).expect(201);
    ids.EXAM = created.body.id;
    const detail = await api().get(`/api/v1/exams/${ids.EXAM}`).set(as(jaya)).expect(200);
    // Syllabus order, not the order ticked.
    expect(detail.body.subjects[0].chapters.map((c: { name: string }) => c.name)).toEqual([
      'Trigonometric ratios',
      'Sets',
    ]);
    expect(detail.body.gradingScheme).toEqual({ id: ids.BOARD, name: 'Board grades', own: false });

    // The New exam form offers each subject's chapters.
    const options = await api()
      .get(`/api/v1/exams/subject-options?classId=${ids.JR_MPC}`)
      .set(as(admin))
      .expect(200);
    const mat = [...options.body.subjects, ...options.body.otherSubjects].find(
      (s: { code: string }) => s.code === 'MAT',
    );
    expect(mat.chapters).toHaveLength(3);

    // A ticked chapter can't be deleted; switched off, it stays on the exam.
    const del = await api().delete(`/api/v1/chapters/${chapter.Sets}`).set(as(admin)).expect(400);
    expect(del.body.message).toMatch(/switch it off/);
    await api()
      .patch(`/api/v1/chapters/${chapter.Sets}`)
      .set(as(admin))
      .send({ isActive: false })
      .expect(200);
    await api()
      .patch(`/api/v1/exams/${ids.EXAM}`)
      .set(as(admin))
      .send({
        subjects: [
          { subjectId: ids.MAT, maxMarks: 100, passMarks: 35, chapterIds: [chapter.Sets] },
          { subjectId: ids.PHY, maxMarks: 50, passMarks: 18, chapterIds: [chapter.Units] },
        ],
      })
      .expect(200);
    // ... but can't be ticked on a new exam.
    const off = await exam(
      [{ subjectId: ids.MAT, maxMarks: 100, passMarks: 35, chapterIds: [chapter.Sets] }],
      { name: 'Weekly 1' },
    ).expect(400);
    expect(off.body.message).toMatch(/switched off/);
    // An unused chapter can be deleted.
    await api()
      .delete(`/api/v1/chapters/${chapter['Relations and functions']}`)
      .set(as(admin))
      .expect(200);
  });

  it('results carry grades per subject, an overall grade and a GPA', async () => {
    await api()
      .post(`/api/v1/exams/${ids.EXAM}/marks/upload`)
      .set(as(admin))
      .send({
        rows: [
          { admissionNo: 'EVB1', MAT: '95', PHY: '40' }, // 135 / 150 = 90 %
          { admissionNo: 'EVB2', MAT: '30', PHY: 'AB' }, // fails
          { admissionNo: 'EVB3', MAT: '70', PHY: '30' }, // 100 / 150 = 66.67 %
        ],
      })
      .expect(200);
    const res = await api().get(`/api/v1/exams/${ids.EXAM}/results`).set(as(admin)).expect(200);
    const by = Object.fromEntries(
      res.body.students.map((s: { fullName: string }) => [s.fullName, s]),
    );
    expect(by.Anil).toMatchObject({ percentage: 90, grade: 'A+', gpa: 9.5 }); // A+ (10), A (9)
    expect(by.Anil.subjectGrades).toEqual({ [ids.MAT]: 'A+', [ids.PHY]: 'A' });
    expect(by.Bhavya).toMatchObject({ result: 'FAIL', grade: 'D' }); // 30 / 150 = 20 %
    expect(by.Bhavya.subjectGrades[ids.PHY]).toBe('D'); // absent = 0 %
    expect(by.Dev).toMatchObject({ grade: 'B', gpa: 8 });
    expect(res.body.gradingScheme.name).toBe('Board grades');

    // The exam may use another scheme; the default can't be deleted while... it is unused here.
    await api()
      .patch(`/api/v1/exams/${ids.EXAM}`)
      .set(as(admin))
      .send({ gradingSchemeId: ids.SIMPLE })
      .expect(200);
    const simple = await api().get(`/api/v1/exams/${ids.EXAM}/results`).set(as(admin));
    const anil = simple.body.students.find((s: { fullName: string }) => s.fullName === 'Anil');
    expect(anil).toMatchObject({ grade: 'Good', gpa: null }); // no grade points in "Simple"
    const used = await api()
      .delete(`/api/v1/grading-schemes/${ids.SIMPLE}`)
      .set(as(admin))
      .expect(400);
    expect(used.body.message).toMatch(/1 exam\(s\) use this scheme/);
    await api()
      .patch(`/api/v1/exams/${ids.EXAM}`)
      .set(as(admin))
      .send({ gradingSchemeId: null })
      .expect(200);
  });

  it('report card settings and logo: only a PNG or JPG, changed for the whole organization', async () => {
    const defaults = await api().get('/api/v1/report-card-settings').set(as(jaya)).expect(200);
    expect(defaults.body).toMatchObject({ title: 'Progress report', hasLogo: false });
    await api()
      .put('/api/v1/report-card-settings')
      .set(as(jaya))
      .send({ title: 'Mine' })
      .expect(403);
    const saved = await api()
      .put('/api/v1/report-card-settings')
      .set(as(admin))
      .send({
        title: 'Term report',
        headerLine: 'Kukatpally, Hyderabad',
        signatureLabels: ['Principal'],
      })
      .expect(200);
    expect(saved.body).toMatchObject({ title: 'Term report', signatureLabels: ['Principal'] });

    await api()
      .put('/api/v1/report-card-settings/logo')
      .set(as(admin))
      .attach('file', Buffer.from('%PDF-1.4 not a logo'), 'logo.pdf')
      .expect(400);
    await api()
      .put('/api/v1/report-card-settings/logo')
      .set(as(admin))
      .attach('file', PNG, 'logo.png')
      .expect(200);
    const logo = await api()
      .get('/api/v1/report-card-settings/logo')
      .set(as(jaya))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((logo.body as Buffer).equals(PNG)).toBe(true);
    // Another organization has its own (default) settings and no logo.
    const theirs = await api().get('/api/v1/report-card-settings').set(as(other)).expect(200);
    expect(theirs.body).toMatchObject({ title: 'Progress report', hasLogo: false });
    await api().get('/api/v1/report-card-settings/logo').set(as(other)).expect(404);
  });

  it('report cards: one student or a whole section as PDF, only at branches the user may see', async () => {
    const one = await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards/${student.Anil}`)
      .set(as(jaya))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(one.headers['content-type']).toBe('application/pdf');
    expect((one.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    // Dev is at AMP: not Jaya's to print.
    await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards/${student.Dev}`)
      .set(as(jaya))
      .expect(403);
    await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards?sectionId=${ids.AMP_A}`)
      .set(as(jaya))
      .expect(403);

    const bulk = await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards?sectionId=${ids.KKP_A}`)
      .set(as(jaya))
      .buffer(true)
      .parse(binary)
      .expect(200);
    // One page per student: Anil and Bhavya.
    expect((bulk.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    // Without a section, Jaya gets her branch's students only; the admin gets all three.
    const mine = await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards`)
      .set(as(jaya))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((mine.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    const all = await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards`)
      .set(as(admin))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((all.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(3);
    await api()
      .get(`/api/v1/exams/${ids.EXAM}/report-cards/${student.Anil}`)
      .set(as(other))
      .expect(404);
  });

  it('overview: by branch, section and group, per subject, toppers, weak subjects, grades', async () => {
    const all = await api().get(`/api/v1/exams/${ids.EXAM}/overview`).set(as(admin)).expect(200);
    expect(all.body.everything).toMatchObject({
      students: 3,
      passed: 2,
      failed: 1,
      passPercentage: 66.67,
      averagePercentage: 58.89, // (90 + 20 + 66.67) / 3
      highestPercentage: 90,
    });
    expect(all.body.everything.toppers.map((t: { fullName: string }) => t.fullName)).toEqual([
      'Anil',
      'Dev',
      'Bhavya',
    ]);
    expect(
      all.body.byBranch.map((b: { label: string; students: number }) => [b.label, b.students]),
    ).toEqual([
      ['AMP', 1],
      ['KKP', 2],
    ]);
    expect(all.body.byGroup).toEqual([expect.objectContaining({ students: 3 })]);
    expect(all.body.bySection).toHaveLength(2);
    const phy = all.body.subjects.find((s: { code: string }) => s.code === 'PHY');
    // 40/50, AB, 30/50: average (80 + 0 + 60) / 3, two of three passed.
    expect(phy).toMatchObject({
      students: 3,
      averagePercentage: 46.67,
      passPercentage: 66.67,
      highest: 40,
    });
    expect(all.body.weakSubjects[0].code).toBe('PHY');
    expect(all.body.gradeSpread).toEqual(
      expect.arrayContaining([
        { grade: 'A+', students: 1 },
        { grade: 'B', students: 1 },
        { grade: 'D', students: 1 },
      ]),
    );

    // Jaya (KKP) sees her branch only.
    const kkp = await api().get(`/api/v1/exams/${ids.EXAM}/overview`).set(as(jaya)).expect(200);
    expect(kkp.body.everything.students).toBe(2);
    expect(kkp.body.byBranch.map((b: { label: string }) => b.label)).toEqual(['KKP']);

    const year = await api()
      .get(`/api/v1/exam-overview?academicYearId=${ids.YEAR}`)
      .set(as(admin))
      .expect(200);
    expect(year.body).toEqual([
      expect.objectContaining({ name: 'Quarterly 2026', students: 3, passPercentage: 66.67 }),
    ]);
    await api().get(`/api/v1/exams/${ids.EXAM}/overview`).set(as(other)).expect(404);
  });

  it('the portal shows results and the report card once the exam is locked', async () => {
    const profile = await api().get(`/api/v1/students/${student.Anil}`).set(as(admin)).expect(200);
    await api()
      .post(`/api/v1/students/${student.Anil}/portal-access`)
      .set(as(admin))
      .send({
        for: 'GUARDIAN',
        guardianId: profile.body.guardians[0].guardian.id,
        email: 'anil.parent@evb.test',
        password: 'Portal@12345',
      })
      .expect(201);
    const parent = await loginUser(app, 'anil.parent@evb.test', 'Portal@12345');
    const me = await api().get('/api/v1/portal/me').set(as(parent)).expect(200);
    expect(me.body.results).toBe(true);

    // Still open: nothing yet (marks may still change).
    const open = await api()
      .get(`/api/v1/portal/students/${student.Anil}/exams`)
      .set(as(parent))
      .expect(200);
    expect(open.body).toEqual([]);
    await api()
      .get(`/api/v1/portal/students/${student.Anil}/exams/${ids.EXAM}`)
      .set(as(parent))
      .expect(404);

    await api().post(`/api/v1/exams/${ids.EXAM}/lock`).set(as(admin)).expect(200);
    const list = await api()
      .get(`/api/v1/portal/students/${student.Anil}/exams`)
      .set(as(parent))
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        exam: expect.objectContaining({ name: 'Quarterly 2026' }),
        percentage: 90,
        grade: 'A+',
        result: 'PASS',
      }),
    ]);
    const one = await api()
      .get(`/api/v1/portal/students/${student.Anil}/exams/${ids.EXAM}`)
      .set(as(parent))
      .expect(200);
    expect(
      one.body.subjects.map((s: { code: string; marks: number }) => [s.code, s.marks]),
    ).toEqual([
      ['MAT', 95],
      ['PHY', 40],
    ]);
    expect(one.body.sectionRank).toBe(1);
    const card = await api()
      .get(`/api/v1/portal/students/${student.Anil}/exams/${ids.EXAM}/report-card`)
      .set(as(parent))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((card.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Another child is not theirs; staff routes stay closed to a parent.
    await api().get(`/api/v1/portal/students/${student.Dev}/exams`).set(as(parent)).expect(404);
    await api()
      .get(`/api/v1/portal/students/${student.Dev}/exams/${ids.EXAM}/report-card`)
      .set(as(parent))
      .expect(404);
    await api().get(`/api/v1/exams/${ids.EXAM}/results`).set(as(parent)).expect(403);

    // With the module switched off, the portal says so.
    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/evaluation`)
      .set(as(superAdmin))
      .send({ enabled: false })
      .expect(200);
    await api().get(`/api/v1/portal/students/${student.Anil}/exams`).set(as(parent)).expect(403);
  });

  it('another organization sees none of the syllabus, schemes or overviews', async () => {
    await api().get(`/api/v1/subjects/${ids.MAT}/chapters`).set(as(other)).expect(404);
    await api()
      .patch(`/api/v1/chapters/${chapter.Sets}`)
      .set(as(other))
      .send({ name: 'x' })
      .expect(404);
    const schemes = await api().get('/api/v1/grading-schemes').set(as(other)).expect(200);
    expect(schemes.body).toEqual([]);
    await api()
      .patch(`/api/v1/grading-schemes/${ids.BOARD}`)
      .set(as(other))
      .send({ name: 'x' })
      .expect(404);
    const year = await api()
      .get(`/api/v1/exam-overview?academicYearId=${ids.YEAR}`)
      .set(as(other))
      .expect(200);
    expect(year.body).toEqual([]);
  });
});
