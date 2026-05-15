/**
 * Node-side PDF text extraction adapter for SplitLens ingestion.
 *
 * @splitlens/core parsers are pure — they accept a text extractor via DI. In
 * the browser the web app injects pdfjs-dist running in a Web Worker; here on
 * Node we inject this module. Both produce the same y-axis-clustered, left-to-
 * right `string[]` (one entry per PDF page) that the parsers consume.
 *
 * Why the /legacy build: pdfjs-dist 4.x's default ESM entry tries to spawn a
 * worker via Web APIs that don't exist in Node. The /legacy bundle runs
 * everything in the main thread.
 */
import { readFile } from "node:fs/promises";

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedPage, PdfWord } from "@splitlens/core";

/** Read a PDF file from disk and extract per-page reconstructed text. */
export async function extractTextPagesFromFile(
  filePath: string,
  password?: string,
): Promise<string[]> {
  const bytes = new Uint8Array(await readFile(filePath));
  return extractTextPages(bytes, password);
}

/**
 * Node-side positional extraction. Mirrors apps/web/src/lib/pdf-extract.ts's
 * `extractPagesPositional`: returns one PdfWord per pdfjs TextItem, with
 * top/bottom y-coordinates and left/right x-coordinates. Required by the
 * HDFC savings parser, which uses x-positions to disambiguate the adjacent
 * Withdrawal / Deposit columns.
 *
 * Same buffer-detachment caveat as `extractTextPages`: re-reads required.
 */
export async function extractPagesPositional(
  bytes: Uint8Array,
  password?: string,
): Promise<ExtractedPage[]> {
  const doc = await pdfjsLib.getDocument({
    data: bytes,
    password,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const words: PdfWord[] = [];
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const text = item.str.trim();
      if (text === "") continue;
      const x0 = item.transform[4];
      const yPdf = item.transform[5];
      const top = viewport.height - yPdf - item.height;
      words.push({
        text,
        x0,
        x1: x0 + item.width,
        top,
        bottom: top + item.height,
      });
    }

    pages.push({
      pageNumber: i,
      width: viewport.width,
      height: viewport.height,
      words,
    });
  }
  return pages;
}

/**
 * Extract per-page text from PDF bytes. Mirrors apps/web/src/lib/pdf-extract's
 * `extractTextPages`: text items are sorted by y (top-to-bottom) then x
 * (left-to-right), and items within ~2pt of the same y are joined as a single
 * line.
 *
 * NOTE: pdfjs internally transfers the underlying ArrayBuffer to its worker on
 * first read, so the input `bytes` should not be reused after this call —
 * callers needing multiple passes must re-read the file.
 */
export async function extractTextPages(
  bytes: Uint8Array,
  password?: string,
): Promise<string[]> {
  const doc = await pdfjsLib.getDocument({
    data: bytes,
    password,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items: { text: string; x: number; y: number }[] = [];
    for (const it of content.items) {
      if (!("str" in it) || typeof it.str !== "string") continue;
      const text = it.str;
      if (text.trim() === "") continue;
      items.push({
        text,
        x: it.transform[4],
        y: viewport.height - it.transform[5],
      });
    }

    items.sort((a, b) => {
      const dy = Math.round(a.y * 10) - Math.round(b.y * 10);
      if (dy !== 0) return dy;
      return a.x - b.x;
    });

    const lines: { y: number; parts: string[] }[] = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) <= 2) {
        last.parts.push(it.text);
      } else {
        lines.push({ y: it.y, parts: [it.text] });
      }
    }

    pages.push(lines.map((l) => l.parts.join(" ")).join("\n"));
  }

  return pages;
}
