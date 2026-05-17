/**
 * @splitlens/ocr — local-first OCR pipeline for screenshot receipts.
 *
 * Vision OCR (on-device) → per-merchant parser → canonical txn match.
 *
 * No cloud OCR. The pipeline shells out to a small Swift helper that wraps
 * macOS's Vision framework. See README.md for install steps.
 */

export {
  recognizeText,
  findVisionBinary,
  VisionUnavailableError,
  VisionRuntimeError,
} from "./vision-ocr";
export type { OCRBlock, OCRResult } from "./vision-ocr";

export {
  parseReceipt,
  ALL_PARSERS,
  zeptoParser,
  blinkitParser,
  instamartParser,
} from "./parsers/index";
export type {
  ExtractedReceipt,
  Merchant,
  ReceiptItem,
  ReceiptParser,
} from "./parsers/index";

export { matchTxn } from "./match";
export type { MatchableTxn, MatchOptions, ReceiptToMatch } from "./match";
