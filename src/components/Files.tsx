import { useRef, useState } from 'react';
import { errText, supabase } from '../lib/supabase';
import { useToast } from './Toast';

/** Reading materials and session slides: PDF, Word, Excel, PowerPoint, up to 50 MB each. */
export const READING_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
export const READING_MB = 50;
/** Evidence and marked papers: PDF or image, up to 10 MB each (admins only). */
export const EVIDENCE_EXT = ['pdf', 'jpg', 'jpeg', 'png'];
export const EVIDENCE_MB = 10;

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
};

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export function fileType(name: string) {
  const e = extOf(name);
  if (e === 'pdf') return 'PDF';
  if (e === 'doc' || e === 'docx') return 'Word';
  if (e === 'xls' || e === 'xlsx') return 'Excel';
  if (e === 'ppt' || e === 'pptx') return 'PowerPoint';
  if (e === 'jpg' || e === 'jpeg' || e === 'png') return 'Image';
  return 'File';
}
const badge = (name: string) => { const e = extOf(name); return e === 'jpeg' ? 'JPG' : (e || 'file').toUpperCase().slice(0, 4); };
export function fileSize(n?: number | null) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Checks a file against the allowed types and size; returns a sentence if it is not acceptable. */
export function checkFile(f: File, exts: string[], maxMb: number): string | null {
  if (!exts.includes(extOf(f.name))) return `${f.name}: this type of file can’t be added. Use ${exts.filter((e) => e !== 'jpeg').map((e) => e.toUpperCase()).join(', ')}.`;
  if (f.size > maxMb * 1024 * 1024) return `${f.name} is larger than ${maxMb} MB.`;
  return null;
}

export interface Uploaded { file_path: string; file_name: string; size_bytes: number }

/** Uploads one file under a random name in the folder given and returns where it went. */
export async function uploadFile(bucket: 'readings' | 'evidence' | 'ste-docs', folder: string, f: File): Promise<Uploaded> {
  const e = extOf(f.name);
  const file_path = `${folder}/${crypto.randomUUID()}.${e}`;
  const { error } = await supabase.storage.from(bucket).upload(file_path, f, { contentType: MIME[e] || f.type || undefined });
  if (error) throw new Error(`${f.name}: ${error.message}`);
  return { file_path, file_name: f.name, size_bytes: f.size };
}

/** Downloads a stored file under its original name. */
export async function downloadFile(bucket: string, path: string, name: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10, { download: name });
  if (error || !data) throw new Error(error?.message || 'Could not download the file');
  window.location.assign(data.signedUrl);
}

/** Opens a stored file (PDF or image) in a new tab to view it. */
export async function viewFile(bucket: string, path: string) {
  const w = window.open('', '_blank');
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);
    if (error || !data) throw new Error(error?.message || 'Could not open the file');
    if (w) w.location.href = data.signedUrl; else window.location.assign(data.signedUrl);
  } catch (e) { w?.close(); throw e; }
}

export interface StoredFile { id: string; file_path: string; file_name: string; size_bytes?: number | null }

/** A list of stored files with a Download (or View) button and an optional Remove button. */
export function FileList({ files, bucket, onRemove, view = false, empty }: {
  files: StoredFile[]; bucket: string; onRemove?: (f: StoredFile) => void; view?: boolean; empty?: string;
}) {
  const toast = useToast();
  if (!files.length) return empty ? <p className="small muted">{empty}</p> : null;
  return (
    <div className="filelist">
      {files.map((f) => (
        <div className="fileline" key={f.id}>
          <span className="ico" aria-hidden="true">{badge(f.file_name)}</span>
          <span className="fname"><b>{f.file_name}</b><span className="small muted">{[fileType(f.file_name), fileSize(f.size_bytes)].filter(Boolean).join(' · ')}</span></span>
          <span className="row noprint" style={{ gap: 8 }}>
            <button type="button" className="btn slim" onClick={() => (view ? viewFile(bucket, f.file_path) : downloadFile(bucket, f.file_path, f.file_name)).catch((e) => toast(errText(e), true))}>{view ? 'View' : 'Download'}</button>
            {onRemove && <button type="button" className="btn slim danger" onClick={() => onRemove(f)}>Remove</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Files picked in a form but not uploaded yet. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="filelist">
      {files.map((f, i) => (
        <div className="fileline" key={`${f.name}-${i}`}>
          <span className="ico" aria-hidden="true">{badge(f.name)}</span>
          <span className="fname"><b>{f.name}</b><span className="small muted">{fileType(f.name)} · {fileSize(f.size)}</span></span>
          <button type="button" className="btn slim" onClick={() => onRemove(i)}>Remove</button>
        </div>
      ))}
    </div>
  );
}

/** A button that opens the file chooser and hands back the files that pass the checks. */
export function AddFiles({ label, exts, maxMb, multiple = true, onFiles, disabled }: {
  label: string; exts: string[]; maxMb: number; multiple?: boolean; onFiles: (f: File[]) => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [key, setKey] = useState(0);
  return (
    <>
      <input key={key} ref={ref} type="file" multiple={multiple} hidden accept={exts.map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          const bad = picked.map((f) => checkFile(f, exts, maxMb)).filter(Boolean) as string[];
          if (bad.length) toast(bad.join(' '), true);
          const ok = picked.filter((f) => !checkFile(f, exts, maxMb));
          if (ok.length) onFiles(ok);
          setKey(key + 1);
        }} />
      <button type="button" className="btn" disabled={disabled} onClick={() => ref.current?.click()}>{label}</button>
    </>
  );
}
