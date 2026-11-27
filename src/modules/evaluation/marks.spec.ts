/**
 * Unit tests for the pure helpers of the marks service: reading one CSV value, a student's
 * result, and ranks with ties. Fast, no database (the e2e tests cover the endpoints).
 */
import { rank, readMark, resultOf } from './marks.service';
import type { ExamSubjectInfo } from './exams.service';

const subject = (code: string, maxMarks: number, passMarks: number): ExamSubjectInfo => ({
  examSubjectId: `es-${code}`,
  subjectId: code,
  code,
  name: code,
  maxMarks,
  passMarks,
  examDate: null,
  portion: null,
});
const MAT = subject('MAT', 100, 35);
const PHY = subject('PHY', 50, 18);

describe('readMark', () => {
  it('reads numbers, AB, EX and blanks', () => {
    expect(readMark('78', MAT)).toEqual({ status: 'PRESENT', marks: 78 });
    expect(readMark(' 39.5 ', MAT)).toEqual({ status: 'PRESENT', marks: 39.5 });
    expect(readMark('ab', MAT)).toEqual({ status: 'ABSENT', marks: null });
    expect(readMark('A', MAT)).toEqual({ status: 'ABSENT', marks: null });
    expect(readMark('Ex', MAT)).toEqual({ status: 'EXEMPT', marks: null });
    expect(readMark('', MAT)).toBeNull();
    expect(readMark('-', MAT)).toBeNull();
    expect(readMark(undefined, MAT)).toBeNull();
  });

  it('reads a number sent as a number', () => {
    expect(readMark(45 as unknown as string, PHY)).toEqual({ status: 'PRESENT', marks: 45 });
  });

  it('refuses what is not a mark, too many decimals, negatives and marks above the maximum', () => {
    expect(() => readMark('x', MAT)).toThrow('MAT "x" is not a mark');
    expect(() => readMark('10.555', MAT)).toThrow(/not a mark/);
    expect(() => readMark('-5', MAT)).toThrow(/not a mark/);
    expect(() => readMark('51', PHY)).toThrow('PHY 51 is above the maximum of 50');
  });
});

describe('resultOf', () => {
  const cells = (entries: [string, 'PRESENT' | 'ABSENT' | 'EXEMPT', number | null][]) =>
    new Map(entries.map(([id, status, marks]) => [id, { status, marks }]));

  it('passes with every subject at or above the pass marks', () => {
    expect(
      resultOf(
        [MAT, PHY],
        cells([
          ['MAT', 'PRESENT', 35],
          ['PHY', 'PRESENT', 40],
        ]),
      ),
    ).toEqual({ total: 75, maxTotal: 150, percentage: 50, result: 'PASS', complete: true });
  });

  it('fails when absent or below the pass marks in a subject', () => {
    expect(
      resultOf(
        [MAT, PHY],
        cells([
          ['MAT', 'PRESENT', 90],
          ['PHY', 'ABSENT', null],
        ]),
      ).result,
    ).toBe('FAIL');
    expect(
      resultOf(
        [MAT, PHY],
        cells([
          ['MAT', 'PRESENT', 34.99],
          ['PHY', 'PRESENT', 50],
        ]),
      ).result,
    ).toBe('FAIL');
  });

  it('leaves exempt subjects out of the totals', () => {
    expect(
      resultOf(
        [MAT, PHY],
        cells([
          ['MAT', 'PRESENT', 80],
          ['PHY', 'EXEMPT', null],
        ]),
      ),
    ).toMatchObject({
      total: 80,
      maxTotal: 100,
      percentage: 80,
      result: 'PASS',
    });
  });

  it('is incomplete with a subject missing, unless something already failed', () => {
    expect(resultOf([MAT, PHY], cells([['MAT', 'PRESENT', 80]]))).toMatchObject({
      result: 'INCOMPLETE',
      complete: false,
    });
    expect(resultOf([MAT, PHY], cells([['MAT', 'PRESENT', 10]])).result).toBe('FAIL');
  });
});

describe('rank', () => {
  it('gives equal totals the same rank and skips the next (1, 2, 2, 4)', () => {
    const ranks = rank([
      { studentId: 'a', total: 90 },
      { studentId: 'b', total: 80 },
      { studentId: 'c', total: 80 },
      { studentId: 'd', total: 70 },
    ]);
    expect([...ranks.entries()].sort()).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });
});
