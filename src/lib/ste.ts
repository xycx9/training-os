import type { SteActivity, SteCategory, SteExpense, SteTrainer, SteYear } from './types';
import { addMonths, fmt, todayMY } from './logic';

/** The expense categories of S 7.2, in the order of the BNM return. */
export const CATS: { key: SteCategory; code: string; label: string; short: string }[] = [
  { key: 'a', code: '(a)', label: 'Seminar and course fees, scholarships, and incidental costs (transport, accommodation, allowances)', short: 'Seminar and course fees, scholarships and other incidental costs and expenditures' },
  { key: 'b_i', code: '(b)(i)', label: 'Training premises: rental or equivalent rental', short: 'Rental / equivalent rental cost of training premise' },
  { key: 'b_ii', code: '(b)(ii)', label: 'Rental of equipment and cost of producing course materials', short: 'Rental of training equipment' },
  { key: 'b_iii', code: '(b)(iii)', label: 'Depreciation of assets used for training', short: 'Depreciation cost of assets purchased and used for training' },
  { key: 'b_iv', code: '(b)(iv)', label: 'Salaries of in-house trainers', short: 'Salaries of in-house trainers' },
  { key: 'b_v', code: '(b)(v)', label: 'External trainers or resource persons', short: 'Engaging external trainers or resource persons' },
];
export const catOf = (k: SteCategory) => CATS.find((c) => c.key === k)!;

export const money = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

/** Financial year label: FY2024 for a December year end, otherwise "FY ending Mar 2025". */
export function fyLabel(fyEnd: string) {
  const [y, m] = fyEnd.split('-');
  if (m === '12') return `FY${y}`;
  return `FY ending ${new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(fyEnd + 'T00:00:00Z'))}`;
}
export function fyStart(fyEnd: string) {
  const d = new Date(fyEnd + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** Report due one month after the financial year end (S 8.4). A month-end year end is due at the end of the next month. */
export function dueDate(fyEnd: string) {
  const d = new Date(fyEnd + 'T12:00:00Z');
  const next = new Date(d); next.setUTCDate(d.getUTCDate() + 1);
  if (next.getUTCDate() === 1) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0, 12)); return x.toISOString().slice(0, 10); }
  return addMonths(fyEnd, 1);
}
export const mmyyyy = (fyEnd: string) => `${fyEnd.slice(5, 7)}/${fyEnd.slice(0, 4)}`;

export function totals(y: SteYear, ex: SteExpense[]) {
  const by = Object.fromEntries(CATS.map((c) => [c.key, 0])) as Record<SteCategory, number>;
  ex.forEach((e) => { by[e.category] += Number(e.amount) || 0; });
  const a = by.a;
  const b = by.b_i + by.b_ii + by.b_iii + by.b_iv + by.b_v;
  const req = Math.round((Number(y.gross_wages_prev) || 0) * 2) / 100;
  const spent = a + b;
  const available = req + (Number(y.carry_forward) || 0);
  return { by, a, b, req, spent, available, unused: Math.max(0, available - spent), util: req ? spent / req : 0 };
}

export function statusOf(y: SteYear) {
  if (y.status === 'submitted') return { label: 'Submitted', cls: 'ok' };
  if (todayMY() > dueDate(y.fy_end)) return { label: 'Report overdue', cls: 'bad' };
  if (todayMY() > y.fy_end) return { label: 'Report due', cls: 'warn' };
  return { label: 'In progress', cls: 'warn' };
}

/** In-house trainer worksheet maths. */
export const monthlyCost = (t: Pick<SteTrainer, 'monthly_salary' | 'monthly_allowances' | 'monthly_epf'>) =>
  (Number(t.monthly_salary) || 0) + (Number(t.monthly_allowances) || 0) + (Number(t.monthly_epf) || 0);
export const hourlyRate = (t: SteTrainer) => Math.round((monthlyCost(t) / (Number(t.hours_per_month) || 176)) * 100) / 100;
export const actHours = (a: SteActivity) => (Number(a.sessions) || 0) * (Number(a.hours) || 0);
export const totalHours = (t: SteTrainer) => t.activities.reduce((s, a) => s + actHours(a), 0);
export const trainerAmount = (t: SteTrainer) => Math.round(totalHours(t) * hourlyRate(t) * 100) / 100;

export const DEFAULT_ACTIVITIES: SteActivity[] = [
  { name: 'Training needs assessment and planning', frequency: 'Quarterly', sessions: 4, hours: 2, justification: 'Identifying training needs based on staff roles, BNM regulatory updates, audit findings and previous gaps. Tailoring training content to operational and compliance risks.' },
  { name: 'Preparation of training materials', frequency: 'Quarterly', sessions: 4, hours: 3, justification: 'Developing and updating presentation slides, handouts, quizzes and scenario-based exercises aligned with current AMLA, MSBA and internal SOPs.' },
  { name: 'Delivery of training sessions', frequency: 'Quarterly', sessions: 4, hours: 2, justification: 'Conducting structured in-person sessions for counter staff and directors, including presentation, Q&A and scenario walkthroughs. Attendance is recorded.' },
  { name: 'Post-training assessment and evaluation', frequency: 'Quarterly', sessions: 4, hours: 1.5, justification: 'Reviewing staff feedback, analysing quiz results, identifying comprehension gaps and documenting staff performance.' },
  { name: 'Record-keeping and reporting', frequency: 'Quarterly', sessions: 4, hours: 1.5, justification: 'Maintaining training logs, attendance lists and evaluation forms, and summarising session outcomes for internal and audit trail purposes.' },
];
export const isDelivery = (a: SteActivity) => /deliver/i.test(a.name);

export const dateText = (d: string | null | undefined) => (d ? fmt(d) : '—');

/* ---------- a small .xlsx writer (no library needed) ---------- */
type Cell = string | number | null | { v: string | number; s?: number };
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: [string, string][]): Blob {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xe = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const colNum = (ref: string) => ref.replace(/\d+/g, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** Styles: 1 bold, 2 money, 3 percent, 4 wrapped text, 5 bold money, 6 bold wrapped. */
export function xlsx(sheetName: string, cells: Record<string, Cell>, widths: number[], merges: string[] = []): Blob {
  const rows = new Map<number, [string, Cell][]>();
  Object.entries(cells).forEach(([ref, v]) => { const r = Number(ref.replace(/\D+/g, '')); rows.set(r, [...(rows.get(r) ?? []), [ref, v]]); });
  const sheetRows = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.sort((a, b) => colNum(a[0]) - colNum(b[0])).map(([ref, raw]) => {
    if (raw === null || raw === undefined) return '';
    const c = typeof raw === 'object' ? raw : { v: raw, s: 0 };
    const s = c.s ? ` s="${c.s}"` : '';
    return typeof c.v === 'number' ? `<c r="${ref}"${s}><v>${c.v}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xe(c.v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const mg = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${sheetRows}</sheetData>${mg}</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}
export function saveBlob(name: string, blob: Blob) {
  const u = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
