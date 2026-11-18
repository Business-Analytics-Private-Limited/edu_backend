/**
 * Promotion (ADR-0030): a branch's students move from one academic year to the next along the
 * progression (Junior -> Senior), with the same group, stream and section; Senior and Long Term
 * students complete and become outgoing. Nothing is overwritten, and a promotion can be undone.
 *
 * Organization "prom" (Intermediate), branch MAIN:
 *   Junior > MPC > JEE Mains > A    (Arun 1, Bala 2)     -> Senior > MPC > JEE Mains > A
 *   Junior > MPC > Regular  > A    (Chitra)             -> no Senior Regular A: the user chooses
 *   Senior > MPC > JEE Mains > A   (Deepa)              -> completes
 *   Long Term > BiPC > NEET LT > A (Esha)               -> completes
 * Years 2026-27 (active) and 2027-28. Ravi = Branch admin, Lakshmi = Principal (may promote).
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

describe('Promotion', () => {
  let app: INestApplication;
  let admin: string;
  let ravi: string;
  let lakshmi: string;
  let branch: string;
  let sections: Record<string, string>;
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const query = () => `branchId=${branch}&fromYearId=${ids.Y26}&toYearId=${ids.Y27}`;

  beforeAll(async () => {
    app = await createTestApp();
    const superAdmin = await loginSuperAdmin(app);
    const orgId = await createOrganization(app, superAdmin, 'prom', 'admin@prom.test', {
      modules: ['academic', 'students'],
    });
    admin = await loginUser(app, 'admin@prom.test', 'Admin@12345');
    branch = await branchId(app, superAdmin, orgId, 'MAIN');
    sections = await setUpIntermediate(app, admin, branch, {
      groups: ['MPC', 'BIPC'],
      streams: [
        { groupCode: 'MPC', name: 'JEE Mains', code: 'JEEM' },
        { groupCode: 'BIPC', name: 'NEET Long Term', code: 'NLT', longTerm: true },
      ],
      sections: [
        { under: ['JR', 'MPC', 'JEEM'], name: 'A', code: 'A', key: 'JRJEE' },
        { under: ['SR', 'MPC', 'JEEM'], name: 'A', code: 'A', key: 'SRJEE' },
        { under: ['JR', 'MPC', 'REG'], name: 'A', code: 'A', key: 'JRREG' },
        { under: ['SR', 'MPC', 'REG'], name: 'B', code: 'B', key: 'SRREGB' },
        { under: ['LT', 'BIPC', 'NLT'], name: 'A', code: 'A', key: 'LTA' },
      ],
    });
    // Same code under Senior JEE Mains: "A" and "A" match. Regular: Junior "A", Senior only "B".
    ids.Y26 = await createYear(app, admin, '2026-27', '2026-06-01', '2027-03-31', true);
    ids.Y27 = await createYear(app, admin, '2027-28', '2027-06-01', '2028-03-31');

    for (const [name, section, rollNo] of [
      ['Arun', 'JRJEE', '1'],
      ['Bala', 'JRJEE', '2'],
      ['Chitra', 'JRREG', '1'],
      ['Deepa', 'SRJEE', '1'],
      ['Esha', 'LTA', '1'],
    ]) {
      const res = await api()
        .post('/api/v1/students')
        .set(as(admin))
        .send({
          branchId: branch,
          admissionNo: name.toUpperCase(),
          admissionDate: '2026-06-01',
          fullName: name,
          dateOfBirth: '2009-01-01',
          gender: 'FEMALE',
          enrolment: { academicYearId: ids.Y26, classId: sections[section], rollNo },
        })
        .expect(201);
      ids[name] = res.body.id;
    }

    const roles = await api().get('/api/v1/roles').set(as(admin));
    const role = (name: string) => roles.body.find((r: { name: string }) => r.name === name).id;
    for (const [email, roleName] of [
      ['ravi@prom.test', 'Branch admin'],
      ['lakshmi@prom.test', 'Principal'],
    ]) {
      await api()
        .post('/api/v1/users')
        .set(as(admin))
        .send({
          name: email.split('@')[0],
          email,
          password: 'Password@123',
          roles: [{ roleId: role(roleName), branchId: branch }],
        })
        .expect(201);
    }
    ravi = await loginUser(app, 'ravi@prom.test', 'Password@123');
    lakshmi = await loginUser(app, 'lakshmi@prom.test', 'Password@123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs the promote permission (a Principal has it, a Branch admin not)', async () => {
    await api().get(`/api/v1/promotions/preview?${query()}`).set(as(ravi)).expect(403);
    await api().get(`/api/v1/promotions/preview?${query()}`).set(as(lakshmi)).expect(200);
  });

  it('the preview follows Junior -> Senior with the same group, stream and section', async () => {
    const res = await api()
      .get(`/api/v1/promotions/preview?${query()}`)
      .set(as(lakshmi))
      .expect(200);
    const byFrom = Object.fromEntries(
      res.body.rows.map((r: { from: { label: string }; suggestion: object }) => [
        r.from.label,
        r.suggestion,
      ]),
    );
    expect(byFrom).toEqual({
      'Junior (1st Year) › MPC › JEE Mains › A': { kind: 'section', sectionId: sections.SRJEE },
      'Junior (1st Year) › MPC › Regular (IPE) › A': { kind: 'choose' },
      'Senior (2nd Year) › MPC › JEE Mains › A': { kind: 'complete' },
      'Long Term › BiPC › NEET Long Term › A': { kind: 'complete' },
    });
    // Where a matching section would go (for "Add section"), and the targets' years.
    const regular = res.body.rows.find(
      (r: { from: { id: string } }) => r.from.id === sections.JRREG,
    );
    expect(regular).toMatchObject({
      nextPlace: { label: 'Senior (2nd Year) › MPC › Regular (IPE)' },
      section: { name: 'A', code: 'A' },
    });
    const longTerm = res.body.rows.find(
      (r: { from: { id: string } }) => r.from.id === sections.LTA,
    );
    expect(longTerm.nextPlace).toBeNull(); // they complete
    expect(res.body.sections.find((x: { id: string }) => x.id === sections.SRJEE).yearLabel).toBe(
      'Senior (2nd Year)',
    );
  });

  it('only the chosen students of a section are promoted; the others stay', async () => {
    const promote = (mapping: object[]) =>
      api()
        .post('/api/v1/promotions')
        .set(as(lakshmi))
        .send({ branchId: branch, fromYearId: ids.Y26, toYearId: ids.Y27, mapping })
        .expect(200);
    // Nobody chosen in a section: nothing happens there.
    const none = await promote([
      { fromSectionId: sections.JRJEE, toSectionId: sections.SRJEE, studentIds: [] },
    ]);
    expect(none.body).toMatchObject({ promoted: 0, completed: 0, runId: null });

    // Arun is promoted; Bala, in the same section, stays in 2026-27.
    const some = await promote([
      { fromSectionId: sections.JRJEE, toSectionId: sections.SRJEE, studentIds: [ids.Arun] },
    ]);
    expect(some.body).toMatchObject({ promoted: 1, completed: 0 });
    const preview = await api()
      .get(`/api/v1/promotions/preview?${query()}`)
      .set(as(lakshmi))
      .expect(200);
    const jee = preview.body.rows.find(
      (r: { from: { id: string } }) => r.from.id === sections.JRJEE,
    );
    expect(jee.students.map((s: { fullName: string }) => s.fullName)).toEqual(['Bala']);

    // Undo it, so the next tests start from the same place.
    await api().post(`/api/v1/promotions/${some.body.runId}/undo`).set(as(lakshmi)).expect(200);
  });

  it('apply: new placements in the new year; Senior and Long Term complete', async () => {
    const res = await api()
      .post('/api/v1/promotions')
      .set(as(lakshmi))
      .send({
        branchId: branch,
        fromYearId: ids.Y26,
        toYearId: ids.Y27,
        keepRollNumbers: true,
        mapping: [
          { fromSectionId: sections.JRJEE, toSectionId: sections.SRJEE },
          { fromSectionId: sections.JRREG, toSectionId: sections.SRREGB },
          { fromSectionId: sections.SRJEE, complete: true },
          { fromSectionId: sections.LTA, complete: true },
        ],
      })
      .expect(200);
    expect(res.body).toMatchObject({ promoted: 3, completed: 2 });
    ids.RUN = res.body.runId;

    // The old year's placement stays, PROMOTED; the new one starts with the new year.
    const arun = await api().get(`/api/v1/students/${ids.Arun}`).set(as(admin)).expect(200);
    expect(
      arun.body.enrolments.map(
        (e: {
          academicYear: { name: string };
          status: string;
          section: string;
          rollNo: string;
        }) => [e.academicYear.name, e.status, e.section, e.rollNo],
      ),
    ).toEqual([
      ['2027-28', 'ACTIVE', 'Senior (2nd Year) › MPC › JEE Mains › A', '1'],
      ['2026-27', 'PROMOTED', 'Junior (1st Year) › MPC › JEE Mains › A', '1'],
    ]);
    // The old placement ends with the old year.
    expect(arun.body.enrolments[1].endedOn).toBe('2027-03-31T00:00:00.000Z');
    // Completed students are outgoing.
    const outgoing = await api().get('/api/v1/students?show=outgoing').set(as(admin)).expect(200);
    expect(outgoing.body.items.map((s: { fullName: string }) => s.fullName).sort()).toEqual([
      'Deepa',
      'Esha',
    ]);
    // A second run finds nobody left to move.
    const again = await api()
      .get(`/api/v1/promotions/preview?${query()}`)
      .set(as(lakshmi))
      .expect(200);
    expect(again.body.rows).toEqual([]);
  });

  it('undo puts everything back, once, and only while nothing changed', async () => {
    await api().post(`/api/v1/promotions/${ids.RUN}/undo`).set(as(lakshmi)).expect(200);
    await api().post(`/api/v1/promotions/${ids.RUN}/undo`).set(as(lakshmi)).expect(400);
    const deepa = await api().get(`/api/v1/students/${ids.Deepa}`).set(as(admin)).expect(200);
    expect(deepa.body.status).toBe('ACTIVE');
    const arun = await api().get(`/api/v1/students/${ids.Arun}`).set(as(admin)).expect(200);
    expect(arun.body.enrolments.map((e: { status: string }) => e.status)).toEqual(['ACTIVE']);
    expect(arun.body.enrolments[0].endedOn).toBeNull(); // undo clears the end

    // Promote again, then change one student's section: undo is refused.
    const res = await api()
      .post('/api/v1/promotions')
      .set(as(lakshmi))
      .send({
        branchId: branch,
        fromYearId: ids.Y26,
        toYearId: ids.Y27,
        mapping: [{ fromSectionId: sections.JRJEE, toSectionId: sections.SRJEE }],
      })
      .expect(200);
    await api()
      .post(`/api/v1/students/${ids.Bala}/change-section`)
      .set(as(admin))
      .send({ classId: sections.SRREGB, effectiveOn: '2027-07-01' })
      .expect(200);
    const refused = await api()
      .post(`/api/v1/promotions/${res.body.runId}/undo`)
      .set(as(lakshmi))
      .expect(400);
    expect(refused.body.message).toMatch(/^Can't undo: 1 student\(s\) changed since/);
  });
});
