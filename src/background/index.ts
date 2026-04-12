import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  PopupToBackgroundMessage,
  SiteSummary,
  ZapRule,
} from "../shared/types";

const STORAGE_KEY = "zapRulesV1";
const WWW_PREFIX = /^www\./i;

function getMessagePayload<TPayload>(message: unknown): TPayload {
  return (message as { payload: TPayload }).payload;
}

function getSiteKeyFromUrl(url: string): string {
  return new URL(url).hostname.replace(WWW_PREFIX, "").toLowerCase();
}

async function getAllZapRules(): Promise<ZapRule[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const rules = result[STORAGE_KEY];
  return Array.isArray(rules) ? (rules as ZapRule[]) : [];
}

async function setAllZapRules(rules: ZapRule[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: rules });
}

async function addZapRule(rule: ZapRule): Promise<ZapRule> {
  const rules = await getAllZapRules();
  const nextRules = rules.filter(
    (existing) =>
      !(existing.siteKey === rule.siteKey && existing.selector === rule.selector),
  );

  nextRules.unshift(rule);
  await setAllZapRules(nextRules);
  return rule;
}

async function listZapRules(siteKey?: string): Promise<ZapRule[]> {
  const rules = await getAllZapRules();
  return siteKey ? rules.filter((rule) => rule.siteKey === siteKey) : rules;
}

async function removeZapRule(id: string): Promise<boolean> {
  const rules = await getAllZapRules();
  const nextRules = rules.filter((rule) => rule.id !== id);

  if (nextRules.length === rules.length) {
    return false;
  }

  await setAllZapRules(nextRules);
  return true;
}

async function removeSiteZapRules(siteKey: string): Promise<number> {
  const rules = await getAllZapRules();
  const nextRules = rules.filter((rule) => rule.siteKey !== siteKey);
  const removedCount = rules.length - nextRules.length;

  if (removedCount > 0) {
    await setAllZapRules(nextRules);
  }

  return removedCount;
}

async function listSiteSummaries(): Promise<SiteSummary[]> {
  const rules = await getAllZapRules();
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

async function refreshTab(tabId: number | undefined): Promise<void> {
  if (typeof tabId !== "number") {
    return;
  }

  await sendMessageToTab(tabId, { type: "REFRESH_ZAPS" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case "ENTER_ZAP_MODE": {
        const payload = getMessagePayload<{ tabId: number }>(message);
        const success = await sendMessageToTab(payload.tabId, {
          type: "ENTER_ZAP_MODE",
        });
        sendResponse({ success });
        return;
      }
      case "EXIT_ZAP_MODE": {
        const payload = getMessagePayload<{ tabId: number }>(message);
        const success = await sendMessageToTab(payload.tabId, {
          type: "EXIT_ZAP_MODE",
        });
        sendResponse({ success });
        return;
      }
      case "CREATE_ZAP": {
        const payload = getMessagePayload<ContentToBackgroundMessage["payload"]>(message);
        const pageUrl =
          payload.pageUrl || sender.tab?.url || "https://unknown.local/";
        const rule: ZapRule = {
          id: crypto.randomUUID(),
          siteKey: getSiteKeyFromUrl(pageUrl),
          selector: payload.selector,
          label: payload.label,
          createdAt: new Date().toISOString(),
          pageUrl,
          pageTitle: payload.pageTitle || sender.tab?.title || pageUrl,
          strategy: "css-hide",
        };
        const savedRule = await addZapRule(rule);
        sendResponse({ rule: savedRule });
        return;
      }
      case "LIST_ZAPS": {
        const payload = getMessagePayload<PopupToBackgroundMessage["payload"]>(message);
        const siteKey = "siteKey" in payload ? payload.siteKey : undefined;
        const [siteRules, siteSummaries] = await Promise.all([
          listZapRules(siteKey),
          listSiteSummaries(),
        ]);
        sendResponse({ siteRules, siteSummaries });
        return;
      }
      case "RESTORE_ZAP": {
        const payload = getMessagePayload<{ id: string; tabId?: number }>(message);
        const removed = await removeZapRule(payload.id);
        await refreshTab(payload.tabId);
        sendResponse({ removed });
        return;
      }
      case "RESTORE_SITE_ZAPS": {
        const payload = getMessagePayload<{ siteKey: string; tabId?: number }>(message);
        const removedCount = await removeSiteZapRules(payload.siteKey);
        await refreshTab(payload.tabId);
        sendResponse({ removedCount });
        return;
      }
      default:
        sendResponse({ success: false });
    }
  })();

  return true;
});
