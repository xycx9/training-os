export type Role = 'admin' | 'staff';
export type Cycle = 'fixed' | 'rolling' | 'none';
export type Kind = 'initial' | 'refresher' | 'retake';

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  job_role: string;
  joined_on: string;
  active: boolean;
  must_change_password: boolean;
}

export interface Module {
  id: string;
  title: string;
  status: 'draft' | 'published';
  cycle: Cycle;
  refresher_months: number;
  duration_hours: number;
  due_days: number;
  per_attempt: number;
  pass_mark: number;
  max_attempts: number;
  require_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface Version {
  id: string;
  module_id: string;
  label: string;
  file_path: string | null;
  file_name: string | null;
  page_count: number | null;
  is_current: boolean;
  effective_on: string | null;
  published_by: string | null;
  published_on: string | null;
  created_at: string;
}

export interface VersionLog {
  id: string;
  version_id: string;
  kind: 'created' | 'published' | 'correction' | 'archived';
  note: string | null;
  by_user: string | null;
  at: string;
}

export interface Question {
  id?: string;
  prompt: string;
  options: string[];
  correct: number;
  source_page: number;
  approved: boolean;
}

export interface Assignment {
  id: string;
  module_id: string;
  staff_id: string;
  assigned_on: string;
  due_on: string;
  kind: Kind;
  created_at: string;
}

export interface Attempt {
  id: string;
  staff_id: string;
  module_id: string;
  version_id: string;
  module_title: string;
  version_label: string;
  assignment_id: string | null;
  status: 'in_progress' | 'submitted';
  submitted_at: string | null;
  taken_on: string | null;
  score: number | null;
  passed: boolean | null;
  correct_count: number | null;
  total: number | null;
  hours: number;
}

export interface ReadProgress {
  assignment_id: string;
  staff_id: string;
  max_page: number;
}

export interface PastTraining {
  id: string;
  staff_id: string;
  title: string;
  completed_on: string;
  hours: number;
  result: 'completed' | 'pass' | 'fail';
  score: number | null;
  delivered_by: string | null;
  notes: string | null;
  evidence_path: string | null;
  evidence_name: string | null;
  entered_by: string | null;
  entered_at: string;
  session_id?: string | null;
}

/** A downloadable reading material attached to a module version. */
export interface ModuleFile {
  id: string;
  version_id: string;
  file_path: string;
  file_name: string;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

/** A training session held before or outside the system, recorded by an admin. */
export interface TrainingSession {
  id: string;
  title: string;
  held_on: string;
  hours: number;
  delivered_by: string | null;
  assessed: boolean;
  pass_mark: number | null;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
}

/** Slides and materials used in a session (staff can download), or evidence (admins only). */
export interface SessionFile {
  id: string;
  session_id: string;
  kind: 'material' | 'evidence';
  file_path: string;
  file_name: string;
  size_bytes: number | null;
  uploaded_at: string;
}

/** A job role on the admin's list, with the BNM level used in the STE report. */
export type BnmLevel = 'senior' | 'middle' | 'support';
export interface JobRole { name: string; bnm_level: BnmLevel; active: boolean; sort: number }

/** Staff Training Expenditure: one workbook per financial year. */
export type SteCategory = 'a' | 'b_i' | 'b_ii' | 'b_iii' | 'b_iv' | 'b_v';
export type Participation = Partial<Record<BnmLevel, { soft?: number; technical?: number; leadership?: number }>>;
export interface SteYear {
  id: string;
  fy_end: string;
  gross_wages_prev: number;
  carry_forward: number;
  carry_forward_ref: string | null;
  historical: boolean;
  status: 'draft' | 'submitted';
  submitted_on: string | null;
  fibox_ref: string | null;
  prepared_name: string | null;
  prepared_title: string | null;
  prepared_contact: string | null;
  report_date: string | null;
  participation: Participation;
  notes: string | null;
  created_at: string;
}
export interface SteExpense {
  id: string;
  year_id: string;
  spent_on: string;
  category: SteCategory;
  description: string;
  amount: number;
  payee: string | null;
  payment_ref: string | null;
  session_id: string | null;
  module_id: string | null;
  trainer_id: string | null;
  doc_path: string | null;
  doc_name: string | null;
  created_at: string;
}
export interface SteActivity { name: string; frequency: string; sessions: number; hours: number; justification: string }
export interface SteTrainer {
  id: string;
  year_id: string;
  staff_id: string | null;
  trainer_name: string;
  trainer_role: string | null;
  monthly_salary: number;
  monthly_allowances: number;
  monthly_epf: number;
  hours_per_month: number;
  activities: SteActivity[];
  session_ids: string[];
}
export interface SteLog { id: number; year_id: string; action: string; note: string | null; by_user: string | null; at: string }
