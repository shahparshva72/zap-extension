import { normalizeStyleValues } from "./style";
import type { BoostRule, BoostType } from "./types";

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

const MAX_CUSTOM_CSS_LENGTH = 20000;

// Custom CSS is a whole stylesheet, so `{}`, `;`, `@media` and friends must stay legal.
// What's banned instead is anything that could make a page fetch a resource or break
// out of the <style> element: url()/image-set()/etc. are data-exfiltration vectors
// (attribute selectors + url() can leak page data), @import loads external sheets,
// backslashes enable escape tricks like `u\72l(`, and `</style` would end the element
// early. Zap promises zero network requests, and imported JSON is untrusted.
const UNSAFE_CUSTOM_CSS =
  /\\|@import|url\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|expression\s*\(|<\/style/i;

export function isSafeCustomCss(value: unknown): value is string {
  return (
    isNonEmptyString(value) && value.length <= MAX_CUSTOM_CSS_LENGTH && !UNSAFE_CUSTOM_CSS.test(value)
  );
}

export const CUSTOM_CSS_UNSAFE_MESSAGE =
  "Custom CSS can't use url(), @import, or backslashes, so pages never load anything external.";

// The rule fields a user may edit after saving. Identity fields (selector, scope,
// site, label, type) are never editable; a remove rule has no values at all.
export const EDITABLE_KEYS: Record<BoostType, readonly string[]> = {
  remove: [],
  recolor: ["textColor", "backgroundColor"],
  font: ["fontFamily"],
  text: ["newText"],
  style: [
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "padding",
    "borderRadius",
    "opacity",
    "textAlign",
  ],
  css: ["css"],
};

export function isEditableBoost(rule: BoostRule): boolean {
  return EDITABLE_KEYS[rule.type].length > 0;
}

/**
 * True when every string, bracket and escape in a selector is closed. `querySelector`
 * accepts `:not(a` or `[title="x` because the parser closes them at the end of input, but
 * inside a stylesheet the open bracket, string or comment keeps going and swallows every
 * rule after it.
 */
function isBalancedSelector(selector: string): boolean {
  const closers: string[] = [];
  let quote = "";

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === "\\") {
      if (index === selector.length - 1) {
        return false;
      }
      index += 1;
    } else if (quote) {
      if (char === "\n") {
        return false;
      }
      if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      closers.push(char === "(" ? ")" : "]");
    } else if (char === ")" || char === "]") {
      if (closers.pop() !== char) {
        return false;
      }
    } else if (char === "/" && selector[index + 1] === "*") {
      return false;
    }
  }

  return !quote && closers.length === 0;
}

export function isSafeSelector(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.length <= 1000 &&
    !/[{};]/.test(value) &&
    isBalancedSelector(value)
  );
}

const MAX_LABEL_LENGTH = 200;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2000;
const MAX_TEXT_LENGTH = 10000;

function optionalCssValue(value: unknown): string | undefined {
  return isSafeCssValue(value) ? value : undefined;
}

/**
 * Validates a rule read from storage. Returns null for anything malformed so a single
 * corrupted entry can't break the popup, the manage page, or the injected stylesheet.
 */
export function normalizeStoredRule(
  entry: unknown,
  { enforceLimits = false }: { enforceLimits?: boolean } = {},
): BoostRule | null {
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
    label: record.label.slice(0, MAX_LABEL_LENGTH),
    createdAt: record.createdAt,
    pageUrl: (typeof record.pageUrl === "string"
      ? record.pageUrl
      : `https://${record.siteKey}/`
    ).slice(0, MAX_URL_LENGTH),
    pageTitle: (typeof record.pageTitle === "string" ? record.pageTitle : record.siteKey).slice(
      0,
      MAX_TITLE_LENGTH,
    ),
    ...(record.disabled === true ? { disabled: true } : {}),
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
    case "text": {
      const originalText = typeof record.originalText === "string" ? record.originalText : "";
      // Only new writes are held to the limit, so a long text boost saved by an earlier
      // version keeps working.
      if (
        enforceLimits &&
        isNonEmptyString(record.newText) &&
        (record.newText.length > MAX_TEXT_LENGTH || originalText.length > MAX_TEXT_LENGTH)
      ) {
        return null;
      }
      return isNonEmptyString(record.newText)
        ? {
            ...base,
            type: "text",
            originalText,
            newText: record.newText,
          }
        : null;
    }
    case "style": {
      const values = normalizeStyleValues(record, scope);
      return values ? { ...base, type: "style", scope, ...values } : null;
    }
    case "css":
      return isSafeCustomCss(record.css) ? { ...base, type: "css", css: record.css } : null;
    default:
      return null;
  }
}
