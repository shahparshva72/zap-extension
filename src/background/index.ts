import { getAllBoostRules, setAllBoostRules } from "../shared/storage";
import type {
  BackgroundToContentMessage,
  BoostRule,
  ContentToBackgroundMessage,
  CreateBoostPayload,
  ImportBoostsPayload,
  ImportBoostsResponse,
  ImportableBoostRule,
  PopupToBackgroundMessage,
  SiteSummary,
} from "../shared/types";

const WWW_PREFIX = /^www\./i;

function logWarning(message: string, error?: unknown): void {
  console.warn(`[Zap] ${message}`, error);
}

function getMessagePayload<TPayload>(message: unknown): TPayload {
  return (message as { payload: TPayload }).payload;
}

function getSiteKeyFromUrl(url: string): string {
  return new URL(url).hostname.replace(WWW_PREFIX, "").toLowerCase();
}

function ruleDedupeKey(siteKey: string, selector: string, type: string): string {
  return `${siteKey}|${selector}|${type}`;
}

function buildRuleFromPayload(
  payload: CreateBoostPayload,
  siteKey: string,
  pageUrl: string,
  pageTitle: string,
): BoostRule {
  const base = {
    id: crypto.randomUUID(),
    siteKey,
    selector: payload.selector,
    label: payload.label,
    createdAt: new Date().toISOString(),
    pageUrl,
    pageTitle,
  };

  switch (payload.type) {
    case "remove":
      return { ...base, type: "remove" };
    case "recolor":
      return {
        ...base,
        type: "recolor",
        scope: payload.scope,
        textColor: payload.textColor,
        backgroundColor: payload.backgroundColor,
      };
    case "font":
      return { ...base, type: "font", scope: payload.scope, fontFamily: payload.fontFamily };
    case "text":
      return {
        ...base,
        type: "text",
        originalText: payload.originalText,
        newText: payload.newText,
      };
  }
}

async function addBoostRule(rule: BoostRule): Promise<BoostRule> {
  const rules = await getAllBoostRules();
  const nextRules = rules.filter(
    (existing) =>
      ruleDedupeKey(existing.siteKey, existing.selector, existing.type) !==
      ruleDedupeKey(rule.siteKey, rule.selector, rule.type),
  );

  nextRules.unshift(rule);
  await setAllBoostRules(nextRules);
  return rule;
}

async function listBoostRules(siteKey?: string): Promise<BoostRule[]> {
  const rules = await getAllBoostRules();
  return siteKey ? rules.filter((rule) => rule.siteKey === siteKey) : rules;
}

async function removeBoostRule(id: string): Promise<boolean> {
  const rules = await getAllBoostRules();
  const nextRules = rules.filter((rule) => rule.id !== id);

  if (nextRules.length === rules.length) {
    return false;
  }

  await setAllBoostRules(nextRules);
  return true;
}

async function removeSiteBoostRules(siteKey: string): Promise<number> {
  const rules = await getAllBoostRules();
  const nextRules = rules.filter((rule) => rule.siteKey !== siteKey);
  const removedCount = rules.length - nextRules.length;

  if (removedCount > 0) {
    await setAllBoostRules(nextRules);
  }

  return removedCount;
}

async function removeAllBoostRules(): Promise<number> {
  const rules = await getAllBoostRules();
  if (rules.length > 0) {
    await setAllBoostRules([]);
  }

  return rules.length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function normalizeImportableRule(
  entry: ImportableBoostRule,
): DistributiveOmit<BoostRule, "id" | "siteKey" | "createdAt" | "pageUrl" | "pageTitle"> | null {
  const type = isNonEmptyString(entry.type) ? entry.type : "remove";

  if (!isNonEmptyString(entry.selector) || !isNonEmptyString(entry.label)) {
    return null;
  }

  switch (type) {
    case "remove":
      return { type: "remove", selector: entry.selector, label: entry.label };
    case "recolor": {
      if (!isNonEmptyString(entry.textColor) && !isNonEmptyString(entry.backgroundColor)) {
        return null;
      }
      return {
        type: "recolor",
        selector: entry.selector,
        label: entry.label,
        scope: entry.scope === "page" ? "page" : "element",
        textColor: isNonEmptyString(entry.textColor) ? entry.textColor : undefined,
        backgroundColor: isNonEmptyString(entry.backgroundColor)
          ? entry.backgroundColor
          : undefined,
      };
    }
    case "font": {
      if (!isNonEmptyString(entry.fontFamily)) {
        return null;
      }
      return {
        type: "font",
        selector: entry.selector,
        label: entry.label,
        scope: entry.scope === "page" ? "page" : "element",
        fontFamily: entry.fontFamily,
      };
    }
    case "text": {
      if (!isNonEmptyString(entry.newText)) {
        return null;
      }
      return {
        type: "text",
        selector: entry.selector,
        label: entry.label,
        originalText: entry.originalText ?? "",
        newText: entry.newText,
      };
    }
    default:
      return null;
  }
}

async function importBoostRules(entries: ImportBoostsPayload["rules"]): Promise<ImportBoostsResponse> {
  let addedCount = 0;
  let skippedCount = 0;

  for (const entry of entries) {
    if (!isNonEmptyString(entry?.siteKey)) {
      skippedCount += 1;
      continue;
    }

    const normalized = normalizeImportableRule(entry);
    if (!normalized) {
      skippedCount += 1;
      continue;
    }

    const siteKey = entry.siteKey.trim().toLowerCase();
    const createdAt =
      isNonEmptyString(entry.createdAt) && !Number.isNaN(Date.parse(entry.createdAt))
        ? entry.createdAt
        : new Date().toISOString();

    await addBoostRule({
      ...normalized,
      id: crypto.randomUUID(),
      siteKey,
      createdAt,
      pageUrl: isNonEmptyString(entry.pageUrl) ? entry.pageUrl : `https://${siteKey}/`,
      pageTitle: isNonEmptyString(entry.pageTitle) ? entry.pageTitle : siteKey,
    } as BoostRule);
    addedCount += 1;
  }

  return { addedCount, skippedCount };
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
      switch (message.type) {
        case "ENTER_BOOST_MODE": {
          const payload = getMessagePayload<{ tabId: number }>(message);
          const success = await sendTabCommand(payload.tabId, {
            type: "ENTER_BOOST_MODE",
          });
          sendResponse({
            success,
            error: success ? undefined : "Boost mode could not be started on this tab.",
          });
          return;
        }
        case "EXIT_BOOST_MODE": {
          const payload = getMessagePayload<{ tabId: number }>(message);
          const success = await sendTabCommand(payload.tabId, {
            type: "EXIT_BOOST_MODE",
          });
          sendResponse({
            success,
            error: success ? undefined : "Boost mode could not be updated on this tab.",
          });
          return;
        }
      case "CREATE_BOOST": {
        const payload = getMessagePayload<ContentToBackgroundMessage["payload"]>(message);
        const pageUrl =
          payload.pageUrl || sender.tab?.url || "https://unknown.local/";
        const siteKey = getSiteKeyFromUrl(pageUrl);
        const pageTitle = payload.pageTitle || sender.tab?.title || pageUrl;
        const rule = buildRuleFromPayload(payload, siteKey, pageUrl, pageTitle);
        const savedRule = await addBoostRule(rule);
        sendResponse({ rule: savedRule });
        return;
      }
      case "LIST_BOOSTS": {
        const payload = getMessagePayload<PopupToBackgroundMessage["payload"]>(message);
        const siteKey = "siteKey" in payload ? payload.siteKey : undefined;
        const [siteRules, siteSummaries] = await Promise.all([
          listBoostRules(siteKey),
          listSiteSummaries(),
        ]);
        sendResponse({ siteRules, siteSummaries });
        return;
      }
      case "RESTORE_BOOST": {
        const payload = getMessagePayload<{ id: string; tabId?: number }>(message);
        const removed = await removeBoostRule(payload.id);
        await refreshTab(payload.tabId);
        sendResponse({ removed });
        return;
      }
      case "RESTORE_SITE_BOOSTS": {
        const payload = getMessagePayload<{ siteKey: string; tabId?: number }>(message);
        const removedCount = await removeSiteBoostRules(payload.siteKey);
        await refreshTab(payload.tabId);
        sendResponse({ removedCount });
        return;
      }
      case "RESTORE_ALL_BOOSTS": {
        const removedCount = await removeAllBoostRules();
        sendResponse({ removedCount });
        return;
      }
      case "IMPORT_BOOSTS": {
        const payload = getMessagePayload<ImportBoostsPayload>(message);
        const result = await importBoostRules(payload.rules);
        sendResponse(result);
        return;
      }
      default:
        sendResponse({ success: false });
    }
  })();

  return true;
});
