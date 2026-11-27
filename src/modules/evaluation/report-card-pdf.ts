/**
 * DRAWS REPORT CARDS AS A PDF (ADR-0037), one A4 page per student, with pdfkit.
 *
 * It only draws: the data comes ready from ReportCardsService (who may see what is checked
 * there). Layout, top to bottom: logo and the organization's name, the header line, the title
 * and exam; the student's details; the subjects table (maximum, pass, marks, grade); the totals
 * (total, percentage, grade, GPA, result, ranks); the grade key; signature lines; the footer note.
 */
import PDFDocument from 'pdfkit';

export interface ReportCardData {
  organizationName: string;
  branchName: string;
  title: string;
  headerLine: string | null;
  footerNote: string | null;
  signatureLabels: string[];
  logo: Buffer | null;
  exam: { name: string; type: string; year: string; dates: string };
  student: { fullName: string; admissionNo: string; rollNo: string | null; section: string };
  subjects: {
    name: string;
    maxMarks: number;
    passMarks: number;
    /** "78", "AB", "EX" or "" (not entered). */
    marks: string;
    grade: string | null;
    failed: boolean;
  }[];
  total: number;
  maxTotal: number;
  percentage: number | null;
  result: 'PASS' | 'FAIL' | 'INCOMPLETE';
  grade: string | null;
  gradeRemark: string | null;
  gpa: number | null;
  sectionRank: number | null;
  examRank: number | null;
  gradeKey: string | null;
}

const RESULT_WORDS = { PASS: 'Passed', FAIL: 'Not passed', INCOMPLETE: 'Marks incomplete' };

/** One PDF with a page per card. */
export function reportCardsPdf(cards: ReportCardData[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.info.Title =
      cards.length === 1 ? `${cards[0].title}: ${cards[0].student.fullName}` : 'Report cards';
    for (const card of cards) drawCard(doc, card);
    if (cards.length === 0) {
      doc.addPage();
      doc.fontSize(12).text('No students to show.');
    }
    doc.end();
  });
}

function drawCard(doc: PDFKit.PDFDocument, c: ReportCardData) {
  doc.addPage();
  const left = 40;
  const width = doc.page.width - 80;
  let y = 40;

  // Header: logo on the left, the organization in the middle.
  if (c.logo) {
    try {
      doc.image(c.logo, left, y, { fit: [60, 60] });
    } catch {
      // A logo pdfkit can't read is left out rather than failing the whole card.
    }
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(c.organizationName, left + 70, y + 4, {
      width: width - 140,
      align: 'center',
    });
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  if (c.headerLine)
    doc.text(c.headerLine, left + 70, doc.y + 2, { width: width - 140, align: 'center' });
  doc.text(c.branchName, left + 70, doc.y + 2, { width: width - 140, align: 'center' });
  y = Math.max(y + 66, doc.y + 8);
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .strokeColor('#999')
    .stroke();
  y += 10;
  doc
    .fillColor('#000')
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(c.title, left, y, { width, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(`${c.exam.name} (${c.exam.type}) · ${c.exam.year} · ${c.exam.dates}`, left, doc.y + 2, {
      width,
      align: 'center',
    });
  y = doc.y + 14;

  // Student details, two columns.
  const field = (label: string, value: string, x: number, yy: number) => {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(label, x, yy);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000')
      .text(value || '-', x, yy + 11, { width: width / 2 - 10 });
  };
  field('Student', c.student.fullName, left, y);
  field('Admission number', c.student.admissionNo, left + width / 2, y);
  field('Section', c.student.section, left, y + 32);
  field('Roll number', c.student.rollNo ?? '', left + width / 2, y + 32);
  y += 72;

  // Subjects table.
  const cols = [
    { label: 'Subject', w: width * 0.4, align: 'left' as const },
    { label: 'Maximum', w: width * 0.15, align: 'right' as const },
    { label: 'Pass', w: width * 0.15, align: 'right' as const },
    { label: 'Marks', w: width * 0.15, align: 'right' as const },
    { label: 'Grade', w: width * 0.15, align: 'right' as const },
  ];
  const row = (values: string[], yy: number, bold: boolean, shade: boolean, red = false) => {
    if (shade) doc.rect(left, yy - 4, width, 20).fill('#f0f0f0');
    let x = left;
    values.forEach((v, i) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .fillColor(red && i === 3 ? '#b00020' : '#000')
        .text(v, x + 6, yy, { width: cols[i].w - 12, align: cols[i].align, lineBreak: false });
      x += cols[i].w;
    });
  };
  row(
    cols.map((col) => col.label),
    y,
    true,
    true,
  );
  y += 22;
  for (const s of c.subjects) {
    row(
      [s.name, fmt(s.maxMarks), fmt(s.passMarks), s.marks || '-', s.grade ?? ''],
      y,
      false,
      false,
      s.failed,
    );
    y += 20;
    doc
      .moveTo(left, y - 4)
      .lineTo(left + width, y - 4)
      .strokeColor('#ddd')
      .stroke();
  }
  row(['Total', fmt(c.maxTotal), '', fmt(c.total), c.grade ?? ''], y, true, true);
  y += 34;

  // Summary.
  const summary: [string, string][] = [
    ['Percentage', c.percentage === null ? '-' : `${c.percentage.toFixed(2)} %`],
    ['Result', RESULT_WORDS[c.result]],
  ];
  if (c.grade) summary.push(['Grade', c.gradeRemark ? `${c.grade} (${c.gradeRemark})` : c.grade]);
  if (c.gpa !== null) summary.push(['GPA', c.gpa.toFixed(2)]);
  if (c.sectionRank !== null) summary.push(['Rank in section', String(c.sectionRank)]);
  if (c.examRank !== null) summary.push(['Rank in exam', String(c.examRank)]);
  summary.forEach(([label, value], i) => {
    const x = left + (i % 3) * (width / 3);
    const yy = y + Math.floor(i / 3) * 32;
    field(label, value, x, yy);
  });
  y += Math.ceil(summary.length / 3) * 32 + 8;
  if (c.gradeKey) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555')
      .text(`Grades: ${c.gradeKey}`, left, y, { width });
    y = doc.y + 6;
  }

  // Signatures and footer at the foot of the page.
  const foot = doc.page.height - 110;
  const n = Math.max(c.signatureLabels.length, 1);
  c.signatureLabels.forEach((label, i) => {
    const x = left + i * (width / n);
    doc
      .moveTo(x + 10, foot)
      .lineTo(x + width / n - 10, foot)
      .strokeColor('#999')
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000')
      .text(label, x, foot + 4, { width: width / n, align: 'center' });
  });
  if (c.footerNote) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555')
      .text(c.footerNote, left, foot + 30, { width, align: 'center' });
  }
}

/** 78 -> "78", 78.5 -> "78.5". */
const fmt = (n: number) => String(Math.round(n * 100) / 100);
