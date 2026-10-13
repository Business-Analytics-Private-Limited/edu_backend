/**
 * The Academic module (ADR-0030): one set of academic years per organization, and the academic
 * structure shaped by the organization's type.
 *
 * "acad" (Intermediate): branches KPHB and AMP. Ravi = Branch admin of KPHB.
 * "school" (School) and "engg" (Engineering) show the other types.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  branchId,
  classId,
  createOrganization,
  createTestApp,
  loginSuperAdmin,
  loginUser,
} from './helpers';

interface Node {
  id: string;
  parentId: string | null;
  level: number;
  code: string;
  name: string;
  nextClassId: string | null;
  longTerm: boolean;
  builtIn: boolean;
}

describe('Academic module', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const structure = async (token = admin) =>
    (await api().get('/api/v1/academic-structure').set(as(token)).expect(200)).body as {
      type: string;
      levels: string[];
      classes: Node[];
      builtIn: { code: string; enabled: boolean }[];
    };

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'acad', 'admin@acad.test', {
      branches: [
        { name: 'KPHB', code: 'KPHB' },
        { name: 'Ameerpet', code: 'AMP' },
      ],
    });
    admin = await loginUser(app, 'admin@acad.test', 'Admin@12345');
    ids.KPHB = await branchId(app, superAdmin, orgId, 'KPHB');
    ids.AMP = await branchId(app, superAdmin, orgId, 'AMP');
    const roles = await api().get('/api/v1/roles').set(as(admin)).expect(200);
    const branchAdmin = roles.body.find((r: { name: string }) => r.name === 'Branch admin').id;
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'Ravi',
        email: 'ravi@acad.test',
        password: 'Password@123',
        roles: [{ roleId: branchAdmin, branchId: ids.KPHB }],
      })
      .expect(201);
    ravi = await loginUser(app, 'ravi@acad.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('works only when the super admin switches the Academic module on', async () => {
    const res = await api().get('/api/v1/academic-structure').set(as(admin)).expect(403);
    expect(res.body.message).toBe('The academic module is not switched on for your organization');
    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/academic`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
  });

  it('an Intermediate college starts with Junior -> Senior, and Long Term', async () => {
    const s = await structure();
    expect(s.levels).toEqual(['Year', 'Group', 'Stream', 'Section']);
    const years = s.classes.filter((c) => c.level === 1);
    expect(years.map((y) => y.code)).toEqual(['JR', 'SR', 'LT']);
    const [junior, senior, longTerm] = years;
    expect(junior.nextClassId).toBe(senior.id);
    expect(senior.nextClassId).toBeNull(); // completes
    expect(longTerm).toMatchObject({ longTerm: true, nextClassId: null });
    expect(s.builtIn.map((g) => g.code)).toEqual(['MPC', 'BIPC', 'CEC', 'HEC']);
  });

  it('groups come with the Regular stream; the college adds its own streams', async () => {
    await api()
      .put('/api/v1/academic-structure/groups')
      .set(as(admin))
      .send({ codes: ['MPC', 'BIPC'] })
      .expect(200);
    await api()
      .post('/api/v1/academic-structure/streams')
      .set(as(admin))
      .send({ groupCode: 'MPC', name: 'JEE Mains', code: 'JEEM' })
      .expect(201);
    await api()
      .post('/api/v1/academic-structure/streams')
      .set(as(admin))
      .send({ groupCode: 'BIPC', name: 'NEET Long Term', code: 'NLT', longTerm: true })
      .expect(201);
    // Each stream once per group; a group must be switched on first.
    await api()
      .post('/api/v1/academic-structure/streams')
      .set(as(admin))
      .send({ groupCode: 'MPC', name: 'Again', code: 'JEEM' })
      .expect(409);
    await api()
      .post('/api/v1/academic-structure/streams')
      .set(as(admin))
      .send({ groupCode: 'CEC', name: 'CA', code: 'CA' })
      .expect(400);

    // Junior > MPC > Regular / JEE Mains; Senior the same; Long Term > BiPC > NEET Long Term.
    for (const year of ['JR', 'SR']) {
      expect(await classId(app, admin, [year, 'MPC', 'REG'])).toBeDefined();
      expect(await classId(app, admin, [year, 'MPC', 'JEEM'])).toBeDefined();
      expect(await classId(app, admin, [year, 'BIPC', 'REG'])).toBeDefined();
    }
    expect(await classId(app, admin, ['LT', 'BIPC', 'NLT'])).toBeDefined();
    await expect(classId(app, admin, ['LT', 'MPC'])).rejects.toThrow();

    // Renaming a stream renames it everywhere.
    await api()
      .patch('/api/v1/academic-structure/streams/MPC/JEEM')
      .set(as(admin))
      .send({ name: 'JEE (Mains)' })
      .expect(200);
    const renamed = (await structure()).classes.filter((c) => c.code === 'JEEM');
    expect(renamed.map((c) => c.name)).toEqual(['JEE (Mains)', 'JEE (Mains)']);
  });

  it('each branch builds its own sections under a stream', async () => {
    const jeeJunior = await classId(app, admin, ['JR', 'MPC', 'JEEM']);
    const section = await api()
      .post(`/api/v1/branches/${ids.KPHB}/sections`)
      .set(as(ravi))
      .send({ parentId: jeeJunior, name: 'JEE-A', code: 'A' })
      .expect(201);
    ids.SECTION = section.body.id;
    // The same code at another branch is fine; twice at one branch is not.
    await api()
      .post(`/api/v1/branches/${ids.AMP}/sections`)
      .set(as(admin))
      .send({ parentId: jeeJunior, name: 'JEE-A', code: 'A' })
      .expect(201);
    await api()
      .post(`/api/v1/branches/${ids.KPHB}/sections`)
      .set(as(ravi))
      .send({ parentId: jeeJunior, name: 'Again', code: 'A' })
      .expect(409);
    // Ravi works at KPHB only, and only on sections (the structure above is the organization's).
    await api()
      .post(`/api/v1/branches/${ids.AMP}/sections`)
      .set(as(ravi))
      .send({ parentId: jeeJunior, name: 'JEE-B', code: 'B' })
      .expect(403);
    await api()
      .post('/api/v1/academic-structure/streams')
      .set(as(ravi))
      .send({ groupCode: 'MPC', name: 'IIT', code: 'IIT' })
      .expect(403);
    // A section sits under a stream, not under a group.
    const group = await classId(app, admin, ['JR', 'MPC']);
    await api()
      .post(`/api/v1/branches/${ids.KPHB}/sections`)
      .set(as(admin))
      .send({ parentId: group, name: 'X', code: 'X' })
      .expect(400);

    const kphb = await api().get(`/api/v1/branches/${ids.KPHB}/sections`).set(as(ravi)).expect(200);
    expect(kphb.body.sections).toEqual([
      expect.objectContaining({ code: 'A', path: 'Junior (1st Year) › MPC › JEE (Mains)' }),
    ]);
    await api().get(`/api/v1/branches/${ids.AMP}/sections`).set(as(ravi)).expect(404);
  });

  it('each branch runs some of the groups; its sections only go under those', async () => {
    const groupsOf = async (branch: string) =>
      (
        (await api().get('/api/v1/academic-structure').set(as(admin)).expect(200)).body
          .branchGroups[branch] as string[]
      ).sort();
    // At first every branch runs every group the organization switched on.
    expect(await groupsOf(ids.KPHB)).toEqual(['BIPC', 'MPC']);
    expect(await groupsOf(ids.AMP)).toEqual(['BIPC', 'MPC']);

    // Ravi (Branch admin of KPHB) sets his own branch only.
    await api()
      .put(`/api/v1/branches/${ids.KPHB}/groups`)
      .set(as(ravi))
      .send({ codes: ['MPC'] })
      .expect(200);
    await api()
      .put(`/api/v1/branches/${ids.AMP}/groups`)
      .set(as(ravi))
      .send({ codes: ['MPC'] })
      .expect(403);
    expect(await groupsOf(ids.KPHB)).toEqual(['MPC']);
    // Not while the branch has sections under it; only groups the organization has.
    const busy = await api()
      .put(`/api/v1/branches/${ids.KPHB}/groups`)
      .set(as(ravi))
      .send({ codes: [] })
      .expect(400);
    expect(busy.body.message).toMatch(/^KPHB still has sections under MPC/);
    await api()
      .put(`/api/v1/branches/${ids.KPHB}/groups`)
      .set(as(admin))
      .send({ codes: ['MPC', 'CEC'] })
      .expect(400);

    // Sections only under a group the branch runs.
    const bipcRegular = await classId(app, admin, ['JR', 'BIPC', 'REG']);
    const refused = await api()
      .post(`/api/v1/branches/${ids.KPHB}/sections`)
      .set(as(admin))
      .send({ parentId: bipcRegular, name: 'BiPC-A', code: 'BA' })
      .expect(400);
    expect(refused.body.message).toBe(
      "KPHB doesn't run BiPC: tick it for the branch under Structure → Groups at each branch",
    );
    await api()
      .post(`/api/v1/branches/${ids.AMP}/sections`)
      .set(as(admin))
      .send({ parentId: bipcRegular, name: 'BiPC-A', code: 'BA' })
      .expect(201);

    // Saving the organization's groups again keeps each branch's choice; a NEW group goes to
    // every branch, and a group switched off goes from every branch.
    await api()
      .put('/api/v1/academic-structure/groups')
      .set(as(admin))
      .send({ codes: ['MPC', 'BIPC', 'CEC'] })
      .expect(200);
    expect(await groupsOf(ids.KPHB)).toEqual(['CEC', 'MPC']);
    expect(await groupsOf(ids.AMP)).toEqual(['BIPC', 'CEC', 'MPC']);
    await api()
      .put('/api/v1/academic-structure/groups')
      .set(as(admin))
      .send({ codes: ['MPC', 'BIPC'] })
      .expect(200);
    expect(await groupsOf(ids.KPHB)).toEqual(['MPC']);

    // A new branch runs every group.
    await api()
      .post(`/api/v1/super-admin/organizations/${orgId}/branches`)
      .set(as(superAdmin))
      .send({ name: 'Vizag', code: 'VZG' })
      .expect(201);
    const vizag = await branchId(app, superAdmin, orgId, 'VZG');
    expect(await groupsOf(vizag)).toEqual(['BIPC', 'MPC']);
  });

  it("a stream or group with sections can't go, and built-in classes are switched off instead", async () => {
    const stream = await api()
      .delete('/api/v1/academic-structure/streams/MPC/JEEM')
      .set(as(admin))
      .expect(400);
    expect(stream.body.message).toBe('JEE (Mains) has sections; delete those first');
    await api()
      .put('/api/v1/academic-structure/groups')
      .set(as(admin))
      .send({ codes: ['BIPC'] })
      .expect(400);
    const junior = await classId(app, admin, ['JR']);
    await api().delete(`/api/v1/classes/${junior}`).set(as(admin)).expect(400);
    // A stream nobody uses can go.
    await api()
      .post('/api/v1/academic-structure/streams')
      .set(as(admin))
      .send({ groupCode: 'MPC', name: 'Temporary', code: 'TMP' })
      .expect(201);
    await api().delete('/api/v1/academic-structure/streams/MPC/TMP').set(as(admin)).expect(200);
  });

  it('level names can be renamed, not added or removed', async () => {
    await api()
      .put('/api/v1/academic-structure/level-names')
      .set(as(admin))
      .send({ names: ['Year', 'Group', 'Course', 'Section'] })
      .expect(200);
    await api()
      .put('/api/v1/academic-structure/level-names')
      .set(as(admin))
      .send({ names: ['Year', 'Section'] })
      .expect(400);
    expect((await structure()).levels[2]).toBe('Course');
  });

  it('a school ticks its classes; each one moves on to the next', async () => {
    const schoolId = await createOrganization(app, superAdmin, 'school', 'admin@school.test', {
      type: 'SCHOOL',
      modules: ['academic'],
    });
    const school = await loginUser(app, 'admin@school.test', 'Admin@12345');
    const branch = await branchId(app, superAdmin, schoolId, 'MAIN');
    await api()
      .put('/api/v1/academic-structure/school-classes')
      .set(as(school))
      .send({ codes: ['C8', 'C9', 'C10'] })
      .expect(200);
    const s = await structure(school);
    expect(s.levels).toEqual(['Class', 'Section']);
    const [c8, c9, c10] = s.classes;
    expect([c8.name, c9.name, c10.name]).toEqual(['Class 8', 'Class 9', 'Class 10']);
    expect(c8.nextClassId).toBe(c9.id);
    expect(c9.nextClassId).toBe(c10.id);
    expect(c10.nextClassId).toBeNull();

    await api()
      .post(`/api/v1/branches/${branch}/sections`)
      .set(as(school))
      .send({ parentId: c9.id, name: 'Section A', code: 'A' })
      .expect(201);
    // Class 9 has a section: it can't be unticked.
    await api()
      .put('/api/v1/academic-structure/school-classes')
      .set(as(school))
      .send({ codes: ['C8', 'C10'] })
      .expect(400);
    // Intermediate-only routes are refused for a school.
    await api()
      .put('/api/v1/academic-structure/groups')
      .set(as(school))
      .send({ codes: ['MPC'] })
      .expect(400);
  });

  it('an engineering college adds courses and specializations with their years', async () => {
    const enggId = await createOrganization(app, superAdmin, 'engg', 'admin@engg.test', {
      type: 'ENGINEERING',
      modules: ['academic'],
    });
    const engg = await loginUser(app, 'admin@engg.test', 'Admin@12345');
    const course = await api()
      .post('/api/v1/academic-structure/courses')
      .set(as(engg))
      .send({ name: 'B.Tech', code: 'BTECH' })
      .expect(201);
    await api()
      .post(`/api/v1/academic-structure/courses/${course.body.id}/specializations`)
      .set(as(engg))
      .send({ name: 'Computer Science', code: 'CSE', years: 4 })
      .expect(201);
    const s = await structure(engg);
    expect(s.levels).toEqual(['Course', 'Specialization', 'Year', 'Section']);
    const years = s.classes.filter((c) => c.level === 3);
    expect(years.map((y) => y.name)).toEqual(['1st Year', '2nd Year', '3rd Year', '4th Year']);
    expect(years[0].nextClassId).toBe(years[1].id);
    expect(years[3].nextClassId).toBeNull();

    // A 3-year degree inside it: change where 3rd Year students go (nowhere = complete).
    await api()
      .patch(`/api/v1/classes/${years[2].id}`)
      .set(as(engg))
      .send({ nextClassId: null })
      .expect(200);
    // "Next" is only for a year, and only to another year.
    await api()
      .patch(`/api/v1/classes/${course.body.id}`)
      .set(as(engg))
      .send({ nextClassId: years[0].id })
      .expect(400);
    const branch = await branchId(app, superAdmin, enggId, 'MAIN');
    await api()
      .post(`/api/v1/branches/${branch}/sections`)
      .set(as(engg))
      .send({ parentId: years[0].id, name: 'Section A', code: 'A' })
      .expect(201);
  });

  it('academic years belong to the whole organization; at most one is active', async () => {
    const create = (name: string, startsOn: string, endsOn: string, token = admin) =>
      api().post('/api/v1/academic-years').set(as(token)).send({ name, startsOn, endsOn });
    const y1 = await create('2026-27', '2026-06-01', '2027-03-31').expect(201);
    const y2 = await create('2027-28', '2027-06-01', '2028-03-31').expect(201);
    await create('Overlap', '2027-01-01', '2027-07-31').expect(400);
    await create('By Ravi', '2028-06-01', '2029-03-31', ravi).expect(403);

    await api().post(`/api/v1/academic-years/${y1.body.id}/activate`).set(as(admin)).expect(200);
    await api().post(`/api/v1/academic-years/${y2.body.id}/activate`).set(as(admin)).expect(200);
    const years = await api().get('/api/v1/academic-years').set(as(ravi)).expect(200);
    expect(years.body.map((y: { name: string; status: string }) => [y.name, y.status])).toEqual([
      ['2027-28', 'ACTIVE'],
      ['2026-27', 'CLOSED'],
    ]);
    await api().delete(`/api/v1/academic-years/${y1.body.id}`).set(as(admin)).expect(400);
  });

  it('subjects are the organization’s; a class inherits those of the classes above it', async () => {
    const maths = await api()
      .post('/api/v1/subjects')
      .set(as(admin))
      .send({ name: 'Mathematics', code: 'MATHS' })
      .expect(201);
    const physics = await api()
      .post('/api/v1/subjects')
      .set(as(admin))
      .send({ name: 'Physics', code: 'PHY' })
      .expect(201);
    const mpc = await classId(app, admin, ['JR', 'MPC']);
    await api()
      .put(`/api/v1/classes/${mpc}/subjects`)
      .set(as(admin))
      .send({ subjectIds: [maths.body.id] })
      .expect(200);
    await api()
      .put(`/api/v1/classes/${ids.SECTION}/subjects`)
      .set(as(ravi))
      .send({ subjectIds: [physics.body.id] })
      .expect(200);
    const res = await api()
      .get(`/api/v1/classes/${ids.SECTION}/subjects`)
      .set(as(ravi))
      .expect(200);
    expect(res.body.own.map((s: { code: string }) => s.code)).toEqual(['PHY']);
    expect(res.body.inherited.map((i: { subject: { code: string } }) => i.subject.code)).toEqual([
      'MATHS',
    ]);
    // Ravi can't change the organization's part of the structure.
    await api()
      .put(`/api/v1/classes/${mpc}/subjects`)
      .set(as(ravi))
      .send({ subjectIds: [] })
      .expect(403);
  });

  it('the calendar: weekly off days for all, holidays for all or one branch', async () => {
    await api()
      .put('/api/v1/calendar/weekly-off')
      .set(as(admin))
      .send({ days: [0] })
      .expect(200);
    await api()
      .post('/api/v1/holidays')
      .set(as(admin))
      .send({ name: 'Sankranti', startsOn: '2027-01-13', endsOn: '2027-01-16' })
      .expect(201);
    await api()
      .post('/api/v1/holidays')
      .set(as(ravi))
      .send({ branchId: ids.KPHB, name: 'Local festival', startsOn: '2026-10-20' })
      .expect(201);
    await api()
      .post('/api/v1/holidays')
      .set(as(ravi))
      .send({ branchId: ids.AMP, name: 'Not mine', startsOn: '2026-10-21' })
      .expect(403);
    await api()
      .post('/api/v1/holidays')
      .set(as(ravi))
      .send({ name: 'For everyone', startsOn: '2026-10-22' })
      .expect(403);
    const calendar = await api().get('/api/v1/calendar').set(as(ravi)).expect(200);
    expect(calendar.body.weeklyOffDays).toEqual([0]);
    expect(calendar.body.holidays.map((h: { name: string }) => h.name)).toEqual([
      'Local festival',
      'Sankranti',
    ]);
  });

  it("another organization never sees this one's structure", async () => {
    const otherId = await createOrganization(app, superAdmin, 'other', 'admin@other.test', {
      modules: ['academic'],
    });
    const other = await loginUser(app, 'admin@other.test', 'Admin@12345');
    const theirs = await structure(other);
    expect(theirs.classes.map((c) => c.code)).toEqual(['JR', 'SR', 'LT']); // only its own presets
    await api().get(`/api/v1/branches/${ids.KPHB}/sections`).set(as(other)).expect(404);
    await api().get(`/api/v1/classes/${ids.SECTION}/subjects`).set(as(other)).expect(404);
    expect(otherId).toBeDefined();
  });
});
