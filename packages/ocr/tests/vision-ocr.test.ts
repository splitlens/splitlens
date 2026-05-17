import { describe, it, expect } from "vitest";
import {
  findVisionBinary,
  recognizeText,
  VisionUnavailableError,
  VisionRuntimeError,
} from "../src/vision-ocr";

describe("findVisionBinary", () => {
  it("returns a string or null without throwing", () => {
    const r = findVisionBinary();
    expect(r === null || typeof r === "string").toBe(true);
  });
});

describe("recognizeText error handling", () => {
  it("throws VisionUnavailableError when binPath does not exist", async () => {
    await expect(
      recognizeText("/tmp/nonexistent.png", { binPath: "/tmp/no-such-binary-xyz" }),
    ).rejects.toThrow(VisionUnavailableError);
  });

  it("throws VisionRuntimeError when image does not exist", async () => {
    // Use a path that definitely exists as a "binary" so we get past the
    // existence check but fail on the image existence check. /bin/sh works
    // on every macOS / Linux system the tests would run on.
    await expect(
      recognizeText("/tmp/definitely-not-an-image.png", { binPath: "/bin/sh" }),
    ).rejects.toThrow(VisionRuntimeError);
  });
});
