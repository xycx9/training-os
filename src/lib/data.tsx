import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { Ledger } from './logic';
import type { Assignment, Attempt, JobRole, Module, PastTraining, Profile, ReadProgress, SessionFile, TrainingSession, Version, VersionLog } from './types';

const ATTEMPT_COLS = 'id,staff_id,module_id,version_id,module_title,version_label,assignment_id,status,submitted_at,taken_on,score,passed,correct_count,total,hours';

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
/** Supabase returns at most 1000 rows per request, so read in pages. */
async function fetchAll<T>(make: (from: number, to: number) => Page<T>): Promise<T[]> {
  let out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out = out.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

const num = <T extends object>(rows: T[], keys: (keyof T)[]) =>
  rows.map((r) => { const c = { ...r }; keys.forEach((k) => { (c as Record<keyof T, unknown>)[k] = Number(c[k] ?? 0); }); return c; });

/** Used until update 0005 adds the editable list. */
const DEFAULT_ROLES: JobRole[] = [
  { name: 'Management', bnm_level: 'senior', active: true, sort: 1 },
  { name: 'Compliance officer', bnm_level: 'middle', active: true, sort: 2 },
  { name: 'Teller', bnm_level: 'support', active: true, sort: 3 },
];

export interface AdminData {
  people: Profile[];
  modules: Module[];
  versions: Version[];
  logs: VersionLog[];
  assignments: Assignment[];
  attempts: Attempt[];
  past: PastTraining[];
  sessions: TrainingSession[];
  jobRoles: JobRole[];
}

interface AdminCtx {
  data: AdminData | null;
  ledger: Ledger | null;
  error: string | null;
  reload: () => Promise<void>;
  currentVersion: (moduleId: string) => Version | undefined;
}
const Ctx = createContext<AdminCtx | null>(null);

export async function loadAdmin(): Promise<AdminData> {
  await supabase.rpc('sync_refreshers');
  const [people, modules, versions, logs, assignments, attempts, past, sessions, jobRoles] = await Promise.all([
    fetchAll<Profile>((a, b) => supabase.from('profiles').select('*').order('full_name').range(a, b)),
    fetchAll<Module>((a, b) => supabase.from('modules').select('*').order('created_at').range(a, b)),
    fetchAll<Version>((a, b) => supabase.from('module_versions').select('*').order('created_at').range(a, b)),
    fetchAll<VersionLog>((a, b) => supabase.from('version_log').select('*').order('at').range(a, b)),
    fetchAll<Assignment>((a, b) => supabase.from('assignments').select('*').order('assigned_on').range(a, b)),
    fetchAll<Attempt>((a, b) => supabase.from('attempts').select(ATTEMPT_COLS).eq('status', 'submitted').order('submitted_at').range(a, b)),
    fetchAll<PastTraining>((a, b) => supabase.from('past_training').select('*').order('completed_on').range(a, b)).catch(() => [] as PastTraining[]),
    fetchAll<TrainingSession>((a, b) => supabase.from('training_sessions').select('*').order('held_on').range(a, b)).catch(() => [] as TrainingSession[]),
    fetchAll<JobRole>((a, b) => supabase.from('job_roles').select('*').order('sort').order('name').range(a, b)).catch(() => [] as JobRole[]),
  ]);
  return {
    people, versions, logs, assignments,
    past: num(past, ['hours']),
    sessions: num(sessions, ['hours']),
    jobRoles: jobRoles.length ? jobRoles : DEFAULT_ROLES,
    modules: num(modules, ['duration_hours']),
    attempts: num(attempts, ['hours']),
  };
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setData(await loadAdmin()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load data'); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const ledger = useMemo(() => (data ? new Ledger(data.modules, data.assignments, data.attempts, data.people, data.past) : null), [data]);
  const currentVersion = useCallback((id: string) => data?.versions.find((v) => v.module_id === id && v.is_current), [data]);
  return <Ctx.Provider value={{ data, ledger, error, reload, currentVersion }}>{children}</Ctx.Provider>;
}

export function useAdmin() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdmin outside provider');
  return v;
}

/* ---------- staff ---------- */
export interface StaffData {
  me: Profile;
  modules: Module[];
  versions: Version[];
  assignments: Assignment[];
  attempts: Attempt[];
  progress: ReadProgress[];
  past: PastTraining[];
  sessions: TrainingSession[];
  sessionFiles: SessionFile[];
  ledger: Ledger;
}

export async function loadStaff(me: Profile): Promise<StaffData> {
  await supabase.rpc('sync_refreshers');
  const [modules, versions, assignments, attempts, progress, past, sessions, sessionFiles] = await Promise.all([
    fetchAll<Module>((a, b) => supabase.from('modules').select('*').eq('status', 'published').range(a, b)),
    fetchAll<Version>((a, b) => supabase.from('module_versions').select('*').eq('is_current', true).range(a, b)),
    fetchAll<Assignment>((a, b) => supabase.from('assignments').select('*').eq('staff_id', me.id).range(a, b)),
    fetchAll<Attempt>((a, b) => supabase.from('attempts').select(ATTEMPT_COLS).eq('staff_id', me.id).eq('status', 'submitted').range(a, b)),
    fetchAll<ReadProgress>((a, b) => supabase.from('read_progress').select('*').eq('staff_id', me.id).range(a, b)),
    fetchAll<PastTraining>((a, b) => supabase.from('past_training').select('*').eq('staff_id', me.id).order('completed_on').range(a, b)).catch(() => [] as PastTraining[]),
    // Row-level security returns only the sessions this person attended, and only their materials.
    fetchAll<TrainingSession>((a, b) => supabase.from('training_sessions').select('*').range(a, b)).catch(() => [] as TrainingSession[]),
    fetchAll<SessionFile>((a, b) => supabase.from('session_files').select('*').eq('kind', 'material').order('file_name').range(a, b)).catch(() => [] as SessionFile[]),
  ]);
  const mods = num(modules, ['duration_hours']);
  const atts = num(attempts, ['hours']);
  const pst = num(past, ['hours']);
  return { me, modules: mods, versions, assignments, attempts: atts, progress, past: pst, sessions: num(sessions, ['hours']), sessionFiles, ledger: new Ledger(mods, assignments, atts, [me], pst) };
}
