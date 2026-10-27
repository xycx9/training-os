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
