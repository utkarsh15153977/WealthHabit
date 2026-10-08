const SEPARATOR_PATTERN = /[*|/#_]+/g;
const DASH_PATTERN = /-/g;
const NON_WORD_PATTERN = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_PATTERN = /\s+/g;
const DIGITS_PATTERN = /^\d{3,}$/;
const DIGITS_ONLY_PATTERN = /^\d+$/;
const LONG_DIGIT_RUN_PATTERN = /\d{6,}/;
const REFERENCE_PREFIX_PATTERN =
  /^(?:order|ord|ref|rf|txn|trf|upi|inv|invoice|id|no|num|code|refno)\d+$/;

/**
 * Tokens that only ever describe the payment/reference event, never the
 * merchant itself.
 */
const NOISE_WORDS = new Set([
  'order',
  'ord',
  'ref',
  'rf',
  'txn',
  'trf',
  'upi',
  'pin',
  'inv',
  'invoice',
  'receipt',
  'purchase',
  'payment',
  'card',
  'via',
  'pos',
  'neft',
  'imps',
  'rtgs',
  'chq',
  'cheque',
]);

/** Trailing country suffixes stripped from merchant names ("SWIGGY IN"). */
const TRAILING_COUNTRY_CODES = new Set([
  'in',
  'us',
  'uk',
  'ae',
  'sg',
  'au',
  'ca',
  'jp',
  'de',
  'fr',
  'my',
  'th',
  'ph',
  'ng',
  'za',
]);

function isNoiseToken(token: string): boolean {
  if (NOISE_WORDS.has(token)) {
    return true;
  }
  if (DIGITS_PATTERN.test(token)) {
    return true;
  }
  if (REFERENCE_PREFIX_PATTERN.test(token)) {
    return true;
  }
  if (LONG_DIGIT_RUN_PATTERN.test(token)) {
    return true;
  }
  return false;
}

/**
 * Produces the stable match key used by every rule tier: NFKC-folded,
 * lowercased, separators and punctuation collapsed to single spaces, obvious
 * reference noise ("*ORDER123", "ref998877", bare digits) removed and a
 * trailing country suffix dropped. Pure and deterministic - the stored
 * `Transaction.merchant` value is never rewritten.
 */
export function normalizeMerchant(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  let normalized = value.normalize('NFKC').toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(SEPARATOR_PATTERN, ' ').replace(DASH_PATTERN, ' ');
  normalized = normalized
    .replace(NON_WORD_PATTERN, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
  if (!normalized) {
    return null;
  }

  const tokens: string[] = [];
  let previousWasNoise = false;
  for (const token of normalized.split(' ')) {
    if (!token) {
      continue;
    }
    if (isNoiseToken(token)) {
      previousWasNoise = true;
      continue;
    }
    // Digits directly behind stripped reference noise ("Order #55") are part
    // of the reference, not the merchant name.
    if (previousWasNoise && DIGITS_ONLY_PATTERN.test(token)) {
      continue;
    }
    previousWasNoise = false;
    tokens.push(token);
  }

  if (tokens.length > 1 && TRAILING_COUNTRY_CODES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length === 0) {
    return null;
  }

  return tokens.join(' ');
}

/** Lowercased, punctuation-free text used for description phrase matching. */
export function normalizeDescription(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(NON_WORD_PATTERN, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();

  return normalized ? normalized : null;
}

/** Trims a payment channel/method value without changing its casing. */
export function normalizeChannelToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.normalize('NFKC').trim();
  return normalized ? normalized : null;
}

/**
 * Whitespace-bounded phrase containment over already-normalized text: a phrase
 * only matches on token boundaries, so "power" never matches "powerade".
 */
export function matchesPhrase(normalizedText: string | null, phrase: string): boolean {
  if (!normalizedText || !phrase) {
    return false;
  }
  return ` ${normalizedText} `.includes(` ${phrase} `);
}
