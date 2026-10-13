/**
 * The Students module (ADR-0020, ADR-0030): admission and admission numbers, lateral entry,
 * section and branch changes with history, outgoing students and re-admission, the Director's
 * filters, guardians, import into one section, isolation.
 *
 * Organization "stu" (Intermediate): branches KPHB and AMP, groups MPC and BiPC, streams JEE Mains
 * (MPC) and NEET (BiPC), academic year 2026-27 (active).
 *   KPHB: Junior > MPC > Regular > MPC-A;  Junior > MPC > JEE Mains > JEE-A, JEE-B;
 *         Senior > MPC > JEE Mains > JEE-A
 *   AMP:  Junior > MPC > JEE Mains > JEE-A
 * Ravi = Branch admin of KPHB. Divya = Director.
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

describe('Students', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let divya: string;
  let teacher: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Admission body with sensible defaults (KPHB, typed admission number). */
  const admission = (overrides: object) => ({
    branchId: ids.KPHB,
    admissionNo: `ADM${Math.random().toString(36).slice(2, 8)}`,
    admissionDate: '2026-06-01',
    fullName: 'Student',
    dateOfBirth: '2010-05-14',
    gender: 'MALE',
    ...overrides,
  });
  const admit = (overrides: object, token = admin) =>
    api().post('/api/v1/students').set(as(token)).send(admission(overrides));
  const placedIn = (sectionId: string, rollNo?: string) => ({
    enrolment: { academicYearId: ids.YEAR, classId: sectionId, rollNo },
  });
  const profile = async (id: string, token = admin) =>
    (await api().get(`/api/v1/students/${id}`).set(as(token)).expect(200)).body;

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'stu', 'admin@stu.test', {
      branches: [
        { name: 'KPHB', code: 'KPHB' },
        { name: 'Ameerpet', code: 'AMP' },
      ],
      modules: ['academic'],
    });
    await createOrganization(app, superAdmin, 'stu-other', 'admin@stu-other.test', {
      modules: ['academic', 'students'],
    });
    admin = await loginUser(app, 'admin@stu.test', 'Admin@12345');
    ids.KPHB = await branchId(app, superAdmin, orgId, 'KPHB');
    ids.AMP = await branchId(app, superAdmin, orgId, 'AMP');

    const kphb = await setUpIntermediate(app, admin, ids.KPHB, {
      groups: ['MPC', 'BIPC'],
      streams: [
        { groupCode: 'MPC', name: 'JEE Mains', code: 'JEEM' },
        { groupCode: 'BIPC', name: 'NEET', code: 'NEET' },
      ],
      sections: [
        { under: ['JR', 'MPC', 'REG'], name: 'MPC-A', code: 'MPCA' },
        { under: ['JR', 'MPC', 'JEEM'], name: 'JEE-A', code: 'JEEA' },
        { under: ['JR', 'MPC', 'JEEM'], name: 'JEE-B', code: 'JEEB' },
        { under: ['SR', 'MPC', 'JEEM'], name: 'JEE-A', code: 'SRJEEA' },
      ],
    });
    Object.entries(kphb).forEach(([code, id]) => (ids[`KPHB_${code}`] = id));
    const amp = await setUpIntermediate(app, admin, ids.AMP, {
      groups: ['MPC', 'BIPC'],
      sections: [{ under: ['JR', 'MPC', 'JEEM'], name: 'JEE-A', code: 'JEEA' }],
    });
    ids.AMP_JEEA = amp.JEEA;
    ids.YEAR = await createYear(app, admin, '2026-27', '2026-06-01', '2027-03-31', true);

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    for (const [email, roleName, place] of [
      ['ravi@stu.test', 'Branch admin', { branchId: ids.KPHB }],
      ['divya@stu.test', 'Director', {}],
      ['teacher@stu.test', 'Senior faculty', { branchId: ids.KPHB }],
    ] as const) {
      await api()
        .post('/api/v1/users')
        .set(as(admin))
        .send({
          name: email.split('@')[0],
          email,
          password: 'Password@123',
          roles: [{ roleId: role(roleName), ...place }],
        })
        .expect(201);
    }
    ravi = await loginUser(app, 'ravi@stu.test', 'Password@123');
    divya = await loginUser(app, 'divya@stu.test', 'Password@123');
    teacher = await loginUser(app, 'teacher@stu.test', 'Password@123');
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

  it('admits a student into a section, with a guardian, in one go', async () => {
    const res = await admit({
      admissionNo: 'STU0001',
      fullName: 'Ravi Teja',
      ...placedIn(ids.KPHB_MPCA, '1'),
      guardians: [{ fullName: 'Ramesh', relation: 'FATHER', phone: '9876543210' }],
    }).expect(201);
    ids.TEJA = res.body.id;
    expect(res.body).toMatchObject({ admissionNo: 'STU0001', status: 'ACTIVE' });
    expect(res.body.enrolments[0]).toMatchObject({
      section: 'Junior (1st Year) › MPC › Regular (IPE) › MPC-A',
      status: 'ACTIVE',
      enrolledOn: '2026-06-01T00:00:00.000Z',
    });
    expect(res.body.guardians[0].guardian.fullName).toBe('Ramesh');
  });

  it('typed admission numbers are required and unique in the whole organization', async () => {
    await admit({ admissionNo: undefined }).expect(400);
    const duplicate = await admit({ branchId: ids.AMP, admissionNo: 'STU0001' }).expect(409);
    expect(duplicate.body.message).toBe('Admission number STU0001 is already used');
    // A section of another branch, or a class that isn't a section: refused.
    await admit(placedIn(ids.AMP_JEEA)).expect(400);
    const group = await classId(app, admin, ['JR', 'MPC']);
    await admit(placedIn(group)).expect(400);
  });

  it('lateral entry: a student can join straight in Senior', async () => {
    const res = await admit({
      fullName: 'Kiran',
      previousInstitution: 'Narayana Junior College',
      previousBoard: 'INTERMEDIATE',
      previousPercentage: 84.5,
      previousGrade: 'A',
      ...placedIn(ids.KPHB_SRJEEA),
    }).expect(201);
    expect(res.body).toMatchObject({
      previousInstitution: 'Narayana Junior College',
      previousBoard: 'INTERMEDIATE',
      previousPercentage: '84.5',
    });
    expect(res.body.enrolments[0].section).toBe('Senior (2nd Year) › MPC › JEE Mains › JEE-A');
  });

  it('automatic admission numbers: from the pattern, a counter per branch with {BRANCH}', async () => {
    // Only for the whole organization.
    await api()
      .put('/api/v1/organization/admission-numbering')
      .set(as(ravi))
      .send({ mode: 'AUTOMATIC', pattern: '{CODE}/{BRANCH}/{SEQ:3}' })
      .expect(403);
    await api()
      .put('/api/v1/organization/admission-numbering')
      .set(as(admin))
      .send({ mode: 'AUTOMATIC' })
      .expect(400); // needs a pattern
    const set = await api()
      .put('/api/v1/organization/admission-numbering')
      .set(as(admin))
      .send({ mode: 'AUTOMATIC', pattern: '{CODE}/{BRANCH}/{SEQ:3}' })
      .expect(200);
    expect(set.body.example).toBe('STU/BRANCH/001');

    // A typed number is ignored.
    const a = await admit({ admissionNo: 'TYPED1' }).expect(201);
    const b = await admit({}).expect(201);
    const c = await admit({ branchId: ids.AMP }).expect(201);
    expect([a.body.admissionNo, b.body.admissionNo, c.body.admissionNo]).toEqual([
      'STU/KPHB/001',
      'STU/KPHB/002',
      'STU/AMP/001',
    ]);
    // Back to typed numbers for the rest of the tests.
    await api()
      .put('/api/v1/organization/admission-numbering')
      .set(as(admin))
      .send({ mode: 'MANUAL' })
      .expect(200);
  });

  it('a section change ends the old placement the day before and keeps it in the history', async () => {
    await api()
      .post(`/api/v1/students/${ids.TEJA}/change-section`)
      .set(as(ravi))
      .send({
        classId: ids.KPHB_JEEA,
        effectiveOn: '2026-07-15',
        reason: 'Cleared the entrance test',
        rollNo: '7',
      })
      .expect(200);
    const teja = await profile(ids.TEJA);
    expect(
      teja.enrolments.map(
        (e: { section: string; status: string; enrolledOn: string; endedOn: string | null }) => [
          e.section,
          e.status,
          e.enrolledOn.slice(0, 10),
          e.endedOn?.slice(0, 10) ?? null,
        ],
      ),
    ).toEqual([
      ['Junior (1st Year) › MPC › JEE Mains › JEE-A', 'ACTIVE', '2026-07-15', null],
      ['Junior (1st Year) › MPC › Regular (IPE) › MPC-A', 'MOVED', '2026-06-01', '2026-07-14'],
    ]);
    // Not before the current placement started; not a section of another branch.
    await api()
      .post(`/api/v1/students/${ids.TEJA}/change-section`)
      .set(as(admin))
      .send({ classId: ids.KPHB_JEEB, effectiveOn: '2026-07-01' })
      .expect(400);
    await api()
      .post(`/api/v1/students/${ids.TEJA}/change-section`)
      .set(as(admin))
      .send({ classId: ids.AMP_JEEA, effectiveOn: '2026-08-01' })
      .expect(400);
  });

  it('a change on the placement’s first day simply corrects it', async () => {
    const res = await admit({ fullName: 'Same Day', ...placedIn(ids.KPHB_JEEA) }).expect(201);
    await api()
      .post(`/api/v1/students/${res.body.id}/change-section`)
      .set(as(admin))
      .send({ classId: ids.KPHB_JEEB, effectiveOn: '2026-06-01' })
      .expect(200);
    const fixed = await profile(res.body.id);
    expect(fixed.enrolments).toHaveLength(1);
    expect(fixed.enrolments[0].section).toBe('Junior (1st Year) › MPC › JEE Mains › JEE-B');
  });

  it('a branch change needs both branches; the old branch keeps the history', async () => {
    const body = { branchId: ids.AMP, classId: ids.AMP_JEEA, effectiveOn: '2026-08-01' };
    // Ravi runs KPHB only.
    await api()
      .post(`/api/v1/students/${ids.TEJA}/change-branch`)
      .set(as(ravi))
      .send(body)
      .expect(403);
    await api()
      .post(`/api/v1/students/${ids.TEJA}/change-branch`)
      .set(as(admin))
      .send({ ...body, reason: 'Family moved' })
      .expect(200);
    const teja = await profile(ids.TEJA);
    expect(teja.branch.name).toBe('Ameerpet');
    expect(teja.enrolments.map((e: { branch: { name: string } }) => e.branch.name)).toEqual([
      'Ameerpet',
      'KPHB',
      'KPHB',
    ]);
    // Now Ameerpet's student: Ravi no longer sees them.
    await api().get(`/api/v1/students/${ids.TEJA}`).set(as(ravi)).expect(404);
  });

  it('the Director filters every branch by any part of the structure', async () => {
    const jeeMains = await classId(app, admin, ['JR', 'MPC', 'JEEM']);
    const res = await api()
      .get(`/api/v1/students?classId=${jeeMains}&pageSize=100`)
      .set(as(divya))
      .expect(200);
    const names = res.body.items.map((s: { fullName: string }) => s.fullName);
    expect(names).toEqual(expect.arrayContaining(['Ravi Teja', 'Same Day'])); // AMP and KPHB
    expect(names).not.toContain('Kiran'); // Senior

    const kphbOnly = await api()
      .get(`/api/v1/students?classId=${jeeMains}&branchId=${ids.KPHB}`)
      .set(as(divya))
      .expect(200);
    expect(kphbOnly.body.items.map((s: { fullName: string }) => s.fullName)).toEqual(['Same Day']);
    expect(res.body.items[0].placement.section).toMatch(/JEE Mains/);

    // A branch admin sees only their branch, whatever the filter.
    const mine = await api().get('/api/v1/students?pageSize=100').set(as(ravi)).expect(200);
    expect(mine.body.items.every((s: { branch: { id: string } }) => s.branch.id === ids.KPHB)).toBe(
      true,
    );
  });

  it('a student who leaves becomes outgoing: hidden from current lists, kept in full', async () => {
    const res = await admit({ fullName: 'Leaving Soon', ...placedIn(ids.KPHB_JEEB) }).expect(201);
    ids.LEAVER = res.body.id;
    await api()
      .post(`/api/v1/students/${ids.LEAVER}/leave`)
      .set(as(ravi))
      .send({
        status: 'TRANSFERRED',
        effectiveOn: '2026-12-15',
        reason: 'Took a TC',
        destination: 'Sri Chaitanya, Vizag',
      })
      .expect(200);
    const left = await profile(ids.LEAVER);
    expect(left.status).toBe('TRANSFERRED');
    expect(left.enrolments[0]).toMatchObject({
      status: 'LEFT',
      endedOn: '2026-12-15T00:00:00.000Z',
    });
    expect(left.statusChanges[0]).toMatchObject({
      toStatus: 'TRANSFERRED',
      destination: 'Sri Chaitanya, Vizag',
    });

    const current = await api().get('/api/v1/students?pageSize=100').set(as(admin)).expect(200);
    expect(current.body.items.map((s: { id: string }) => s.id)).not.toContain(ids.LEAVER);
    const outgoing = await api().get('/api/v1/students?show=outgoing').set(as(admin)).expect(200);
    expect(outgoing.body.items.map((s: { id: string }) => s.id)).toEqual([ids.LEAVER]);

    // Leaving twice, or changing section after leaving: refused.
    await api()
      .post(`/api/v1/students/${ids.LEAVER}/leave`)
      .set(as(admin))
      .send({ status: 'DISCONTINUED', effectiveOn: '2026-12-20' })
      .expect(400);
    await api()
      .post(`/api/v1/students/${ids.LEAVER}/change-section`)
      .set(as(admin))
      .send({ classId: ids.KPHB_JEEA, effectiveOn: '2027-01-05' })
      .expect(400);
  });

  it('an outgoing student can be re-admitted and placed again', async () => {
    await api()
      .post(`/api/v1/students/${ids.LEAVER}/readmit`)
      .set(as(admin))
      .send({ effectiveOn: '2027-01-02', reason: 'Came back' })
      .expect(200);
    await api()
      .post(`/api/v1/students/${ids.LEAVER}/enrolments`)
      .set(as(admin))
      .send({ academicYearId: ids.YEAR, classId: ids.KPHB_JEEB })
      .expect(201);
    const back = await profile(ids.LEAVER);
    expect(back.status).toBe('ACTIVE');
    expect(back.enrolments.map((e: { status: string }) => e.status)).toEqual(['ACTIVE', 'LEFT']);
  });

  it('roll numbers are unique in a section', async () => {
    const res = await admit({ ...placedIn(ids.KPHB_JEEA, '7') }).expect(201);
    // Teja had roll 7 in KPHB JEE-A, but has moved on: free again. Now taken:
    const other = await admit({ ...placedIn(ids.KPHB_JEEA) }).expect(201);
    const enrolmentId = other.body.enrolments[0].id;
    await api()
      .patch(`/api/v1/students/${other.body.id}/enrolments/${enrolmentId}`)
      .set(as(admin))
      .send({ rollNo: '7' })
      .expect(409);
    expect(res.body.enrolments[0].rollNo).toBe('7');
  });

  it('links a sibling to the same guardian', async () => {
    const found = await api().get('/api/v1/guardians?phone=98765').set(as(admin)).expect(200);
    const guardianId = found.body[0].id;
    const sibling = await admit({
      fullName: 'Ravi Teja’s sister',
      branchId: ids.AMP,
      guardians: [{ existingGuardianId: guardianId, relation: 'FATHER' }],
    }).expect(201);
    expect(sibling.body.guardians[0].guardian.id).toBe(guardianId);
  });

  it('details follow strict rules (the same ones the import uses)', async () => {
    const problems = async (overrides: object) =>
      (await admit(overrides).expect(400)).body.message as string[];
    expect(await problems({ phone: '12345' })).toContain(
      'phone must be a 10-digit mobile number starting with 6, 7, 8 or 9',
    );
    expect(await problems({ aadhaar: '234567890120' })).toContain(
      'aadhaar must be a valid 12-digit Aadhaar number (check the digits)',
    );
    expect(await problems({ fullName: 'R2D2' })).toContain(
      'fullName may only contain letters, spaces, dots, apostrophes and hyphens',
    );
    expect(await problems({ previousPercentage: 101 })).toContain(
      'previousPercentage must be 0 to 100',
    );
    expect(await problems({ busFacility: true })).toContain(
      'pickupPoint is required when the student uses the bus',
    );
    expect(await problems({ dateOfBirth: '2025-01-01' })).toContain(
      'the student must be 3 to 30 years old at admission (is 1)',
    );
    expect(await problems({ dateOfBirth: '2027-01-01' })).toContain(
      'dateOfBirth must be before the admission date',
    );
    // Phones are cleaned; a valid Aadhaar is unique in the organization.
    const ok = await admit({
      fullName: 'K. Sai Charan',
      phone: '+91 98765-43211',
      aadhaar: '2345 6789 0124',
      category: 'BC_D',
      busFacility: true,
      pickupPoint: 'Gajuwaka',
      medicalCondition: 'Asthma',
    }).expect(201);
    expect(ok.body).toMatchObject({ phone: '9876543211', aadhaar: '234567890124' });
    ids.SAI = ok.body.id;
    const again = await admit({ branchId: ids.AMP, aadhaar: '234567890124' }).expect(409);
    expect(again.body.message).toBe(
      `This Aadhaar number is already used by student ${ok.body.admissionNo}`,
    );
    // Editing: the same rules; required details can't be cleared.
    await api()
      .patch(`/api/v1/students/${ids.SAI}`)
      .set(as(admin))
      .send({ pickupPoint: null })
      .expect(400);
    await api()
      .patch(`/api/v1/students/${ids.SAI}`)
      .set(as(admin))
      .send({ fullName: null })
      .expect(400);
    await api()
      .patch(`/api/v1/students/${ids.SAI}`)
      .set(as(admin))
      .send({ busFacility: false, pickupPoint: null, area: 'Gajuwaka' })
      .expect(200);
  });

  it('sensitive details are hidden without "students.sensitive.view"', async () => {
    const full = await profile(ids.SAI); // the Organization admin
    expect(full).toMatchObject({
      aadhaar: '234567890124',
      category: 'BC_D',
      medicalCondition: 'Asthma',
      sensitiveVisible: true,
    });
    const hidden = await profile(ids.SAI, teacher); // Senior faculty
    expect(hidden).toMatchObject({
      aadhaar: 'XXXX-XXXX-0124',
      category: null,
      medicalCondition: null,
      sensitiveVisible: false,
    });
    // The audit log never holds the values, only that they changed.
    await api()
      .patch(`/api/v1/students/${ids.SAI}`)
      .set(as(admin))
      .send({ aadhaar: '345678901238' })
      .expect(200);
    const log = await api().get('/api/v1/audit-logs?pageSize=100').set(as(admin)).expect(200);
    expect(JSON.stringify(log.body)).not.toContain('345678901238');
  });

  it('top rankers: marked on the student, filtered by learner level', async () => {
    await api()
      .patch(`/api/v1/students/${ids.SAI}`)
      .set(as(admin))
      .send({ topRanker: true, learnerLevel: 'EXPERT' })
      .expect(200);
    const experts = await api()
      .get(`/api/v1/students?topRanker=true&learnerLevel=EXPERT&branchId=${ids.KPHB}`)
      .set(as(divya))
      .expect(200);
    expect(experts.body.items.map((s: { id: string }) => s.id)).toEqual([ids.SAI]);
    expect(experts.body.items[0]).toMatchObject({ topRanker: true, learnerLevel: 'EXPERT' });
    const slow = await api()
      .get('/api/v1/students?topRanker=true&learnerLevel=SLOW')
      .set(as(divya))
      .expect(200);
    expect(slow.body.items).toEqual([]);
  });

  it('import: valid rows are imported, invalid ones excluded with reasons, and recorded', async () => {
    const anjali = {
      fullName: 'Anjali',
      admissionNo: 'IMP001',
      admissionDate: '2026-06-10',
      dateOfBirth: '01/02/2010',
      gender: 'F',
      rollNo: '21',
      category: 'bc-a',
      residence: 'Hostel',
      busFacility: 'no',
      aadhaar: '4567 8901 2341',
      previousBoard: 'CBSE',
      previousPercentage: '91.5%',
      topRanker: 'active',
      learnerLevel: 'Medium Learner',
      fatherName: 'Suresh',
      fatherPhone: '+91 90000 00001',
      motherName: 'Lakshmi',
      motherOccupation: 'Teacher',
    };
    const rows = [
      anjali,
      {
        fullName: 'Bad Row',
        admissionNo: '',
        admissionDate: '31/02/2026',
        dateOfBirth: '2010-01-01',
        gender: 'x',
        rollNo: '21',
        phone: '12345',
        category: 'Rich',
      },
      // The same girl again (name, date of birth, father's phone): a duplicate.
      { ...anjali, admissionNo: 'IMP002', rollNo: '22', aadhaar: '' },
    ];
    const body = {
      academicYearId: ids.YEAR,
      sectionId: ids.KPHB_JEEB,
      fileName: 'jeeb.csv',
      rows,
    };
    const checked = await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send({ ...body, dryRun: true })
      .expect(200);
    expect(checked.body).toMatchObject({
      dryRun: true,
      total: 3,
      importable: 1,
      excludedCount: 2,
      imported: 0,
      run: null,
    });
    const reasonsOf = (row: number) =>
      checked.body.excluded.find((e: { row: number }) => e.row === row).reasons;
    expect(reasonsOf(3)).toEqual(
      expect.arrayContaining([
        'admissionNo is empty (this organization types admission numbers)',
        'admissionDate "31/02/2026" is not a date (2026-06-01 or 01/06/2026)',
        'gender "x" is not one of: male, female, other (or M / F)',
        'category "Rich" is not one of: OC, BC-A … BC-E, SC, ST, EWS, Other',
        'phone must be a 10-digit mobile number starting with 6, 7, 8 or 9',
        'roll number 21 is also in row 2',
      ]),
    );
    expect(reasonsOf(4)).toContain('the same student (name, date of birth, phone) as row 2');
    // Each bad value is reported once (not again by its field rule).
    expect(reasonsOf(3)).not.toContain('admissionDate must be a date');
    expect(reasonsOf(3).filter((r: string) => r.startsWith('gender'))).toHaveLength(1);
    const none = await api().get('/api/v1/students?search=Anjali').set(as(ravi)).expect(200);
    expect(none.body.total).toBe(0);

    const done = await api().post('/api/v1/students/import').set(as(ravi)).send(body).expect(200);
    expect(done.body).toMatchObject({ imported: 1, excludedCount: 2, run: { code: 'IMP-0001' } });
    const list = await api().get('/api/v1/students?search=Anjali').set(as(ravi)).expect(200);
    expect(list.body.items[0].placement.section).toBe(
      'Junior (1st Year) › MPC › JEE Mains › JEE-B',
    );
    const student = await profile(list.body.items[0].id);
    expect(student).toMatchObject({
      category: 'BC_A',
      residence: 'HOSTELLER',
      previousBoard: 'CBSE',
      previousPercentage: '91.5',
      topRanker: true,
      learnerLevel: 'MEDIUM',
      importedFrom: { code: 'IMP-0001', row: 2 },
    });
    type Link = { relation: string; isPrimary: boolean; guardian: { phone: string | null } };
    expect(student.guardians.map((g: Link) => [g.relation, g.isPrimary, g.guardian.phone])).toEqual(
      [
        ['FATHER', true, '9000000001'],
        ['MOTHER', false, null],
      ],
    );

    // The import record: who, where, counts, excluded rows with reasons, missing details.
    const runs = await api().get('/api/v1/students/imports').set(as(ravi)).expect(200);
    expect(runs.body.items[0]).toMatchObject({
      code: 'IMP-0001',
      fileName: 'jeeb.csv',
      totalRows: 3,
      importedCount: 1,
      excludedCount: 2,
      branchName: 'KPHB',
      section: 'Junior (1st Year) › MPC › JEE Mains › JEE-B',
    });
    const run = await api()
      .get(`/api/v1/students/imports/${done.body.run.id}`)
      .set(as(ravi))
      .expect(200);
    expect(run.body.students).toEqual([
      expect.objectContaining({
        fullName: 'Anjali',
        importRow: 2,
        missing: ['phone', 'email', 'address'],
      }),
    ]);
    expect(run.body.excludedRows.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    expect(run.body.excludedRows[0].values).toMatchObject({ fullName: 'Bad Row' });

    // The same sheet again: nothing new is imported.
    const again = await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send({ ...body, rows: [anjali] })
      .expect(200);
    expect(again.body).toMatchObject({ imported: 0, run: null });
    expect(again.body.excluded[0].reasons).toEqual(
      expect.arrayContaining([
        'admission number IMP001 is already used',
        'this Aadhaar number is already used by student IMP001',
        'the same student (name, date of birth, phone) as student IMP001',
      ]),
    );
    // Ravi can't import into another branch's section; a teacher can't see import records.
    await api()
      .post('/api/v1/students/import')
      .set(as(ravi))
      .send({ ...body, sectionId: ids.AMP_JEEA, rows: [{ ...anjali, admissionNo: 'IMP009' }] })
      .expect(403);
    await api().get(`/api/v1/students/imports/${done.body.run.id}`).set(as(teacher)).expect(403);
  });

  it('deleting is only for mistakes', async () => {
    const mistake = await admit({ fullName: 'Typo' }).expect(201);
    await api().delete(`/api/v1/students/${mistake.body.id}`).set(as(ravi)).expect(403);
    await api().delete(`/api/v1/students/${mistake.body.id}`).set(as(admin)).expect(200);
  });

  it('every change is in the audit log', async () => {
    const log = await api().get('/api/v1/audit-logs?pageSize=100').set(as(admin)).expect(200);
    const actions = log.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'admit',
        'change section',
        'change branch',
        'leave',
        'readmit',
        'import',
      ]),
    );
  });

  it('another organization sees none of it', async () => {
    const other = await loginUser(app, 'admin@stu-other.test', 'Admin@12345');
    await api().get(`/api/v1/students/${ids.TEJA}`).set(as(other)).expect(404);
    const list = await api().get('/api/v1/students?show=all').set(as(other)).expect(200);
    expect(list.body.items).toEqual([]);
  });
});
