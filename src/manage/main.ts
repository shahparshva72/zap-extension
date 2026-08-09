import "./styles.css";

import type {
  ImportZapsResponse,
  ImportableZapRule,
  ListZapsResponse,
  RestoreAllZapsResponse,
  ZapRule,
} from "../shared/types";

const STORAGE_KEY = "zapRulesV1";
const ZAP_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

let allRules: ZapRule[] = [];
let searchQuery = "";
let isBusy = false;

async function sendRuntimeMessage<TResponse>(message: object): Promise<TResponse> {
  return chrome.runtime.sendMessage(message) as Promise<TResponse>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function setStatusMessage(message: string, tone: "default" | "error" = "default"): void {
  const status = document.getElementById("status-message");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.tone = tone;
}

function setBusy(next: boolean): void {
  isBusy = next;
  syncControlAvailability();
}

function syncControlAvailability(): void {
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = isBusy;
  });

  const search = document.getElementById("search-input") as HTMLInputElement | null;
  if (search) {
    search.disabled = isBusy;
  }

  if (isBusy) {
    return;
  }

  const restoreEverything = document.getElementById(
    "restore-everything",
  ) as HTMLButtonElement | null;
  if (restoreEverything) {
    restoreEverything.disabled = allRules.length === 0;
  }

  const exportButton = document.getElementById("export-button") as HTMLButtonElement | null;
  if (exportButton) {
    exportButton.disabled = allRules.length === 0;
  }
}

function matchesQuery(rule: ZapRule, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = `${rule.siteKey} ${rule.label} ${rule.selector}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function groupBySite(rules: ZapRule[]): Map<string, ZapRule[]> {
  const groups = new Map<string, ZapRule[]>();

  for (const rule of rules) {
    const bucket = groups.get(rule.siteKey);
    if (bucket) {
      bucket.push(rule);
    } else {
      groups.set(rule.siteKey, [rule]);
    }
  }

  return groups;
}

function createRuleRowMarkup(rule: ZapRule): string {
  return `
    <li class="row">
      <div class="row-copy">
        <p class="row-label">${escapeHtml(rule.label)}</p>
        <p class="row-meta">${formatDate(rule.createdAt)} · <code>${escapeHtml(rule.selector)}</code></p>
      </div>
      <button class="ghost-button" type="button" data-restore-id="${rule.id}">Restore</button>
    </li>
  `;
}

function createSiteGroupMarkup(siteKey: string, rules: ZapRule[]): string {
  return `
    <section class="site-group">
      <div class="section-head">
        <span class="section-title">${escapeHtml(siteKey)} <span class="count">${rules.length}</span></span>
        <button class="text-button" type="button" data-restore-site="${escapeHtml(siteKey)}">Restore all</button>
      </div>
      <ul class="row-list">${rules.map(createRuleRowMarkup).join("")}</ul>
    </section>
  `;
}

function renderList(): void {
  const list = document.getElementById("rule-groups");
  if (!list) {
    return;
  }

  const totalCount = document.getElementById("total-count");
  if (totalCount) {
    totalCount.textContent = pluralize(allRules.length, "saved");
  }

  if (allRules.length === 0) {
    list.innerHTML = `<p class="empty">No zaps saved anywhere yet.</p>`;
    syncControlAvailability();
    return;
  }

  const filtered = allRules.filter((rule) => matchesQuery(rule, searchQuery));
  if (filtered.length === 0) {
    list.innerHTML = `<p class="empty">Nothing matches &ldquo;${escapeHtml(searchQuery)}&rdquo;.</p>`;
    syncControlAvailability();
    return;
  }

  const groups = groupBySite(filtered);
  const sortedSiteKeys = Array.from(groups.keys()).sort((left, right) => left.localeCompare(right));
  list.innerHTML = sortedSiteKeys
    .map((siteKey) => createSiteGroupMarkup(siteKey, groups.get(siteKey) ?? []))
    .join("");

  attachRowHandlers();
  syncControlAvailability();
}

function attachRowHandlers(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-restore-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.restoreId;
      if (!id) {
        return;
      }

      setBusy(true);
      setStatusMessage("Restoring…");
      try {
        await sendRuntimeMessage({ type: "RESTORE_ZAP", payload: { id } });
        await loadRules();
        setStatusMessage("Restored.");
      } finally {
        setBusy(false);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-restore-site]").forEach((button) => {
    button.addEventListener("click", async () => {
      const siteKey = button.dataset.restoreSite;
      if (!siteKey) {
        return;
      }

      setBusy(true);
      setStatusMessage(`Restoring everything for ${siteKey}…`);
      try {
        await sendRuntimeMessage({ type: "RESTORE_SITE_ZAPS", payload: { siteKey } });
        await loadRules();
        setStatusMessage(`Restored everything for ${siteKey}.`);
      } finally {
        setBusy(false);
      }
    });
  });
}

async function loadRules(): Promise<void> {
  const data = await sendRuntimeMessage<ListZapsResponse>({
    type: "LIST_ZAPS",
    payload: {},
  });
  allRules = data.siteRules;
  renderList();
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseImportFile(raw: string): ImportableZapRule[] {
  const parsed: unknown = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { rules?: unknown })?.rules)
      ? (parsed as { rules: unknown[] }).rules
      : null;

  if (!list) {
    throw new Error('Expected a JSON array of zaps, or an object with a "rules" array.');
  }

  return list
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      siteKey: typeof entry.siteKey === "string" ? entry.siteKey : "",
      selector: typeof entry.selector === "string" ? entry.selector : "",
      label: typeof entry.label === "string" ? entry.label : "",
      pageUrl: typeof entry.pageUrl === "string" ? entry.pageUrl : undefined,
      pageTitle: typeof entry.pageTitle === "string" ? entry.pageTitle : undefined,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
    }));
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  app.innerHTML = `
    <div class="page">
      <header class="strip">
        <span class="wordmark">${ZAP_ICON_SVG}Zap</span>
        <span id="total-count" class="host-chip">0 saved</span>
      </header>

      <div class="toolbar">
        <input
          id="search-input"
          class="search-input"
          type="search"
          placeholder="Search by site, label, or selector"
          autocomplete="off"
        />
        <button id="export-button" class="toolbar-button" type="button">Export JSON</button>
        <button id="import-button" class="toolbar-button" type="button">Import JSON</button>
        <input id="import-file" type="file" accept="application/json" hidden />
        <button id="restore-everything" class="toolbar-button" type="button" data-tone="danger">
          Restore everything
        </button>
      </div>

      <p id="status-message" class="status" data-tone="default" role="status" aria-live="polite">Ready.</p>

      <div id="rule-groups"></div>
    </div>
  `;

  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    renderList();
  });

  document.getElementById("export-button")?.addEventListener("click", () => {
    downloadJson(`zap-rules-${new Date().toISOString().slice(0, 10)}.json`, allRules);
    setStatusMessage(`Exported ${pluralize(allRules.length, "zap")}.`);
  });

  const importInput = document.getElementById("import-file") as HTMLInputElement;
  document.getElementById("import-button")?.addEventListener("click", () => {
    importInput.click();
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) {
      return;
    }

    setBusy(true);
    setStatusMessage("Importing…");
    try {
      const raw = await file.text();
      const rules = parseImportFile(raw);
      const result = await sendRuntimeMessage<ImportZapsResponse>({
        type: "IMPORT_ZAPS",
        payload: { rules },
      });
      await loadRules();
      setStatusMessage(
        result.skippedCount > 0
          ? `Imported ${pluralize(result.addedCount, "zap")}, skipped ${result.skippedCount} invalid ${
              result.skippedCount === 1 ? "entry" : "entries"
            }.`
          : `Imported ${pluralize(result.addedCount, "zap")}.`,
      );
    } catch (error) {
      console.warn("[Zap] Import failed.", error);
      setStatusMessage(
        error instanceof Error ? error.message : "That file could not be imported.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  });

  document.getElementById("restore-everything")?.addEventListener("click", async () => {
    if (!window.confirm("Restore every saved zap across every site? This cannot be undone.")) {
      return;
    }

    setBusy(true);
    setStatusMessage("Restoring everything…");
    try {
      const result = await sendRuntimeMessage<RestoreAllZapsResponse>({
        type: "RESTORE_ALL_ZAPS",
        payload: {},
      });
      await loadRules();
      setStatusMessage(`Restored ${pluralize(result.removedCount, "zap")}.`);
    } finally {
      setBusy(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY]) {
      void loadRules();
    }
  });

  void loadRules();
}

render();
