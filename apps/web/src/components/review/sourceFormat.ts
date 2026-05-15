/**
 * Per-source-type formatter for the review-page Sources block.
 *
 * Each transaction_sources row's `raw_json` has a different shape depending
 * on which extractor / parser produced it. This module knows how to lift
 * that opaque blob into:
 *
 *   - `icon`    : a 1-char emoji that previews the source kind at a glance
 *   - `chips`   : 2-4 short label/value pairs to show ALWAYS-visible under
 *                 the source's summary line (so the user can scan a card
 *                 without expanding it)
 *   - `details` : longer key/value rows shown on click-to-expand
 *   - `items`   : optional itemized list for receipt-type sources (Swiggy,
 *                 Zomato, Zepto, OCR'd screenshots)
 *
 * Pure — takes (sourceType, rawJson) and returns a display object. No I/O,
 * no React. Tested implicitly via the review page.
 */

export interface SourceChip {
  label: string;
  value: string;
  /** Use mono font for IDs / UTRs / hashes. */
  mono?: boolean;
}

export interface SourceDetailRow {
  label: string;
  value: string;
  mono?: boolean;
  /** Long string — render in a multi-line block instead of a single row. */
  block?: boolean;
}

export interface SourceItem {
  name: string;
  qty: number;
  amount: number | null;
}

export interface FormattedSource {
  icon: string;
  /** Human-friendly title — what's shown big at the top of the card. */
  title: string;
  /** One-line subtitle (usually merchant / order id / etc.). */
  subtitle: string | null;
  /** Always-visible chips under the title. */
  chips: SourceChip[];
  /** Detail rows shown when the card is expanded. */
  details: SourceDetailRow[];
  /** Optional itemized list (Swiggy / Zomato / Zepto). */
  items: SourceItem[] | null;
}

const ICON_BY_TYPE: Record<string, string> = {
  phonepe: "📱",
  gpay: "📱",
  cred: "💳",
  hdfc_savings: "🏦",
  hdfc_cc: "💳",
  hdfc_fd: "🏦",
  swiggy_email: "🍔",
  zomato_email: "🍽️",
  zepto_invoice: "🛒",
  zepto_ocr: "🛒",
  blinkit_ocr: "🛒",
  instamart_ocr: "🛒",
};

const TITLE_BY_TYPE: Record<string, string> = {
  phonepe: "PhonePe",
  gpay: "Google Pay",
  cred: "CRED",
  hdfc_savings: "HDFC savings statement",
  hdfc_cc: "HDFC credit card statement",
  hdfc_fd: "HDFC FD advice",
  swiggy_email: "Swiggy email receipt",
  zomato_email: "Zomato email receipt",
  zepto_invoice: "Zepto invoice PDF",
  zepto_ocr: "Zepto screenshot",
  blinkit_ocr: "Blinkit screenshot",
  instamart_ocr: "Instamart screenshot",
};

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  return String(v);
}
function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtInr(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  // "2024-06-23 23:04" local time
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

// ============================================================================
// Per-source formatters
// ============================================================================

function formatPhonePe(raw: Record<string, unknown>): FormattedSource {
  const direction = asString(raw.direction);
  const counterparty = asString(raw.counterparty);
  const amount = asNumber(raw.amount);
  const time = asString(raw.txnTime);
  const utr = asString(raw.utr);
  const txnId = asString(raw.transactionId);
  const last4 = asString(raw.sourceAccountLast4);
  const kind = asString(raw.kind);
  const split = asString(raw.splitSourceRaw);

  const chips: SourceChip[] = [];
  if (time) chips.push({ label: "Time", value: time, mono: true });
  if (utr) chips.push({ label: "UTR", value: utr, mono: true });
  if (last4) chips.push({ label: "Account", value: `••• ${last4}` });

  const details: SourceDetailRow[] = ([
    { label: "Direction", value: direction === "out" ? "Paid out" : "Received" },
    counterparty ? { label: "Counterparty", value: counterparty } : null,
    amount != null ? { label: "Amount", value: fmtInr(amount) } : null,
    txnId ? { label: "Transaction ID", value: txnId, mono: true } : null,
    utr ? { label: "UTR", value: utr, mono: true } : null,
    last4 ? { label: "Source account", value: `••• ${last4}` } : null,
    kind ? { label: "Counterparty kind", value: kind } : null,
    split ? { label: "Split source (raw)", value: split, block: true, mono: true } : null,
  ] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);

  return {
    icon: ICON_BY_TYPE.phonepe!,
    title: TITLE_BY_TYPE.phonepe!,
    subtitle: counterparty
      ? `${direction === "out" ? "→" : "←"} ${counterparty}`
      : null,
    chips,
    details,
    items: null,
  };
}

function formatHdfcSavings(raw: Record<string, unknown>): FormattedSource {
  const narration = asString(raw.narration);
  const refNo = asString(raw.refNo);
  const valueDate = asString(raw.valueDate);
  const withdrawal = asNumber(raw.withdrawal);
  const deposit = asNumber(raw.deposit);
  const closing = asNumber(raw.closingBalance);

  const chips: SourceChip[] = [];
  if (refNo) chips.push({ label: "Ref", value: refNo, mono: true });
  if (closing != null) chips.push({ label: "Closing balance", value: fmtInr(closing) });

  const details: SourceDetailRow[] = ([
    valueDate ? { label: "Value date", value: valueDate, mono: true } : null,
    withdrawal != null ? { label: "Withdrawal", value: fmtInr(withdrawal) } : null,
    deposit != null ? { label: "Deposit", value: fmtInr(deposit) } : null,
    refNo ? { label: "Bank ref / UTR", value: refNo, mono: true } : null,
    closing != null ? { label: "Closing balance", value: fmtInr(closing) } : null,
    narration ? { label: "Narration", value: narration, block: true, mono: true } : null,
  ] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);

  return {
    icon: ICON_BY_TYPE.hdfc_savings!,
    title: TITLE_BY_TYPE.hdfc_savings!,
    subtitle: refNo ?? null,
    chips,
    details,
    items: null,
  };
}

function formatHdfcCc(raw: Record<string, unknown>): FormattedSource {
  const desc = asString(raw.description);
  const amount = asNumber(raw.amount);
  const isPayment = raw.isPayment === true;
  const isCharge = raw.isCharge === true;
  const isIntl = raw.isInternational === true;
  const rewards = asNumber(raw.rewardPoints);
  const fcyAmount = asNumber(raw.foreignAmount);
  const fcyCurrency = asString(raw.foreignCurrency);

  const chips: SourceChip[] = [];
  if (amount != null) chips.push({ label: "Amount", value: fmtInr(amount) });
  if (isPayment) chips.push({ label: "Type", value: "Payment" });
  else if (isCharge) chips.push({ label: "Type", value: "Charge" });
  if (isIntl) chips.push({ label: "Intl", value: "Yes" });

  const details: SourceDetailRow[] = ([
    amount != null ? { label: "Amount", value: fmtInr(amount) } : null,
    { label: "Direction", value: isPayment ? "Payment received" : "Purchase / charge" },
    isCharge ? { label: "Charge", value: "Yes (fee / tax / interest)" } : null,
    isIntl ? { label: "International", value: "Yes" } : null,
    fcyAmount != null
      ? { label: "Foreign amount", value: `${fcyCurrency ?? ""} ${fcyAmount}`.trim() }
      : null,
    rewards != null ? { label: "Reward points", value: String(rewards) } : null,
    desc ? { label: "Description", value: desc, block: true, mono: true } : null,
  ] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);

  return {
    icon: ICON_BY_TYPE.hdfc_cc!,
    title: TITLE_BY_TYPE.hdfc_cc!,
    subtitle: isPayment ? "Statement payment" : "Card purchase / charge",
    chips,
    details,
    items: null,
  };
}

function formatEmailReceipt(
  raw: Record<string, unknown>,
  isSwiggy: boolean,
): FormattedSource {
  const restaurant = asString(raw.restaurant);
  const amount = asNumber(raw.amount);
  const orderId = asString(raw.orderId);
  const kind = asString(raw.kind);
  const emailDate = asString(raw.emailDate);
  const summary = asString(raw.summary);
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];

  const items: SourceItem[] = itemsRaw.map((i) => {
    const r = i as Record<string, unknown>;
    return {
      name: asString(r.name) ?? "",
      qty: asNumber(r.qty) ?? 1,
      amount: asNumber(r.price),
    };
  });

  const chips: SourceChip[] = [];
  if (amount != null) chips.push({ label: "Total", value: fmtInr(amount) });
  if (items.length > 0) {
    chips.push({ label: "Items", value: String(items.length) });
  }
  if (kind) chips.push({ label: "Kind", value: kind });

  const details: SourceDetailRow[] = ([
    restaurant ? { label: "Restaurant / store", value: restaurant } : null,
    orderId ? { label: "Order ID", value: orderId, mono: true } : null,
    amount != null ? { label: "Total", value: fmtInr(amount) } : null,
    kind ? { label: "Order kind", value: kind } : null,
    emailDate
      ? {
          label: "Email received",
          value:
            (fmtTime(emailDate) ?? emailDate) +
            (fmtRelative(emailDate) ? ` (${fmtRelative(emailDate)})` : ""),
        }
      : null,
    summary ? { label: "Summary", value: summary } : null,
  ] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);

  return {
    icon: isSwiggy ? ICON_BY_TYPE.swiggy_email! : ICON_BY_TYPE.zomato_email!,
    title: isSwiggy ? TITLE_BY_TYPE.swiggy_email! : TITLE_BY_TYPE.zomato_email!,
    subtitle: restaurant ?? orderId ?? null,
    chips,
    details,
    items: items.length > 0 ? items : null,
  };
}

function formatZeptoInvoice(raw: Record<string, unknown>): FormattedSource {
  const orderNo = asString(raw.orderNo);
  const invoiceNo = asString(raw.invoiceNo);
  const date = asString(raw.date);
  const amount = asNumber(raw.amount);
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];

  const items: SourceItem[] = itemsRaw.map((i) => {
    const r = i as Record<string, unknown>;
    return {
      name: asString(r.name) ?? "",
      qty: asNumber(r.qty) ?? 1,
      amount: asNumber(r.amount),
    };
  });

  const chips: SourceChip[] = [];
  if (amount != null) chips.push({ label: "Invoice total", value: fmtInr(amount) });
  if (items.length > 0) chips.push({ label: "Items", value: String(items.length) });
  if (date) chips.push({ label: "Date", value: date, mono: true });

  const details: SourceDetailRow[] = ([
    orderNo ? { label: "Order No.", value: orderNo, mono: true } : null,
    invoiceNo ? { label: "Invoice No.", value: invoiceNo, mono: true } : null,
    date ? { label: "Invoice date", value: date, mono: true } : null,
    amount != null ? { label: "Invoice value", value: fmtInr(amount) } : null,
  ] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);

  return {
    icon: ICON_BY_TYPE.zepto_invoice!,
    title: TITLE_BY_TYPE.zepto_invoice!,
    subtitle: orderNo ?? null,
    chips,
    details,
    items: items.length > 0 ? items : null,
  };
}

function formatScreenshotOcr(
  raw: Record<string, unknown>,
  sourceType: string,
): FormattedSource {
  const merchant = asString(raw.merchant);
  const amount = asNumber(raw.amount);
  const orderId = asString(raw.orderId);
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const rawLines = Array.isArray(raw.rawLines) ? raw.rawLines : [];

  const items: SourceItem[] = itemsRaw.map((i) => {
    const r = i as Record<string, unknown>;
    return {
      name: asString(r.name) ?? "",
      qty: asNumber(r.qty ?? r.quantity) ?? 1,
      amount: asNumber(r.amount),
    };
  });

  const chips: SourceChip[] = [];
  if (amount != null) chips.push({ label: "Total", value: fmtInr(amount) });
  if (items.length > 0) chips.push({ label: "Items", value: String(items.length) });
  if (merchant) chips.push({ label: "Merchant", value: merchant });

  const details: SourceDetailRow[] = ([
    merchant ? { label: "Merchant", value: merchant } : null,
    orderId ? { label: "Order ID", value: orderId, mono: true } : null,
    amount != null ? { label: "Total", value: fmtInr(amount) } : null,
    rawLines.length > 0
      ? {
          label: `OCR text (${rawLines.length} lines)`,
          value: rawLines.slice(0, 30).join("\n"),
          block: true,
          mono: true,
        }
      : null,
  ] as Array<SourceDetailRow | null>).filter((r): r is SourceDetailRow => r !== null);

  return {
    icon: ICON_BY_TYPE[sourceType] ?? "🧾",
    title: TITLE_BY_TYPE[sourceType] ?? sourceType,
    subtitle: orderId ?? merchant ?? null,
    chips,
    details,
    items: items.length > 0 ? items : null,
  };
}

function formatGeneric(
  raw: Record<string, unknown>,
  sourceType: string,
): FormattedSource {
  // Catch-all for source types we don't have a tailored formatter for.
  // Renders every top-level key as a detail row.
  const details: SourceDetailRow[] = Object.entries(raw)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      label: k,
      value: typeof v === "object" ? JSON.stringify(v) : String(v),
      mono: true,
      block: typeof v === "object" || (typeof v === "string" && v.length > 80),
    }));

  return {
    icon: ICON_BY_TYPE[sourceType] ?? "📄",
    title: TITLE_BY_TYPE[sourceType] ?? sourceType,
    subtitle: null,
    chips: [],
    details,
    items: null,
  };
}

// ============================================================================
// Public entry point
// ============================================================================

export function formatSource(
  sourceType: string,
  rawJson: Record<string, unknown>,
): FormattedSource {
  switch (sourceType) {
    case "phonepe":
    case "gpay":
      return formatPhonePe(rawJson);
    case "hdfc_savings":
      return formatHdfcSavings(rawJson);
    case "hdfc_cc":
      return formatHdfcCc(rawJson);
    case "swiggy_email":
      return formatEmailReceipt(rawJson, true);
    case "zomato_email":
      return formatEmailReceipt(rawJson, false);
    case "zepto_invoice":
      return formatZeptoInvoice(rawJson);
    case "zepto_ocr":
    case "blinkit_ocr":
    case "instamart_ocr":
      return formatScreenshotOcr(rawJson, sourceType);
    default:
      return formatGeneric(rawJson, sourceType);
  }
}
