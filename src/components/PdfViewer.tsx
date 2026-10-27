import { useEffect, useRef, useState } from 'react';
import { openPdf, type PdfDoc } from '../lib/pdf';

/** Shows one page of a PDF at the width of its container. `page` is 1-based. */
export function PdfViewer({ src, page, onPages }: { src: string | ArrayBuffer | null; page: number; onPages?: (n: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const pagesCb = useRef(onPages);
  pagesCb.current = onPages;

  useEffect(() => {
    let cancelled = false;
    let opened: PdfDoc | null = null;
    setDoc(null); setErr(null);
    if (!src) return;
    openPdf(typeof src === 'string' ? src : src.slice(0))
      .then((d) => {
        if (cancelled) { d.destroy(); return; }
        opened = d; setDoc(d); pagesCb.current?.(d.numPages);
      })
      .catch(() => { if (!cancelled) setErr('Could not open this PDF. Try reloading the page.'); });
    return () => { cancelled = true; opened?.destroy(); };
  }, [src]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !width || !canvasRef.current) return;
    let cancelled = false;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    (async () => {
      const p = await doc.getPage(Math.min(Math.max(page, 1), doc.numPages));
      if (cancelled || !canvasRef.current) return;
      const base = p.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: (width / base.width) * dpr });
      const c = canvasRef.current;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = `${width}px`; c.style.height = `${vp.height / dpr}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, viewport: vp }) as unknown as typeof task;
      try { await task!.promise; } catch { /* cancelled while turning pages */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, width]);

  return (
    <div ref={boxRef} className="pdfbox">
      {err ? <div className="err" style={{ margin: 12 }}>{err}</div> : !doc ? <div className="pdf-loading">Loading pages…</div> : null}
      <canvas ref={canvasRef} hidden={!doc || !!err} role="img" aria-label={`Page ${page}`} />
    </div>
  );
}
