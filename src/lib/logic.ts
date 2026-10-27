// Shared rules for "who has to do what, and by when". Mirrors the server rules in the SQL migration.
import type { Assignment, Attempt, Kind, Module, Profile } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const todayMY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtH(h: number | string | null | undefined): string {
  const n = Number(h) || 0;
  if (!n) return '—';
  return `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
}
export const cycleLabel = (m: Pick<Module, 'cycle' | 'refresher_months'>) =>
  m.cycle === 'fixed' ? 'Yearly refresher, fixed deadline' : m.cycle === 'rolling' ? `Refresher every ${m.refresher_months} months` : 'One-off';
export const kindLabel = (k: Kind) => (k === 'refresher' ? 'Refresher' : k === 'retake' ? 'Retake (updated)' : 'Initial');

export type StatusPill = { label: string; cls: 'ok' | 'warn' | 'bad' | 'plain' };

export class Ledger {
  today: string;
  constructor(
    public modules: Module[],
    public assignments: Assignment[],
    public attempts: Attempt[],
    public people: Profile[],
  ) {
    this.today = todayMY();
    this.attempts = attempts.filter((a) => a.status === 'submitted' && a.taken_on);
  }
  published() { return this.modules.filter((m) => m.status === 'published'); }
  mod(id: string) { return this.modules.find((m) => m.id === id); }
  atts(sid: string, mid?: string) {
    return this.attempts
      .filter((a) => a.staff_id === sid && (!mid || a.module_id === mid))
      .sort((a, b) => ((a.submitted_at || '') < (b.submitted_at || '') ? -1 : 1));
  }
  lastPass(sid: string, mid: string) { const p = this.atts(sid, mid).filter((a) => a.passed); return p[p.length - 1]; }
  allAsg(sid: string, mid: string) {
    return this.assignments
      .filter((a) => a.staff_id === sid && a.module_id === mid)
      .sort((a, b) => (a.assigned_on === b.assigned_on ? (a.created_at < b.created_at ? -1 : 1) : a.assigned_on < b.assigned_on ? -1 : 1));
  }
  asg(sid: string, mid: string): Assignment | undefined {
    const c = this.allAsg(sid, mid).filter((a) => a.assigned_on <= this.today);
    return c[c.length - 1];
  }
  scheduled(mid: string) { return this.assignments.filter((a) => a.module_id === mid && a.assigned_on > this.today); }
  done(sid: string, m: Module) {
    const a = this.asg(sid, m.id);
    return !!a && this.atts(sid, m.id).some((x) => x.passed && (x.taken_on as string) >= a.assigned_on);
  }
  failsNow(sid: string, m: Module) {
    const a = this.asg(sid, m.id);
    if (!a) return 0;
    return this.atts(sid, m.id).filter((x) => !x.passed && (x.taken_on as string) >= a.assigned_on).length;
  }
  staff() { return this.people.filter((p) => p.role === 'staff'); }
  assignedMods(sid: string) { return this.published().filter((m) => this.asg(sid, m.id)); }
  assignees(m: Module) { return this.staff().filter((s) => this.asg(s.id, m.id)); }
  isOverdue(sid: string, m: Module) { const a = this.asg(sid, m.id); return !!a && !this.done(sid, m) && a.due_on < this.today; }
  nextRefresh(sid: string, m: Module): string | null {
    if (!this.done(sid, m)) return null;
    if (m.cycle === 'rolling') { const lp = this.lastPass(sid, m.id); return lp ? addMonths(lp.taken_on as string, m.refresher_months) : null; }
    if (m.cycle === 'fixed') { const s = this.allAsg(sid, m.id).filter((a) => a.assigned_on > this.today); return s[0] ? s[0].due_on : null; }
    return null;
  }
  staffStatus(sid: string): StatusPill {
    const p = this.people.find((x) => x.id === sid);
    if (p && !p.active) return { label: 'Deactivated', cls: 'plain' };
    const mods = this.assignedMods(sid);
    if (!mods.length) return { label: 'Nothing assigned', cls: 'plain' };
    if (mods.some((m) => this.isOverdue(sid, m))) return { label: 'Overdue', cls: 'bad' };
    if (mods.some((m) => !this.done(sid, m) && this.asg(sid, m.id)!.kind !== 'initial')) return { label: 'Refresher due', cls: 'warn' };
    if (mods.some((m) => !this.done(sid, m))) return { label: 'In progress', cls: 'warn' };
    return { label: 'Up to date', cls: 'ok' };
  }
  nextDue(sid: string): string {
    const ds = this.assignedMods(sid)
      .map((m) => (this.done(sid, m) ? this.nextRefresh(sid, m) : this.asg(sid, m.id)!.due_on))
      .filter(Boolean) as string[];
    ds.sort();
    return ds[0] ? fmt(ds[0]) : '—';
  }
  passedCount(m: Module) { return this.assignees(m).filter((s) => this.done(s.id, m)).length; }
}

/** Readable random temporary password, e.g. "kite-4827-moss". */
export function tempPassword(): string {
  const words = ['amber', 'cedar', 'delta', 'ember', 'fable', 'grove', 'harbor', 'island', 'jade', 'kite', 'lumen', 'maple', 'nectar', 'orbit', 'pebble', 'quartz', 'river', 'sable', 'tidal', 'umber', 'violet', 'willow'];
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  return `${words[r(words.length)]}-${String(1000 + r(9000))}-${words[r(words.length)]}`;
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
