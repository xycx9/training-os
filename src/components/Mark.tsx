/** The INCO Compliance Training shield mark. `tone` is for use on the blue header or on white. */
export function Mark({ size = 36, tone = 'onBrand' }: { size?: number; tone?: 'onBrand' | 'onWhite' }) {
  const bg = tone === 'onBrand' ? 'rgba(255,255,255,0.12)' : '#0B2F6B';
  const ring = tone === 'onBrand' ? 'rgba(255,255,255,0.35)' : '#0B2F6B';
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill={bg} stroke={ring} />
      <path d="M16 5.5 25 9v6.5c0 5.6-3.8 9.6-9 11-5.2-1.4-9-5.4-9-11V9z" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
      <path d="m11.5 16 3.2 3.2 6-6.4" fill="none" stroke="#7FB0FF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
