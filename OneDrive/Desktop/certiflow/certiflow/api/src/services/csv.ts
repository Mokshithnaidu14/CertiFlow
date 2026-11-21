
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export const MAX_ROWS = 500;
export const REQUIRED_COLUMNS = ['name', 'phone', 'course', 'grade'];

const rowSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must have at least 2 letters')
    .max(100, 'Name is too long')
    .regex(/^[A-Za-z][A-Za-z .'-]*$/, 'Name can only contain letters, spaces, dots, hyphens and apostrophes'),
  phone: z
    .string()
    .trim()
    .transform((p) => p.replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, ''))
    .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Phone must be a 10-digit Indian mobile number')),
  course: z.string().trim().min(2, 'Course is required').max(100, 'Course is too long'),
  grade: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['A', 'B', 'C', 'D'], { errorMap: () => ({ message: 'Grade must be A, B, C or D' }) })),
});

export type CandidateRow = z.infer<typeof rowSchema>;
export type RowError = { row: number; field: string; message: string };

export function parseCandidatesCsv(text: string): { rows: CandidateRow[]; errors: RowError[] } {
  let headers: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: (header: string[]) => (headers = header.map((h) => h.trim().toLowerCase())),
      skip_empty_lines: true,
      relax_column_count: true, 
      trim: true,
      bom: true,
    });
  } catch (err) {
    return { rows: [], errors: [{ row: 0, field: 'file', message: `Could not read the file: ${(err as Error).message}` }] };
  }

  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [{ row: 1, field: 'header', message: `Missing column(s): ${missing.join(', ')}. Expected: ${REQUIRED_COLUMNS.join(', ')}` }] };
  }
  if (records.length === 0) {
    return { rows: [], errors: [{ row: 0, field: 'file', message: 'The file has no candidate rows' }] };
  }
  if (records.length > MAX_ROWS) {
    return { rows: [], errors: [{ row: 0, field: 'file', message: `Too many rows (${records.length}). The limit is ${MAX_ROWS}.` }] };
  }

  const rows: CandidateRow[] = [];
  const errors: RowError[] = [];
  const firstRowForPhone = new Map<string, number>();

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const result = rowSchema.safeParse({
      name: record.name ?? '',
      phone: record.phone ?? '',
      course: record.course ?? '',
      grade: record.grade ?? '',
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ row: rowNumber, field: String(issue.path[0] ?? 'row'), message: issue.message });
      }
      return;
    }
    const firstRow = firstRowForPhone.get(result.data.phone);
    if (firstRow) {
      errors.push({ row: rowNumber, field: 'phone', message: `Same phone number as row ${firstRow}` });
      return;
    }
    firstRowForPhone.set(result.data.phone, rowNumber);
    rows.push(result.data);
  });

  return { rows: errors.length > 0 ? [] : rows, errors };
}
