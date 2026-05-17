export { fetchEmailsFrom } from "./fetcher";
export {
  findEmailsForTransaction,
  type TxnSearchInput,
  type EmailMatch,
  type FindEmailsOptions,
} from "./find-emails";
export {
  DEFAULT_EXTRACTORS,
  KNOWN_MERCHANT_SENDERS,
  hdfcAlertExtractor,
  swiggyExtractor,
  zomatoExtractor,
  type ExtractedInfo,
  type MerchantExtractor,
} from "./extractors";
export { loadEmailAccountsFromEnv } from "./env-accounts";
export type { FetchedEmail, FetchOptions, ImapAuth } from "./types";
