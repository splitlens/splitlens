/**
 * vision-ocr — spawn the bundled Swift helper (Vision framework) on an image
 * path and return structured OCR output.
 *
 * Local-first. No cloud. The helper binary must be available at one of:
 *   1. process.env.SPLITLENS_VISION_BIN
 *   2. <package>/bin/splitlens-vision    (built via `pnpm --filter @splitlens/ocr build:swift`)
 *   3. /usr/local/bin/splitlens-vision   (installed system-wide)
 *
 * If none exist we throw a VisionUnavailableError with install instructions —
 * callers (the daemon) should catch this and surface a friendly message rather
 * than swallowing the failure silently.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface OCRBlock {
  text: string;
  confidence: number;
  /** Pixel coords, top-left origin (Vision is bottom-left, but the helper flips for us). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OCRResult {
  lines: string[];
  blocks: OCRBlock[];
}

export class VisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionUnavailableError";
  }
}

export class VisionRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionRuntimeError";
  }
}

const INSTALL_HINT = [
  "splitlens-vision binary not found. Install steps:",
  "  1. xcode-select --install       # ensures the Swift toolchain is present",
  "  2. From the repo root, run:",
  "       pnpm --filter @splitlens/ocr build:swift",
  "  3. (Optional) copy bin/splitlens-vision to /usr/local/bin for a system-wide install.",
  "Override discovery with SPLITLENS_VISION_BIN=/path/to/binary.",
].join("\n");

function packageBinPath(): string | null {
  // ESM: derive the package root from this module's URL. Works in dev (TS via
  // tsx / Next.js transpilePackages) and in the future built dist/ layout.
  try {
    const here = fileURLToPath(import.meta.url);
    // src/vision-ocr.ts → ../bin/splitlens-vision
    return resolve(dirname(here), "..", "bin", "splitlens-vision");
  } catch {
    return null;
  }
}

/**
 * Resolves the Vision helper binary path. Exposed so callers can probe
 * availability without actually running OCR (e.g. daemon startup check).
 */
export function findVisionBinary(): string | null {
  const fromEnv = process.env["SPLITLENS_VISION_BIN"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const pkg = packageBinPath();
  if (pkg && existsSync(pkg)) return pkg;

  const sysWide = "/usr/local/bin/splitlens-vision";
  if (existsSync(sysWide)) return sysWide;

  return null;
}

interface SpawnOptions {
  /** Override binary path. Mostly for tests. */
  binPath?: string;
  /** Hard cap so a hung Vision call can't stall the daemon. Default 30s. */
  timeoutMs?: number;
}

/**
 * Runs the OCR helper on an image and returns lines + positional blocks.
 * Throws VisionUnavailableError if the binary isn't installed, or
 * VisionRuntimeError on a non-zero exit / parse failure.
 */
export async function recognizeText(
  imagePath: string,
  opts: SpawnOptions = {},
): Promise<OCRResult> {
  const bin = opts.binPath ?? findVisionBinary();
  if (!bin) throw new VisionUnavailableError(INSTALL_HINT);
  if (!existsSync(bin)) {
    throw new VisionUnavailableError(
      `splitlens-vision binary not found at ${bin}\n\n${INSTALL_HINT}`,
    );
  }

  if (!existsSync(imagePath)) {
    throw new VisionRuntimeError(`image not found: ${imagePath}`);
  }

  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise<OCRResult>((resolvePromise, rejectPromise) => {
    const child = spawn(bin, [imagePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new VisionRuntimeError(`Vision OCR timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new VisionRuntimeError(`failed to spawn ${bin}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        // The helper emits JSON {"error": "..."} on failure paths; surface that.
        const msg = parseErrorMessage(stdout) ?? stderr.trim() ?? `exit ${code}`;
        rejectPromise(new VisionRuntimeError(`Vision OCR failed: ${msg}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as OCRResult;
        if (!Array.isArray(parsed.lines) || !Array.isArray(parsed.blocks)) {
          throw new Error("malformed OCR output");
        }
        resolvePromise(parsed);
      } catch (err) {
        rejectPromise(
          new VisionRuntimeError(
            `could not parse OCR output: ${(err as Error).message}`,
          ),
        );
      }
    });
  });
}

function parseErrorMessage(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { error?: string };
    return parsed.error ?? null;
  } catch {
    return null;
  }
}
