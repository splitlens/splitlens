import "server-only";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";

import { openDb } from "@splitlens/db";

/**
 * GET /api/source-file/[id]
 *
 * Streams the original file behind a transaction_sources row so the review
 * UI can preview it inline. ID is the `transaction_sources.id` (stable
 * across runs).
 *
 * Restricted to bill/receipt source types — bank-statement PDFs from HDFC /
 * PhonePe are intentionally NOT exposed here. The disk path is sanity-checked
 * against bankRoot (`SPLITLENS_BANK_ROOT` or `~/Documents/bank`) so a
 * tampered DB row can't make the dev server read arbitrary files.
 */

const ALLOWED_SOURCE_TYPES = new Set<string>([
  "zepto_invoice",
  "zepto_ocr",
  "blinkit_ocr",
  "instamart_ocr",
  "manual_attachment",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".heic": "image/heic",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("invalid id", { status: 400 });
  }

  const db = openDb();
  const row = db.get<{ source_type: string; source_file: string | null }>(sql`
    SELECT ts.source_type, st.source_file
    FROM transaction_sources ts
    JOIN statements st ON st.id = ts.statement_id
    WHERE ts.id = ${id}
  `);
  if (!row || !row.source_file) {
    return new Response("not found", { status: 404 });
  }
  if (!ALLOWED_SOURCE_TYPES.has(row.source_type)) {
    return new Response("source type not previewable", { status: 403 });
  }

  const bankRoot = resolve(
    process.env.SPLITLENS_BANK_ROOT ?? `${homedir()}/Documents/bank`,
  );
  let realFile: string;
  try {
    realFile = await realpath(row.source_file);
  } catch {
    return new Response("file missing on disk", { status: 410 });
  }
  // Guard: only serve files inside bankRoot. Append separator so /a/bank
  // doesn't accidentally allow /a/bank-evil/x.pdf.
  if (!realFile.startsWith(bankRoot + sep) && realFile !== bankRoot) {
    return new Response("path outside bank root", { status: 403 });
  }

  const ext = extname(realFile).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

  let bytes: Buffer;
  let mtime: Date;
  try {
    bytes = await readFile(realFile);
    mtime = (await stat(realFile)).mtime;
  } catch {
    return new Response("read failed", { status: 500 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      // Local-only dev tool — fresh fetch each open is fine and avoids
      // stale previews after a re-attach.
      "Cache-Control": "no-store",
      "Last-Modified": mtime.toUTCString(),
    },
  });
}
