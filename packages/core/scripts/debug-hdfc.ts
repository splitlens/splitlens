/**
 * Debug script: extract a real HDFC PDF via pdfjs-dist (Node) and run the parser.
 * Usage:
 *   pnpm tsx scripts/debug-hdfc.ts <pdf_path> <password>
 *
 * Logs the first 30 PDF text items + their coords (raw), the first 30 derived
 * "words" my extractor produces, header detection results, and a parse summary.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseHdfcSavingsPages, type ExtractedPage, type PdfWord } from "../src/index.js";
import { clusterLines, findHeaderColumns } from "../src/parsers/hdfc-savings.js";

const [, , pdfPathArg, password] = process.argv;
if (!pdfPathArg) {
  console.error("Usage: tsx scripts/debug-hdfc.ts <pdf_path> [password]");
  process.exit(2);
}
const pdfPath = resolve(pdfPathArg);
const buf = readFileSync(pdfPath);
const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

console.log(`\n=== Loading: ${pdfPath} (${data.length} bytes) ===\n`);

const doc = await pdfjsLib.getDocument({
  data,
  password,
  // Disable worker in Node — pdfjs supports inline mode
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
}).promise;

console.log(`Loaded. Pages: ${doc.numPages}`);

const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1.0 });
console.log(`Page 1 viewport: ${viewport.width} × ${viewport.height}\n`);

const textContent = await page.getTextContent();
console.log(`Page 1 has ${textContent.items.length} TextItems\n`);

console.log("=== FIRST 25 TEXT ITEMS (raw from pdfjs) ===");
for (let i = 0; i < Math.min(25, textContent.items.length); i++) {
  const it = textContent.items[i] as {
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  };
  if (!("str" in it)) continue;
  console.log({
    i,
    str: JSON.stringify(it.str),
    x: it.transform?.[4]?.toFixed(1),
    y: it.transform?.[5]?.toFixed(1),
    w: it.width?.toFixed(1),
    h: it.height?.toFixed(1),
  });
}

// Mirror of apps/web/src/lib/pdf-extract.ts extractor — emit each non-empty
// TextItem as ONE PdfWord (preserving internal spaces). HDFC's PDF emits
// "Value Dt", "Withdrawal Amt." etc. as single items.
function extract(items: typeof textContent.items, vh: number): PdfWord[] {
  const words: PdfWord[] = [];
  for (const item of items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    const text = item.str.trim();
    if (text === "") continue;
    const x0 = item.transform[4];
    const yPdf = item.transform[5];
    const top = vh - yPdf - item.height;
    words.push({
      text,
      x0,
      x1: x0 + item.width,
      top,
      bottom: top + item.height,
    });
  }
  return words;
}

const words = extract(textContent.items, viewport.height);
console.log(`\n=== EXTRACTED ${words.length} WORDS ===`);
console.log("\nFirst 30 words:");
for (let i = 0; i < Math.min(30, words.length); i++) {
  const w = words[i]!;
  console.log(
    `  ${i.toString().padStart(2)}: ${JSON.stringify(w.text).padEnd(50)} x=${w.x0.toFixed(1).padStart(6)} top=${w.top.toFixed(1).padStart(6)}`,
  );
}

// Header detection check (using NEW spaced names)
console.log("\n=== HEADER WORD CHECK (spaced format) ===");
const headerKeys = [
  "Date",
  "Narration",
  "Chq./Ref.No.",
  "Value Dt",
  "Withdrawal Amt.",
  "Deposit Amt.",
  "Closing Balance",
];
for (const k of headerKeys) {
  const found = words.find((w) => w.text === k);
  console.log(
    `  ${found ? "✅" : "❌"} ${JSON.stringify(k)}  ${found ? `→ x=${found.x0.toFixed(1)} top=${found.top.toFixed(1)}` : "NOT FOUND"}`,
  );
}

// Cluster + boundary detection
const lines = clusterLines(words);
console.log(`\n=== CLUSTERED INTO ${lines.length} LINES ===`);

// Find and print the line that contains "Date" (should be the header line)
const headerLineIdx = lines.findIndex((line) => line.some((w) => w.text === "Date"));
console.log(`Header line index: ${headerLineIdx}`);
if (headerLineIdx >= 0) {
  const hLine = lines[headerLineIdx]!;
  console.log(`Header line top=${hLine[0]!.top.toFixed(1)}, words:`);
  for (const w of hLine) {
    console.log(
      `    ${JSON.stringify(w.text).padEnd(30)} x=${w.x0.toFixed(1).padStart(6)}-${w.x1.toFixed(1).padStart(6)} top=${w.top.toFixed(1)}`,
    );
  }
}

const ranges = findHeaderColumns(lines);
console.log(`\n=== HEADER COLUMNS: ${ranges ? "FOUND" : "NOT FOUND"} ===`);
if (ranges) {
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    console.log(`  ${k.padEnd(12)} x ∈ [${lo.toFixed(1)}, ${hi.toFixed(1)}]`);
  }
}

// Run full parser across ALL pages
console.log("\n=== PARSING ALL PAGES ===");
const pages: ExtractedPage[] = [];
for (let p = 1; p <= doc.numPages; p++) {
  const pg = await doc.getPage(p);
  const vp = pg.getViewport({ scale: 1.0 });
  const tc = await pg.getTextContent();
  pages.push({
    pageNumber: p,
    width: vp.width,
    height: vp.height,
    words: extract(tc.items, vp.height),
  });
}
const result = parseHdfcSavingsPages(pages);
console.log(`\nStatement:`, result.statement);
console.log(`Transactions parsed: ${result.transactions.length}`);
console.log(`First 5 transactions:`);
for (const t of result.transactions.slice(0, 5)) {
  console.log(
    `  ${t.txnDate} | ${t.narration.slice(0, 60).padEnd(60)} | out=${t.withdrawal} in=${t.deposit} bal=${t.closingBalance}`,
  );
}

await doc.destroy();
