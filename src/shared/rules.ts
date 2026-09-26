import type { BoostRule } from "./types";

const WWW_PREFIX = /^www\./i;

// Characters and tokens that could let a value break out of its declaration, start a new
// rule, or make the page fetch something (e.g. `red; } body { display: none`).
const UNSAFE_CSS_VALUE = /[{};<>\\@]|\/\*|url\s*\(|expression\s*\(|image-set\s*\(|image\s*\(/i;
const MAX_CSS_VALUE_LENGTH = 300;

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getSiteKeyFromUrl(url: string): string {
  return new URL(url).hostname.replace(WWW_PREFIX, "").toLowerCase();
}

/**
 * String-level check that a value is safe to interpolate into a CSS declaration. Works in
 * the service worker, which has no `CSS.supports`; the content script additionally checks
 * `CSS.supports` before applying a value.
 */
export function isSafeCssValue(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.length <= MAX_CSS_VALUE_LENGTH &&
    !UNSAFE_CSS_VALUE.test(value)
  );
}

export function isSafeSelector(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 1000 && !/[{};]/.test(value);
}

function optionalCssValue(value: unknown): string | undefined {
  return isSafeCssValue(value) ? value : undefined;
}

/**
 * Validates a rule read from storage. Returns null for anything malformed so a single
 * corrupted entry can't break the popup, the manage page, or the injected stylesheet.
 */
export function normalizeStoredRule(entry: unknown): BoostRule | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.siteKey) ||
    !isSafeSelector(record.selector) ||
    typeof record.label !== "string" ||
    !isNonEmptyString(record.createdAt)
  ) {
    return null;
  }

  const base = {
    id: record.id,
    siteKey: record.siteKey,
    selector: record.selector,
    label: record.label,
    createdAt: record.createdAt,
    pageUrl: typeof record.pageUrl === "string" ? record.pageUrl : `https://${record.siteKey}/`,
    pageTitle: typeof record.pageTitle === "string" ? record.pageTitle : record.siteKey,
  };
  const scope = record.scope === "page" ? "page" : "element";

  // Rules saved before Boost types existed have no `type` and are all removals.
  switch (record.type ?? "remove") {
    case "remove":
      return { ...base, type: "remove" };
    case "recolor": {
      const textColor = optionalCssValue(record.textColor);
      const backgroundColor = optionalCssValue(record.backgroundColor);
      if (!textColor && !backgroundColor) {
        return null;
      }
      return { ...base, type: "recolor", scope, textColor, backgroundColor };
    }
    case "font":
      return isSafeCssValue(record.fontFamily)
        ? { ...base, type: "font", scope, fontFamily: record.fontFamily }
        : null;
    case "text":
      return isNonEmptyString(record.newText)
        ? {
            ...base,
            type: "text",
            originalText: typeof record.originalText === "string" ? record.originalText : "",
            newText: record.newText,
          }
        : null;
    default:
      return null;
  }
}
