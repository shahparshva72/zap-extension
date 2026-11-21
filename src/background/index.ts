import {
  CUSTOM_CSS_UNSAFE_MESSAGE,
  EDITABLE_KEYS,
  getSiteKeyFromUrl,
  isNonEmptyString,
  normalizeStoredRule,
} from "../shared/rules";
import {
  getAllBoostRules,
  getPausedSites,
  migrateLegacyRules,
  setAllBoostRules,
  setPausedSites,
} from "../shared/storage";
import type {
  BackgroundToContentMessage,
  BoostRule,
  CommandResult,
  CreateBoostPayload,
  ImportBoostsPayload,
  ImportBoostsResponse,
  RuntimeMessage,
  SiteSummary,
  UpdateBoostPayload,
  UpdateBoostResponse,
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

// Serializes any storage mutation (rules or the paused-site list) on the same queue.
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = rulesQueue.then(task);
  rulesQueue = run.catch(() => undefined);
  return run;
}

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

/**
 * A site can only be paused while it still has boosts, so after rules are removed any
 * paused site left with none is silently resumed.
 */
function prunePausedSites(): Promise<void> {
  return enqueue(async () => {
    const [rules, paused] = await Promise.all([getAllBoostRules(), getPausedSites()]);
    const live = new Set(rules.map((rule) => rule.siteKey));
    const next = paused.filter((siteKey) => live.has(siteKey));
    if (next.length !== paused.length) {
      await setPausedSites(next);
    }
  });
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
  return normalizeStoredRule(
    {
      ...payload,
      id: crypto.randomUUID(),
      siteKey,
    createdAt: new Date().toISOString(),
      pageUrl,
      pageTitle,
    },
    { enforceLimits: true },
  );
}

function addBoostRule(rule: BoostRule): Promise<BoostRule> {
  return updateRules((rules) => ({ rules: upsertRule(rules, rule), result: rule }));
}

async function listBoostRules(siteKey?: string): Promise<BoostRule[]> {
  const rules = await getAllBoostRules();
  return siteKey ? rules.filter((rule) => rule.siteKey === siteKey) : rules;
}

/**
 * Edits only the value fields of a saved boost. Values REPLACE the old set rather than
 * merge, so a key the editor leaves out means "turned off" (e.g. one color of a
 * recolor). The candidate is re-validated like any stored rule, and the rule keeps its
 * array position because order is meaningful for CSS precedence.
 */
function updateBoostRule(payload: UpdateBoostPayload): Promise<UpdateBoostResponse> {
  return updateRules((rules): { rules: BoostRule[] | null; result: UpdateBoostResponse } => {
    const index = rules.findIndex((rule) => rule.id === payload.id);
    if (index === -1) {
      return { rules: null, result: { success: false, error: "That boost no longer exists." } };
    }

    const existing = rules[index];
    const editable = EDITABLE_KEYS[existing.type];
    if (editable.length === 0) {
      return { rules: null, result: { success: false, error: "Zaps have nothing to edit." } };
    }

    const values = typeof payload.values === "object" && payload.values !== null ? payload.values : {};
    const candidate: Record<string, unknown> = {
      ...existing,
      originalText: existing.type === "text" ? existing.originalText : undefined,
    };
    for (const key of editable) {
      candidate[key] = values[key];
    }

    const rule = normalizeStoredRule(candidate, { enforceLimits: true });
    if (!rule) {
      return {
        rules: null,
        result: {
          success: false,
          error:
            existing.type === "css"
              ? CUSTOM_CSS_UNSAFE_MESSAGE
              : "That boost has an invalid value and was not saved.",
        },
      };
    }

    const nextRules = [...rules];
    nextRules[index] = rule;
    return { rules: nextRules, result: { success: true, rule } };
  });
}

function setBoostEnabled(id: string, enabled: boolean): Promise<CommandResult> {
  return updateRules((rules): { rules: BoostRule[] | null; result: CommandResult } => {
    const index = rules.findIndex((rule) => rule.id === id);
    if (index === -1) {
      return { rules: null, result: { success: false, error: "That boost no longer exists." } };
    }

    const next = { ...rules[index] };
    if (enabled) {
      delete next.disabled;
    } else {
      next.disabled = true;
    }
    // In-place so the rule's position (CSS precedence order) is kept.
    const nextRules = [...rules];
    nextRules[index] = next;
    return { rules: nextRules, result: { success: true } };
  });
}

function setSitePaused(siteKey: string, paused: boolean): Promise<CommandResult> {
  return enqueue(async () => {
    const [rules, pausedSites] = await Promise.all([getAllBoostRules(), getPausedSites()]);
    if (paused && !rules.some((rule) => rule.siteKey === siteKey)) {
      return { success: false, error: "There are no boosts on this site to pause." };
    }

    const next = paused
      ? [...new Set([...pausedSites, siteKey])]
      : pausedSites.filter((site) => site !== siteKey);
    await setPausedSites(next);
    return { success: true };
  });
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
      if (!isNonEmptyString(entry?.siteKey) || entry.siteKey.length > 253) {
        skippedCount += 1;
        continue;
      }

      const siteKey = entry.siteKey.trim().toLowerCase();
      const createdAt =
        isNonEmptyString(entry.createdAt) && !Number.isNaN(Date.parse(entry.createdAt))
          ? entry.createdAt
          : new Date().toISOString();
      const rule = normalizeStoredRule(
        {
          ...entry,
          type: isNonEmptyString(entry.type) ? entry.type : "remove",
          id: crypto.randomUUID(),
          siteKey,
          createdAt,
          pageUrl: isNonEmptyString(entry.pageUrl) ? entry.pageUrl : `https://${siteKey}/`,
          pageTitle: isNonEmptyString(entry.pageTitle) ? entry.pageTitle : siteKey,
        },
        { enforceLimits: true },
      );

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
): Promise<CommandResult | null> {
  return chrome.tabs.sendMessage(tabId, message).then(
    (response) => (response as CommandResult | undefined) ?? { success: false },
    () => null,
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

  if ((await sendMessageToTab(tabId, { type: "PING" }))?.success) {
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
    if ((await sendMessageToTab(tabId, { type: "PING" }))?.success) {
      return true;
    }

    await delay(80);
  }

  return false;
}

async function sendTabCommand(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<CommandResult | null> {
  const ready = await ensureContentScriptReady(tabId);
  if (!ready) {
    return null;
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
      const response = await sendTabCommand(message.payload.tabId, { type: "ENTER_BOOST_MODE" });
      // The content script may supply a specific reason (e.g. the site is paused).
      return {
        success: response?.success === true,
        error:
          response?.success === true
            ? undefined
            : (response?.error ?? "Boost mode could not be started on this tab."),
      };
    }
    case "EXIT_BOOST_MODE": {
      const response = await sendTabCommand(message.payload.tabId, { type: "EXIT_BOOST_MODE" });
      return {
        success: response?.success === true,
        error:
          response?.success === true ? undefined : "Boost mode could not be updated on this tab.",
      };
    }
    case "CREATE_BOOST": {
      const { payload } = message;
      // Trust the tab's real URL over whatever the page reported.
      const pageUrl = sender.tab?.url || payload.pageUrl;
      const pageTitle = sender.tab?.title || payload.pageTitle || pageUrl;
      const rule = buildRuleFromPayload(payload, getSiteKeyFromUrl(pageUrl), pageUrl, pageTitle);
      if (!rule) {
        return {
          success: false,
          error:
            payload.type === "css"
              ? CUSTOM_CSS_UNSAFE_MESSAGE
              : "That boost has an invalid value and was not saved.",
        };
      }
      return { success: true, rule: await addBoostRule(rule) };
    }
    case "LIST_BOOSTS": {
      const [siteRules, siteSummaries, pausedSites] = await Promise.all([
        listBoostRules(message.payload.siteKey),
        listSiteSummaries(),
        getPausedSites(),
      ]);
      return { success: true, siteRules, siteSummaries, pausedSites };
    }
    case "RESTORE_BOOST": {
      const removed = await removeBoostRule(message.payload.id);
      await prunePausedSites();
      await refreshTab(message.payload.tabId);
      return { success: true, removed };
    }
    case "RESTORE_SITE_BOOSTS": {
      const removedCount = await removeSiteBoostRules(message.payload.siteKey);
      await prunePausedSites();
      await refreshTab(message.payload.tabId);
      return { success: true, removedCount };
    }
    case "RESTORE_ALL_BOOSTS": {
      const removedCount = await removeAllBoostRules();
      await prunePausedSites();
      return { success: true, removedCount };
    }
    case "IMPORT_BOOSTS":
      return importBoostRules(message.payload.rules);
    case "UPDATE_BOOST": {
      const result = await updateBoostRule(message.payload);
      if (result.success) {
        await refreshTab(message.payload.tabId);
      }
      return result;
    }
    case "SET_BOOST_ENABLED": {
      const result = await setBoostEnabled(message.payload.id, message.payload.enabled);
      if (result.success) {
        await refreshTab(message.payload.tabId);
      }
      return result;
    }
    case "SET_SITE_PAUSED": {
      const result = await setSitePaused(message.payload.siteKey, message.payload.paused);
      if (result.success) {
        await refreshTab(message.payload.tabId);
      }
      return result;
    }
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
