/**
 * The Academic module: academic years, class levels and classes, batches, subjects and the
 * calendar (ADR-0019).
 *
 * Organization "acad": institution SVJC (junior college) with campuses KKP and AMP.
 * Ravi is Campus admin of KKP. Organization "other" must never see any of it.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createOrganization, createTestApp, loginSuperAdmin, loginUser } from './helpers';

describe('Academic', () => {
  let app: INestApplication;
  let superAdmin: string;
  let orgId: string;
  let admin: string;
  let ravi: string;
  let other: string;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    superAdmin = await loginSuperAdmin(app);
    orgId = await createOrganization(app, superAdmin, 'acad', 'admin@acad.test');
    await createOrganization(app, superAdmin, 'acad-other', 'admin@acad-other.test');
    admin = await loginUser(app, 'admin@acad.test', 'Admin@12345');
    other = await loginUser(app, 'admin@acad-other.test', 'Admin@12345');

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
    const roles = await api().get('/api/v1/roles').set(as(admin));
    const campusAdmin = roles.body.find((r: { name: string }) => r.name === 'Campus admin');
    await api()
      .post('/api/v1/users')
      .set(as(admin))
      .send({
        name: 'Ravi',
        email: 'ravi@acad.test',
        password: 'Password@123',
        roles: [{ roleId: campusAdmin.id, campusId: ids.KKP }],
      })
      .expect(201);
    ravi = await loginUser(app, 'ravi@acad.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('works only when the Academic module is switched on', async () => {
    const res = await api().get('/api/v1/academic-years').set(as(admin)).expect(403);
    expect(res.body.message).toBe('The academic module is not switched on for your organization');

    await api()
      .put(`/api/v1/super-admin/organizations/${orgId}/modules/academic`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
    await api().get('/api/v1/academic-years').set(as(admin)).expect(200);
  });

  it('a new institution starts with default levels, which it can reshape before it has classes', async () => {
    const levels = await api()
      .get(`/api/v1/institutions/${ids.SVJC}/class-levels`)
      .set(as(admin))
      .expect(200);
    expect(levels.body.map((l: { name: string }) => l.name)).toEqual(['Year', 'Group', 'Section']);

    // An institution that works with four levels, e.g. Type -> Group -> Stream -> Section.
    const reshaped = await api()
      .put(`/api/v1/institutions/${ids.SVJC}/class-levels`)
      .set(as(admin))
      .send({ names: ['Type', 'Group', 'Stream', 'Section'] })
      .expect(200);
    expect(reshaped.body.map((l: { position: number }) => l.position)).toEqual([1, 2, 3, 4]);
  });

  it('builds a campus class tree that follows the levels', async () => {
    const add = (body: object) =>
      api().post(`/api/v1/campuses/${ids.KKP}/classes`).set(as(admin)).send(body);

    const junior = await add({ name: 'Junior Inter', code: 'JR' }).expect(201);
    expect(junior.body.level).toBe(1);
    const mpc = await add({ parentId: junior.body.id, name: 'MPC', code: 'MPC' }).expect(201);
    const eamcet = await add({ parentId: mpc.body.id, name: 'EAMCET', code: 'EAM' }).expect(201);
    const sectionA = await add({ parentId: eamcet.body.id, name: 'Section A', code: 'A' }).expect(
      201,
    );
    expect(sectionA.body.level).toBe(4);
    ids.JR = junior.body.id;
    ids.MPC = mpc.body.id;
    ids.A = sectionA.body.id;

    // Nothing below the last level; codes unique among siblings.
    await add({ parentId: sectionA.body.id, name: 'Too deep', code: 'X' }).expect(400);
    await add({ parentId: eamcet.body.id, name: 'Another A', code: 'A' }).expect(409);

    const tree = await api().get(`/api/v1/campuses/${ids.KKP}/classes`).set(as(admin)).expect(200);
    expect(tree.body.classes).toHaveLength(4);
    expect(tree.body.levels.map((l: { name: string }) => l.name)).toEqual([
      'Type',
      'Group',
      'Stream',
      'Section',
    ]);
  });

  it('once classes exist, levels can be renamed but not added or removed', async () => {
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/class-levels`)
      .set(as(admin))
      .send({ names: ['Year', 'Group', 'Section'] })
      .expect(400);
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/class-levels`)
      .set(as(admin))
      .send({ names: ['Course type', 'Group', 'Stream', 'Section'] })
      .expect(200);
  });

  it('a class with classes under it cannot be deleted', async () => {
    await api().delete(`/api/v1/classes/${ids.JR}`).set(as(admin)).expect(400);
  });

  it('a campus admin builds only their own campus', async () => {
    await api().get(`/api/v1/campuses/${ids.KKP}/classes`).set(as(ravi)).expect(200);
    await api().get(`/api/v1/campuses/${ids.AMP}/classes`).set(as(ravi)).expect(404);
    await api()
      .post(`/api/v1/campuses/${ids.KKP}/classes`)
      .set(as(ravi))
      .send({ name: 'Senior Inter', code: 'SR' })
      .expect(201);
    await api()
      .post(`/api/v1/campuses/${ids.AMP}/classes`)
      .set(as(ravi))
      .send({ name: 'Senior Inter', code: 'SR' })
      .expect(403);
    // Levels belong to the whole institution: a campus admin sees them, can't change them.
    await api().get(`/api/v1/institutions/${ids.SVJC}/class-levels`).set(as(ravi)).expect(200);
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/class-levels`)
      .set(as(ravi))
      .send({ names: ['A', 'B', 'C', 'D'] })
      .expect(403);
  });

  it('academic years: no overlaps, one active year, only planned years can be deleted', async () => {
    const create = (name: string, startsOn: string, endsOn: string) =>
      api()
        .post('/api/v1/academic-years')
        .set(as(admin))
        .send({ institutionId: ids.SVJC, name, startsOn, endsOn });

    const y1 = await create('2026-27', '2026-06-01', '2027-03-31').expect(201);
    await create('2026-28', '2027-01-01', '2027-12-31').expect(400); // overlaps 2026-27
    await create('Backwards', '2027-06-01', '2027-01-01').expect(400);
    const y2 = await create('2027-28', '2027-06-01', '2028-03-31').expect(201);

    await api().post(`/api/v1/academic-years/${y1.body.id}/activate`).set(as(admin)).expect(200);
    await api().post(`/api/v1/academic-years/${y2.body.id}/activate`).set(as(admin)).expect(200);
    const years = await api()
      .get(`/api/v1/academic-years?institutionId=${ids.SVJC}`)
      .set(as(admin))
      .expect(200);
    const status = Object.fromEntries(
      years.body.map((y: { name: string; status: string }) => [y.name, y.status]),
    );
    expect(status).toEqual({ '2026-27': 'CLOSED', '2027-28': 'ACTIVE' });

    await api().delete(`/api/v1/academic-years/${y2.body.id}`).set(as(admin)).expect(400);

    // A campus admin sees the institution's years but can't create them.
    const seen = await api().get('/api/v1/academic-years').set(as(ravi)).expect(200);
    expect(seen.body).toHaveLength(2);
    await api()
      .post('/api/v1/academic-years')
      .set(as(ravi))
      .send({
        institutionId: ids.SVJC,
        name: '2028-29',
        startsOn: '2028-06-01',
        endsOn: '2029-03-31',
      })
      .expect(403);
  });

  it("batches carry a stage in the institution's own words", async () => {
    const batch = await api()
      .post('/api/v1/batches')
      .set(as(admin))
      .send({ institutionId: ids.SVJC, name: '2026-28 batch', code: 'B2026', stage: 'Junior' })
      .expect(201);
    const moved = await api()
      .patch(`/api/v1/batches/${batch.body.id}`)
      .set(as(admin))
      .send({ stage: 'Senior' })
      .expect(200);
    expect(moved.body.stage).toBe('Senior');

    const seen = await api().get('/api/v1/batches').set(as(ravi)).expect(200);
    expect(seen.body.map((b: { code: string }) => b.code)).toEqual(['B2026']);
    await api()
      .post('/api/v1/batches')
      .set(as(ravi))
      .send({ institutionId: ids.SVJC, name: 'Long term 2026', code: 'LT26', stage: 'Long term' })
      .expect(403);
  });

  it('subjects attached to a class are inherited by the classes below it', async () => {
    const add = (name: string, code: string) =>
      api()
        .post('/api/v1/subjects')
        .set(as(admin))
        .send({ institutionId: ids.SVJC, name, code })
        .expect(201);
    const maths = await add('Mathematics', 'MATHS');
    const physics = await add('Physics', 'PHY');
    ids.MATHS = maths.body.id;

    // A campus admin can't change the institution's subject list...
    await api()
      .post('/api/v1/subjects')
      .set(as(ravi))
      .send({ institutionId: ids.SVJC, name: 'Chemistry', code: 'CHEM' })
      .expect(403);
    // ...but attaches subjects to their own campus's classes.
    await api()
      .put(`/api/v1/classes/${ids.MPC}/subjects`)
      .set(as(ravi))
      .send({ subjectIds: [maths.body.id, physics.body.id] })
      .expect(200);

    const sectionA = await api()
      .get(`/api/v1/classes/${ids.A}/subjects`)
      .set(as(admin))
      .expect(200);
    expect(sectionA.body.own).toEqual([]);
    expect(
      sectionA.body.inherited.map((i: { subject: { code: string } }) => i.subject.code).sort(),
    ).toEqual(['MATHS', 'PHY']);
    expect(sectionA.body.inherited[0].from.name).toBe('MPC');

    // A subject that classes use can't be deleted.
    await api().delete(`/api/v1/subjects/${ids.MATHS}`).set(as(admin)).expect(400);
  });

  it('calendar: weekly off days and holidays for the institution or one campus', async () => {
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/weekly-off`)
      .set(as(admin))
      .send({ days: [0, 6] })
      .expect(200);
    await api()
      .put(`/api/v1/institutions/${ids.SVJC}/weekly-off`)
      .set(as(ravi))
      .send({ days: [0] })
      .expect(403);

    const holiday = (token: string, body: object) =>
      api()
        .post('/api/v1/holidays')
        .set(as(token))
        .send({ institutionId: ids.SVJC, ...body });
    await holiday(admin, {
      name: 'Sankranti',
      startsOn: '2027-01-13',
      endsOn: '2027-01-16',
    }).expect(201);
    await holiday(admin, {
      name: 'Backwards',
      startsOn: '2027-02-10',
      endsOn: '2027-02-01',
    }).expect(400);
    await holiday(ravi, {
      name: 'KKP sports day',
      startsOn: '2026-12-05',
      campusId: ids.KKP,
    }).expect(201);
    await holiday(ravi, { name: 'Whole institution', startsOn: '2026-12-06' }).expect(403);
    await holiday(ravi, { name: 'Other campus', startsOn: '2026-12-07', campusId: ids.AMP }).expect(
      403,
    );

    const cal = await api().get('/api/v1/calendar').set(as(ravi)).expect(200);
    expect(cal.body.institutions[0].weeklyOffDays).toEqual([0, 6]);
    expect(cal.body.holidays.map((h: { name: string }) => h.name)).toEqual([
      'KKP sports day',
      'Sankranti',
    ]);
    const ranged = await api()
      .get('/api/v1/calendar?from=2027-01-01&to=2027-01-31')
      .set(as(admin))
      .expect(200);
    expect(ranged.body.holidays.map((h: { name: string }) => h.name)).toEqual(['Sankranti']);
  });

  it('another organization sees none of it', async () => {
    await api().get(`/api/v1/campuses/${ids.KKP}/classes`).set(as(other)).expect(403); // module off
    const otherOrg = await api().get('/api/v1/organization').set(as(other)).expect(200);
    await api()
      .put(`/api/v1/super-admin/organizations/${otherOrg.body.id}/modules/academic`)
      .set(as(superAdmin))
      .send({ enabled: true })
      .expect(200);
    await api().get(`/api/v1/campuses/${ids.KKP}/classes`).set(as(other)).expect(404);
    await api().get(`/api/v1/institutions/${ids.SVJC}/class-levels`).set(as(other)).expect(404);
    expect((await api().get('/api/v1/academic-years').set(as(other)).expect(200)).body).toEqual([]);
    expect((await api().get('/api/v1/batches').set(as(other)).expect(200)).body).toEqual([]);
    expect((await api().get('/api/v1/subjects').set(as(other)).expect(200)).body).toEqual([]);
    expect((await api().get('/api/v1/calendar').set(as(other)).expect(200)).body.holidays).toEqual(
      [],
    );
    await api().get(`/api/v1/classes/${ids.A}/subjects`).set(as(other)).expect(404);
    await api().patch(`/api/v1/classes/${ids.A}`).set(as(other)).send({ name: 'x' }).expect(404);
  });
});
