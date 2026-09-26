import { getSiteKeyFromUrl, isNonEmptyString, normalizeStoredRule } from "../shared/rules";
import { getAllBoostRules, migrateLegacyRules, setAllBoostRules } from "../shared/storage";
import type {
  BackgroundToContentMessage,
  BoostRule,
  CreateBoostPayload,
  ImportBoostsPayload,
  ImportBoostsResponse,
  RuntimeMessage,
  SiteSummary,
} from "../shared/types";

function logWarning(message: string, error?: unknown): void {
  console.warn(`[Zap] ${message}`, error);
}

function ruleDedupeKey(rule: Pick<BoostRule, "siteKey" | "selector" | "type">): string {
  return `${rule.siteKey}|${rule.selector}|${rule.type}`;
}

// Every read-modify-write of the rule list goes through this queue. Without it, two
// overlapping writes (a quick double zap, or a zap during an import) each read the same
// list and the second write silently drops the first one's change.
let rulesQueue: Promise<unknown> = Promise.resolve();

function updateRules<T>(
  mutate: (rules: BoostRule[]) => { rules: BoostRule[] | null; result: T },
): Promise<T> {
  const run = rulesQueue.then(async () => {
    const { rules, result } = mutate(await getAllBoostRules());
    if (rules) {
      await setAllBoostRules(rules);
    }
    return result;
  });
  rulesQueue = run.catch(() => undefined);
  return run;
}

function upsertRule(rules: BoostRule[], rule: BoostRule): BoostRule[] {
  const key = ruleDedupeKey(rule);
  return [rule, ...rules.filter((existing) => ruleDedupeKey(existing) !== key)];
}

function buildRuleFromPayload(
  payload: CreateBoostPayload,
  siteKey: string,
  pageUrl: string,
  pageTitle: string,
): BoostRule | null {
  // Run the payload through the same validation as stored rules so an unsafe color or
  // font value is rejected before it is ever saved.
  return normalizeStoredRule({
    ...payload,
    id: crypto.randomUUID(),
    siteKey,
    createdAt: new Date().toISOString(),
    pageUrl,
    pageTitle,
  });
}

function addBoostRule(rule: BoostRule): Promise<BoostRule> {
  return updateRules((rules) => ({ rules: upsertRule(rules, rule), result: rule }));
}

async function listBoostRules(siteKey?: string): Promise<BoostRule[]> {
  const rules = await getAllBoostRules();
  return siteKey ? rules.filter((rule) => rule.siteKey === siteKey) : rules;
}

function removeBoostRule(id: string): Promise<boolean> {
  return updateRules((rules) => {
    const nextRules = rules.filter((rule) => rule.id !== id);
    const removed = nextRules.length !== rules.length;
    return { rules: removed ? nextRules : null, result: removed };
  });
}

function removeSiteBoostRules(siteKey: string): Promise<number> {
  return updateRules((rules) => {
    const nextRules = rules.filter((rule) => rule.siteKey !== siteKey);
    const removedCount = rules.length - nextRules.length;
    return { rules: removedCount > 0 ? nextRules : null, result: removedCount };
  });
}

function removeAllBoostRules(): Promise<number> {
  return updateRules((rules) => ({
    rules: rules.length > 0 ? [] : null,
    result: rules.length,
  }));
}

function importBoostRules(entries: ImportBoostsPayload["rules"]): Promise<ImportBoostsResponse> {
  return updateRules((rules) => {
    let nextRules = rules;
    let addedCount = 0;
    let skippedCount = 0;

    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!isNonEmptyString(entry?.siteKey)) {
        skippedCount += 1;
        continue;
      }

      const siteKey = entry.siteKey.trim().toLowerCase();
      const createdAt =
        isNonEmptyString(entry.createdAt) && !Number.isNaN(Date.parse(entry.createdAt))
          ? entry.createdAt
          : new Date().toISOString();
      const rule = normalizeStoredRule({
        ...entry,
        type: isNonEmptyString(entry.type) ? entry.type : "remove",
        id: crypto.randomUUID(),
        siteKey,
        createdAt,
        pageUrl: isNonEmptyString(entry.pageUrl) ? entry.pageUrl : `https://${siteKey}/`,
        pageTitle: isNonEmptyString(entry.pageTitle) ? entry.pageTitle : siteKey,
      });

      if (!rule) {
        skippedCount += 1;
        continue;
      }

      nextRules = upsertRule(nextRules, rule);
      addedCount += 1;
    }

    return {
      rules: addedCount > 0 ? nextRules : null,
      result: { success: true, addedCount, skippedCount },
    };
  });
}

async function listSiteSummaries(): Promise<SiteSummary[]> {
  const rules = await getAllBoostRules();
  const bySite = new Map<string, SiteSummary>();

  for (const rule of rules) {
    const existing = bySite.get(rule.siteKey);
    if (!existing) {
      bySite.set(rule.siteKey, {
        siteKey: rule.siteKey,
        count: 1,
        latestCreatedAt: rule.createdAt,
      });
      continue;
    }

    existing.count += 1;
    if (existing.latestCreatedAt < rule.createdAt) {
      existing.latestCreatedAt = rule.createdAt;
    }
  }

  return Array.from(bySite.values()).sort((left, right) =>
    right.latestCreatedAt.localeCompare(left.latestCreatedAt),
  );
}

function sendMessageToTab(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<boolean> {
  return chrome.tabs.sendMessage(tabId, message).then(
    () => true,
    () => false,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function ensureContentScriptReady(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    logWarning("Skipped content script initialization on an unsupported tab.", tab?.url);
    return false;
  }

  if (await sendMessageToTab(tabId, { type: "PING" })) {
    return true;
  }

  const injected = await chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["assets/content.js"],
    })
    .then(() => true)
    .catch((error) => {
      logWarning("Failed to inject the content script.", error);
      return false;
    });

  if (!injected) {
    return false;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await sendMessageToTab(tabId, { type: "PING" })) {
      return true;
    }

    await delay(80);
  }

  return false;
}

async function sendTabCommand(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<boolean> {
  const ready = await ensureContentScriptReady(tabId);
  if (!ready) {
    return false;
  }

  return sendMessageToTab(tabId, message);
}

async function refreshTab(tabId: number | undefined): Promise<void> {
  if (typeof tabId !== "number") {
    return;
  }

  await sendTabCommand(tabId, { type: "REFRESH_BOOSTS" });
}

async function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<object> {
  switch (message.type) {
    case "ENTER_BOOST_MODE": {
      const success = await sendTabCommand(message.payload.tabId, { type: "ENTER_BOOST_MODE" });
      return {
        success,
        error: success ? undefined : "Boost mode could not be started on this tab.",
      };
    }
    case "EXIT_BOOST_MODE": {
      const success = await sendTabCommand(message.payload.tabId, { type: "EXIT_BOOST_MODE" });
      return {
        success,
        error: success ? undefined : "Boost mode could not be updated on this tab.",
      };
    }
    case "CREATE_BOOST": {
      const { payload } = message;
      // Trust the tab's real URL over whatever the page reported.
      const pageUrl = sender.tab?.url || payload.pageUrl;
      const pageTitle = sender.tab?.title || payload.pageTitle || pageUrl;
      const rule = buildRuleFromPayload(payload, getSiteKeyFromUrl(pageUrl), pageUrl, pageTitle);
      if (!rule) {
        return { success: false, error: "That boost has an invalid value and was not saved." };
      }
      return { success: true, rule: await addBoostRule(rule) };
    }
    case "LIST_BOOSTS": {
      const [siteRules, siteSummaries] = await Promise.all([
        listBoostRules(message.payload.siteKey),
        listSiteSummaries(),
      ]);
      return { success: true, siteRules, siteSummaries };
    }
    case "RESTORE_BOOST": {
      const removed = await removeBoostRule(message.payload.id);
      await refreshTab(message.payload.tabId);
      return { success: true, removed };
    }
    case "RESTORE_SITE_BOOSTS": {
      const removedCount = await removeSiteBoostRules(message.payload.siteKey);
      await refreshTab(message.payload.tabId);
      return { success: true, removedCount };
    }
    case "RESTORE_ALL_BOOSTS":
      return { success: true, removedCount: await removeAllBoostRules() };
    case "IMPORT_BOOSTS":
      return importBoostRules(message.payload.rules);
    default:
      return { success: false, error: "Unknown message." };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  rulesQueue = rulesQueue
    .then(migrateLegacyRules)
    .catch((error) => logWarning("Legacy rule migration failed.", error));
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, (error: unknown) => {
    // Always reply, otherwise the caller waits until the message port closes.
    logWarning(`Handling ${message?.type} failed.`, error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : "The extension hit an unexpected error.",
    });
  });

  return true;
});
