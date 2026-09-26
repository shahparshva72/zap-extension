import { normalizeStoredRule } from "./rules";
import type { BoostRule } from "./types";

export const BOOST_STORAGE_KEY = "boostRulesV1";
const LEGACY_STORAGE_KEY = "zapRulesV1";

function normalizeRules(entries: unknown[]): BoostRule[] {
  return entries.map(normalizeStoredRule).filter((rule): rule is BoostRule => rule !== null);
}

/**
 * Reads every saved rule. Read-only, so it is safe to call from any context; only the
 * background writes to storage, which keeps all writes behind its single queue.
 */
export async function getAllBoostRules(): Promise<BoostRule[]> {
  const result = await chrome.storage.local.get([BOOST_STORAGE_KEY, LEGACY_STORAGE_KEY]);
  const rules = result[BOOST_STORAGE_KEY];
  if (Array.isArray(rules)) {
    return normalizeRules(rules);
  }

  const legacyRules = result[LEGACY_STORAGE_KEY];
  return Array.isArray(legacyRules) ? normalizeRules(legacyRules) : [];
}

export async function setAllBoostRules(rules: BoostRule[]): Promise<void> {
  await chrome.storage.local.set({ [BOOST_STORAGE_KEY]: rules });
  await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
}

/** Moves pre-Boost `zapRulesV1` rules to the current key. Background only. */
export async function migrateLegacyRules(): Promise<void> {
  const result = await chrome.storage.local.get([BOOST_STORAGE_KEY, LEGACY_STORAGE_KEY]);
  if (!Array.isArray(result[BOOST_STORAGE_KEY]) && Array.isArray(result[LEGACY_STORAGE_KEY])) {
    await setAllBoostRules(normalizeRules(result[LEGACY_STORAGE_KEY]));
  }
}
