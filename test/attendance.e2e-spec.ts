/**
 * The Attendance module (ADR-0021, ADR-0030): marking a section's day, same-day changes,
 * corrections with reasons, the correction window, working days, reports, branches, registers
 * that follow section changes, isolation.
 *
 * Organization "att" (Intermediate, no weekly off days, so every day is a working day for these
 * tests): branches KKP and AMP; section Junior > MPC > Regular > A at each, and B at KKP; three
 * students in KKP A.
 * Ravi = Branch admin of KKP (may correct); Jaya = Junior faculty at KKP (may mark, not correct).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  branchId,
  createOrganization,
  createTestApp,
  createYear,
  loginSuperAdmin,
  loginUser,
  setUpIntermediate,
} from './helpers';

/** "YYYY-MM-DD", `days` days before today in India (the organization's default time zone). */
function day(daysAgo: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe('Attendance', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let jaya: string;
  let other: string;
  const ids: Record<string, string> = {};
  const students: string[] = [];
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const all = (status: string) => students.map((studentId) => ({ studentId, status }));

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'att', 'admin@att.test', {
      branches: [
        { name: 'KKP', code: 'KKP' },
        { name: 'AMP', code: 'AMP' },
      ],
      modules: ['academic', 'students'],
    });
    await createOrganization(app, superAdmin, 'att-other', 'admin@att-other.test', {
      modules: ['academic', 'students', 'attendance'],
    });
    admin = await loginUser(app, 'admin@att.test', 'Admin@12345');
    other = await loginUser(app, 'admin@att-other.test', 'Admin@12345');

    await api().put('/api/v1/calendar/weekly-off').set(as(admin)).send({ days: [] }).expect(200);
    for (const code of ['KKP', 'AMP']) {
      ids[code] = await branchId(app, superAdmin, orgId, code);
      const sections = await setUpIntermediate(app, admin, ids[code], {
        groups: ['MPC'],
        sections: [
          { under: ['JR', 'MPC', 'REG'], name: 'Section A', code: 'A' },
          ...(code === 'KKP'
            ? [{ under: ['JR', 'MPC', 'REG'], name: 'Section B', code: 'B' }]
            : []),
        ],
      });
      ids[`${code}_A`] = sections.A;
      if (sections.B) ids.KKP_B = sections.B;
    }
    ids.YEAR = await createYear(app, admin, 'This year', day(200), day(-100), true);

    for (const [name, roll] of [
      ['Anil', '1'],
      ['Bhavya', '2'],
      ['Chitra', '3'],
    ]) {
      const s = await api()
        .post('/api/v1/students')
        .set(as(admin))
        .send({
          branchId: ids.KKP,
          admissionNo: `ATT${roll}`,
          admissionDate: day(150),
          fullName: name,
          dateOfBirth: '2010-01-01',
          gender: 'FEMALE',
          enrolment: { academicYearId: ids.YEAR, classId: ids.KKP_A, rollNo: roll },
        })
        .expect(201);
      students.push(s.body.id);
    }

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    for (const [email, roleName] of [
      ['ravi@att.test', 'Branch admin'],
      ['jaya@att.test', 'Junior faculty'],
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
    ravi = await loginUser(app, 'ravi@att.test', 'Password@123');
    jaya = await loginUser(app, 'jaya@att.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('works only when the Attendance module is switched on', async () => {
    await api()
      .get(`/api/v1/attendance/roster?classId=${ids.KKP_A}&date=${day(0)}`)
      .set(as(jaya))
      .expect(403);
    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/attendance`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
  });

  it("today's register lists the section's students in roll number order", async () => {
    const roster = await api()
      .get(`/api/v1/attendance/roster?classId=${ids.KKP_A}&date=${day(0)}`)
      .set(as(jaya))
      .expect(200);
    expect(roster.body).toMatchObject({ workingDay: true, marked: false, blocked: null });
    expect(roster.body.students.map((s: { fullName: string }) => s.fullName)).toEqual([
      'Anil',
      'Bhavya',
      'Chitra',
    ]);
  });

  it('the first marking covers every student; same-day changes need no reason', async () => {
    await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({ classId: ids.KKP_A, date: day(0), entries: all('PRESENT').slice(0, 2) })
      .expect(400);
    const marked = await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({ classId: ids.KKP_A, date: day(0), entries: all('PRESENT') })
      .expect(200);
    expect(marked.body).toEqual({ marked: 3, changed: 0 });

    const changed = await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({
        classId: ids.KKP_A,
        date: day(0),
        entries: [{ studentId: students[1], status: 'LATE', remark: 'Bus late' }],
      })
      .expect(200);
    expect(changed.body).toEqual({ marked: 0, changed: 1 });
    const roster = await api()
      .get(`/api/v1/attendance/roster?classId=${ids.KKP_A}&date=${day(0)}`)
      .set(as(jaya))
      .expect(200);
    expect(roster.body.students[1]).toMatchObject({
      status: 'LATE',
      remark: 'Bus late',
      corrected: true,
    });
    expect(roster.body.lastMarkedBy.name).toBe('jaya');
  });

  it('no future days; past days inside the window can be marked', async () => {
    const future = await api()
      .post('/api/v1/attendance/markings')
      .set(as(ravi))
      .send({ classId: ids.KKP_A, date: day(-1), entries: all('PRESENT') })
      .expect(400);
    expect(future.body.message).toMatch(/future/);
    await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({
        classId: ids.KKP_A,
        date: day(1),
        entries: [...all('PRESENT').slice(0, 2), { studentId: students[2], status: 'ABSENT' }],
      })
      .expect(200);
  });

  it('changing a past day is a correction: the correct permission and a reason', async () => {
    const change = {
      classId: ids.KKP_A,
      date: day(1),
      entries: [{ studentId: students[2], status: 'ON_LEAVE' }],
    };
    await api().post('/api/v1/attendance/markings').set(as(jaya)).send(change).expect(403);
    await api().post('/api/v1/attendance/markings').set(as(ravi)).send(change).expect(400);
    await api()
      .post('/api/v1/attendance/markings')
      .set(as(ravi))
      .send({ ...change, reason: 'Leave letter received' })
      .expect(200);

    const report = await api()
      .get(`/api/v1/students/${students[2]}/attendance?from=${day(30)}&to=${day(0)}`)
      .set(as(ravi))
      .expect(200);
    const yesterday = report.body.days.find((d: { date: string }) => d.date === day(1));
    expect(yesterday).toMatchObject({
      status: 'ON_LEAVE',
      corrected: true,
      correctionReason: 'Leave letter received',
    });
  });

  it('days outside the correction window are closed until the window is widened', async () => {
    const old = { classId: ids.KKP_A, date: day(10), entries: all('PRESENT') };
    const refused = await api()
      .post('/api/v1/attendance/markings')
      .set(as(ravi))
      .send(old)
      .expect(400);
    expect(refused.body.message).toMatch(/7 day/);
    await api()
      .put('/api/v1/organization/attendance-settings')
      .set(as(admin))
      .send({ timeZone: 'Mars/Olympus' })
      .expect(400);
    await api()
      .put('/api/v1/organization/attendance-settings')
      .set(as(admin))
      .send({ correctionDays: 30 })
      .expect(200);
    await api().post('/api/v1/attendance/markings').set(as(ravi)).send(old).expect(200);
  });

  it('holidays and weekly off days are not working days', async () => {
    await api()
      .post('/api/v1/holidays')
      .set(as(admin))
      .send({ name: 'Festival', startsOn: day(2) })
      .expect(201);
    const roster = await api()
      .get(`/api/v1/attendance/roster?classId=${ids.KKP_A}&date=${day(2)}`)
      .set(as(jaya))
      .expect(200);
    expect(roster.body).toMatchObject({
      workingDay: false,
      blocked: 'Not a working day: Holiday: Festival',
    });
    await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({ classId: ids.KKP_A, date: day(2), entries: all('PRESENT') })
      .expect(400);
  });

  it('a branch admin and a teacher work only at their own branch', async () => {
    await api()
      .get(`/api/v1/attendance/roster?classId=${ids.AMP_A}&date=${day(0)}`)
      .set(as(jaya))
      .expect(404);
    await api()
      .post('/api/v1/attendance/markings')
      .set(as(ravi))
      .send({ classId: ids.AMP_A, date: day(0), entries: all('PRESENT') })
      .expect(403);
  });

  it('daily overview and section report', async () => {
    const summary = await api()
      .get(`/api/v1/attendance/daily-summary?branchId=${ids.KKP}&date=${day(0)}`)
      .set(as(ravi))
      .expect(200);
    expect(summary.body.sections).toHaveLength(1);
    expect(summary.body.sections[0]).toMatchObject({
      students: 3,
      marked: true,
      counts: { PRESENT: 2, LATE: 1, ABSENT: 0 },
    });

    const report = await api()
      .get(`/api/v1/attendance/section-report?classId=${ids.KKP_A}&from=${day(10)}&to=${day(0)}`)
      .set(as(ravi))
      .expect(200);
    // Marked: today, yesterday and 10 days ago; the festival is not a working day.
    expect(report.body).toMatchObject({ markedDays: 3, workingDays: 10, unmarkedDays: 7 });
    const chitra = report.body.students.find((s: { fullName: string }) => s.fullName === 'Chitra');
    expect(chitra.counts).toMatchObject({ PRESENT: 2, ON_LEAVE: 1 });
    expect(chitra.percentage).toBe(100); // leave doesn't count against her
    // A junior faculty member has no report permission.
    await api()
      .get(`/api/v1/attendance/section-report?classId=${ids.KKP_A}&from=${day(10)}&to=${day(0)}`)
      .set(as(jaya))
      .expect(403);
  });

  it('the register follows a section change: old section before the day, new one from it', async () => {
    await api()
      .post(`/api/v1/students/${students[2]}/change-section`)
      .set(as(ravi))
      .send({ classId: ids.KKP_B, effectiveOn: day(0), reason: 'Moved to B' })
      .expect(200);
    const names = async (classId: string, date: string) =>
      (
        await api()
          .get(`/api/v1/attendance/roster?classId=${classId}&date=${date}`)
          .set(as(jaya))
          .expect(200)
      ).body.students.map((s: { fullName: string }) => s.fullName);
    expect(await names(ids.KKP_A, day(1))).toEqual(['Anil', 'Bhavya', 'Chitra']);
    expect(await names(ids.KKP_A, day(0))).toEqual(['Anil', 'Bhavya']);
    expect(await names(ids.KKP_B, day(0))).toEqual(['Chitra']);
    expect(await names(ids.KKP_B, day(1))).toEqual([]);
  });

  it('a student moved on a day already marked keeps that mark; the new register takes it over', async () => {
    const roster = async (classId: string, date: string) =>
      (
        await api()
          .get(`/api/v1/attendance/roster?classId=${classId}&date=${date}`)
          .set(as(jaya))
          .expect(200)
      ).body;
    // Chitra was marked present in A this morning, then moved to B from today (test above).
    const before = await roster(ids.KKP_B, day(0));
    expect(before.marked).toBe(false); // nothing marked in B itself yet
    expect(before.students[0]).toMatchObject({
      fullName: 'Chitra',
      status: 'PRESENT',
      markedIn: expect.stringContaining('Section A'),
    });
    // B's first marking takes her record over: a new version in B, A's stays in the history.
    const saved = await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({
        classId: ids.KKP_B,
        date: day(0),
        entries: [{ studentId: students[2], status: 'PRESENT' }],
      })
      .expect(200);
    expect(saved.body).toEqual({ marked: 0, changed: 1 });
    const after = await roster(ids.KKP_B, day(0));
    expect(after.marked).toBe(true);
    expect(after.students[0]).toMatchObject({ status: 'PRESENT', markedIn: null, corrected: true });
    const today = await api()
      .get(`/api/v1/students/${students[2]}/attendance?from=${day(0)}&to=${day(0)}`)
      .set(as(ravi))
      .expect(200);
    expect(today.body.days).toHaveLength(1);
    expect(today.body.days[0].correctionReason).toMatch(/^Moved here from .*Section A/);

    // Moved with an earlier date: the same status goes along without a correction; a
    // different one on a past day is a correction (permission and reason).
    await api()
      .post(`/api/v1/students/${students[1]}/change-section`)
      .set(as(ravi))
      .send({ classId: ids.KKP_B, effectiveOn: day(1), reason: 'Moved to B' })
      .expect(200);
    const yesterday = await roster(ids.KKP_B, day(1));
    expect(yesterday.students).toEqual([
      expect.objectContaining({
        fullName: 'Bhavya',
        status: 'PRESENT',
        markedIn: expect.any(String),
      }),
    ]);
    const absent = {
      classId: ids.KKP_B,
      date: day(1),
      entries: [{ studentId: students[1], status: 'ABSENT' }],
    };
    await api().post('/api/v1/attendance/markings').set(as(jaya)).send(absent).expect(403);
    await api()
      .post('/api/v1/attendance/markings')
      .set(as(jaya))
      .send({ ...absent, entries: [{ studentId: students[1], status: 'PRESENT' }] })
      .expect(200);
    expect((await roster(ids.KKP_B, day(1))).students[0]).toMatchObject({ markedIn: null });
  });

  it('another organization sees none of it', async () => {
    await api()
      .get(`/api/v1/attendance/roster?classId=${ids.KKP_A}&date=${day(0)}`)
      .set(as(other))
      .expect(404);
    await api()
      .get(`/api/v1/students/${students[0]}/attendance?from=${day(30)}&to=${day(0)}`)
      .set(as(other))
      .expect(404);
  });
});
