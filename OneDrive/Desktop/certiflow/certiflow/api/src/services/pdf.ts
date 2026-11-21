// STEP 5: draw the certificate PDF.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

export type PdfData = {
  name: string;
  course: string;
  grade: string;
  centre: string;
  number: string;
  code: string;
  issuedOn: string;
  verifyUrl: string;
};

export async function renderCertificatePdf(data: PdfData, filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  // Write to a temp file first, then rename. A half-written PDF is never served.
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
    const out = fs.createWriteStream(tmpPath);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.on('error', reject);
    doc.pipe(out);

    const { width, height } = doc.page;
    const center = (text: string, y: number, size: number, color = '#111111') =>
      doc.fillColor(color).fontSize(size).text(text, 0, y, { align: 'center', width });

    doc.rect(20, 20, width - 40, height - 40).lineWidth(3).stroke('#1f4e79');
    doc.rect(30, 30, width - 60, height - 60).lineWidth(1).stroke('#1f4e79');

    center('PRAGATI SKILLS MISSION', 70, 16, '#1f4e79');
    center('Certificate of Skill Completion', 105, 30);
    center('This is to certify that', 180, 14, '#444444');
    center(data.name, 210, 28);
    center(`has successfully completed the course "${data.course}" with grade ${data.grade}`, 262, 14, '#444444');
    center(`at ${data.centre}.`, 284, 14, '#444444');

    doc.fillColor('#111111').fontSize(11);
    doc.text(`Certificate No: ${data.number}`, 60, height - 150);
    doc.text(`Verification code: ${data.code}`, 60, height - 132);
    doc.text(`Issued on: ${data.issuedOn}`, 60, height - 114);
    doc.text(`Check it is genuine: ${data.verifyUrl}`, 60, height - 96);

    doc.end();
  });

  await fs.promises.rename(tmpPath, filePath);
}
