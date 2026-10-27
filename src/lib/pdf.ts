import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = PDFDocumentProxy;

export function openPdf(src: string | ArrayBuffer): Promise<PdfDoc> {
  return pdfjs.getDocument(typeof src === 'string' ? { url: src } : { data: new Uint8Array(src) }).promise;
}

export async function countPages(file: File): Promise<number> {
  const doc = await openPdf(await file.arrayBuffer());
  const n = doc.numPages;
  await doc.destroy();
  return n;
}
