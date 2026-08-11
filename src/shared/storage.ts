import type { BoostRule } from "./types";

export const BOOST_STORAGE_KEY = "boostRulesV1";
const STORAGE_KEY = BOOST_STORAGE_KEY;
const LEGACY_STORAGE_KEY = "zapRulesV1";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeLegacyRule(entry: unknown): BoostRule | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.siteKey) ||
    !isNonEmptyString(record.selector) ||
    !isNonEmptyString(record.label) ||
    !isNonEmptyString(record.createdAt) ||
    !isNonEmptyString(record.pageUrl) ||
    !isNonEmptyString(record.pageTitle)
  ) {
    return null;
  }

  return {
    type: "remove",
    id: record.id,
    siteKey: record.siteKey,
    selector: record.selector,
    label: record.label,
    createdAt: record.createdAt,
    pageUrl: record.pageUrl,
    pageTitle: record.pageTitle,
  };
}

async function migrateLegacyRules(): Promise<BoostRule[]> {
  const legacyResult = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
  const legacyRules = legacyResult[LEGACY_STORAGE_KEY];

  if (!Array.isArray(legacyRules) || legacyRules.length === 0) {
    return [];
  }

  const migrated = legacyRules
    .map(normalizeLegacyRule)
    .filter((rule): rule is BoostRule => rule !== null);

  await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
  return migrated;
}

export async function getAllBoostRules(): Promise<BoostRule[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const rules = result[STORAGE_KEY];

  if (Array.isArray(rules)) {
    return rules as BoostRule[];
  }

  return migrateLegacyRules();
}

export async function setAllBoostRules(rules: BoostRule[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: rules });
}
