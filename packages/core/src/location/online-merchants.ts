/**
 * "Is this an online merchant?" predicate.
 *
 * The location matcher needs to know which counterparties have no physical
 * location — otherwise an Apple subscription that auto-billed at 09:47
 * gets "tagged" with wherever the user happened to be sitting at the
 * time. False positives are visually loud and erode trust fast.
 *
 * Two signals fold into the decision, in order:
 *   1. User override   — `merchant_labels.is_online` was explicitly set.
 *                        Wins absolutely.
 *   2. Regex match     — a curated allowlist of merchants known to be
 *                        purely digital / billing-only (Apple Media Services,
 *                        Google Play, Netflix, payment processors, SaaS).
 *
 * Notable non-entries: Cult.fit, Amazon Prime, MakeMyTrip — these have
 * subscriptions in the hints KB but also have physical / experiential
 * meaning. We'd rather miss tagging some online auto-renewals than mark a
 * gym visit "online".
 *
 * Pure function: takes the user override + counterparty string, returns
 * boolean. Repo layer does the merchant_labels lookup.
 */

/**
 * Pure-digital merchants — auto-renewal subscriptions or pure-API services
 * with no physical presence anywhere the user could be. Conservative on
 * purpose: false positives here silently drop real in-person purchases out
 * of location inference.
 */
const EXPLICIT_ONLINE = [
  // Apple, Google, Microsoft digital storefronts
  /apple.*media|itunes|apple\.com\/bill/i,
  /google\s*play|play\.google|google\s*one|googleone/i,
  /youtube.*premium/i,
  /microsoft.*365|office.*365|m365/i,
  // Streaming / content
  /netflix/i,
  /spotify/i,
  /hotstar|disney\+/i,
  /sonyliv|zee5|jiocinema|jiosaavn/i,
  // SaaS that bills directly
  /notion/i,
  /figma/i,
  /linear/i,
  /adobe/i,
  /openai|chatgpt|anthropic|claude\.ai/i,
  // Payment processors / aggregators — anything coming through these is
  // online by construction
  /razorpay/i,
  /cashfree/i,
  /payu(?:\.in|biz)?/i,
  /billdesk/i,
  /paytm.*(recharge|payments|wallet)/i,
  /stripe\s*charge|stripe\.com/i,
  // Cloud + dev infra
  /aws|amazon.*web.*services/i,
  /cloudflare/i,
  /vercel/i,
  /digitalocean/i,
  /heroku/i,
  /linode/i,
  /github\s*sponsor|github\.com\/sponsors/i,
  // Creator subscriptions
  /substack/i,
  /patreon/i,
];

/**
 * Decide whether a counterparty is online. Returns `true` if location
 * inference should be SKIPPED for this charge.
 *
 * @param counterparty — the txn's counterparty string (raw)
 * @param userOverride — `merchant_labels.is_online`: true/false/null/undefined
 */
export function isOnlineMerchant(
  counterparty: string | null | undefined,
  userOverride?: boolean | null,
): boolean {
  // Explicit user override always wins — even if the KB says otherwise.
  if (userOverride === true) return true;
  if (userOverride === false) return false;

  if (!counterparty) return false;
  const cp = counterparty.trim();
  if (!cp) return false;

  for (const re of EXPLICIT_ONLINE) {
    if (re.test(cp)) return true;
  }
  return false;
}
