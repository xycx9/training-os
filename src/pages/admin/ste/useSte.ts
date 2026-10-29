import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { SteExpense, SteLog, SteTrainer, SteYear } from '../../../lib/types';

export interface SteBundle { year: SteYear; expenses: SteExpense[]; trainers: SteTrainer[]; log: SteLog[] }

const n = <T extends object>(rows: T[], keys: (keyof T)[]) => rows.map((r) => { const c = { ...r }; keys.forEach((k) => { (c as Record<keyof T, unknown>)[k] = Number(c[k] ?? 0); }); return c; });

/** Loads one financial year with its expenses, trainer worksheets and history. */
export function useSte(id: string | undefined) {
  const [d, setD] = useState<SteBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!id) return;
    const [y, e, t, l] = await Promise.all([
      supabase.from('ste_years').select('*').eq('id', id).maybeSingle(),
      supabase.from('ste_expenses').select('*').eq('year_id', id).order('spent_on').order('created_at'),
      supabase.from('ste_trainers').select('*').eq('year_id', id).order('trainer_name'),
      supabase.from('ste_log').select('*').eq('year_id', id).order('at', { ascending: false }),
    ]);
    const bad = y.error || e.error || t.error;
    if (bad) { setErr(bad.message); return; }
    if (!y.data) { setErr('This financial year was not found.'); return; }
    setD({
      year: n([y.data as SteYear], ['gross_wages_prev', 'carry_forward'])[0],
      expenses: n((e.data as SteExpense[]) ?? [], ['amount']),
      trainers: n((t.data as SteTrainer[]) ?? [], ['monthly_salary', 'monthly_allowances', 'monthly_epf', 'hours_per_month']),
      log: (l.data as SteLog[] | null) ?? [],
    });
    setErr(null);
  }, [id]);
  useEffect(() => { reload(); }, [reload]);
  return { d, err, reload };
}
