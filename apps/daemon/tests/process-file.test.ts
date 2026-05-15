import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDb, closeDb, type SplitLensDb } from "@splitlens/db";

import { resolveDaemonPaths } from "../src/paths";
import { processInboxFile } from "../src/process-file";

// We don't need real ingest passwords for the test cases below — every case
// is determined by the FILENAME (classifyByFilename) before any PDF gets
// read. We use innocuous file content because the underlying orchestrator
// would error on a non-PDF; the "unclassified" / "no_orchestrator" branches
// short-circuit before that.

let tmp: string;
let db: SplitLensDb;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "splitlens-daemon-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

function setupBankDirs() {
  const paths = resolveDaemonPaths(tmp);
  // The daemon's main() ensures these exist at startup; the unit test does
  // the same so processInboxFile has somewhere to move files to.
  for (const dir of [paths.inbox, paths.unparsed, ...Object.values(paths.archive)]) {
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
  return paths;
}

describe("processInboxFile — unclassified files go to unparsed/", () => {
  it("moves a file with no recognized pattern to unparsed/", async () => {
    const paths = setupBankDirs();
    const src = join(paths.inbox, "random-document.pdf");
    writeFileSync(src, "not a real pdf");

    const result = await processInboxFile(src, db, paths);

    expect(result.outcome.kind).toBe("unclassified");
    expect(existsSync(src)).toBe(false);
    expect(existsSync(join(paths.unparsed, "random-document.pdf"))).toBe(true);
  });
});

describe("processInboxFile — recognized-but-not-yet-supported source", () => {
  it("moves an HDFC FD advice to archive/hdfc-fd/ (no orchestrator) instead of unparsed/", async () => {
    const paths = setupBankDirs();
    const src = join(paths.inbox, "FDAdvice_97369.pdf");
    writeFileSync(src, "not a real pdf");

    const result = await processInboxFile(src, db, paths);

    expect(result.outcome.kind).toBe("no_orchestrator");
    expect(existsSync(src)).toBe(false);
    expect(existsSync(join(paths.archive.hdfc_fd, "FDAdvice_97369.pdf"))).toBe(true);
  });
});

describe("processInboxFile — ingest failures go to unparsed/ with a sibling .error.log", () => {
  it("a file the classifier accepts but the parser rejects ends up in unparsed/ + .error.log", async () => {
    const paths = setupBankDirs();
    // PhonePe-recognized name, but the content is not a real PDF, so pdfjs
    // will throw inside extractTextPages → outcome=failed → moved to unparsed/.
    const src = join(paths.inbox, "PhonePe_Transaction_Statement.pdf");
    writeFileSync(src, "not a real pdf");

    const result = await processInboxFile(src, db, paths);

    expect(result.outcome.kind).toBe("failed");
    expect(existsSync(src)).toBe(false);
    const dst = join(paths.unparsed, "PhonePe_Transaction_Statement.pdf");
    expect(existsSync(dst)).toBe(true);
    expect(existsSync(dst + ".error.log")).toBe(true);
    const log = readFileSync(dst + ".error.log", "utf8");
    expect(log).toMatch(/PhonePe_Transaction_Statement\.pdf/);
    expect(log).toMatch(/error:/);
  });
});
