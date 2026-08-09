import "../popup/styles.css";

import type {
  ActiveTabContext,
  CommandResult,
  ListZapsResponse,
  SiteSummary,
  ZapRule,
} from "../shared/types";

const WWW_PREFIX = /^www\./i;

async function sendRuntimeMessage<TResponse>(message: object): Promise<TResponse> {
  return chrome.runtime.sendMessage(message) as Promise<TResponse>;
}

function getSiteKeyFromUrl(url: string): string {
  return new URL(url).hostname.replace(WWW_PREFIX, "").toLowerCase();
}

function isSupportedPage(url: string | undefined): url is string {
  if (!url) {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
}

async function getActiveTabContext(): Promise<ActiveTabContext | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isSupportedPage(tab.url)) {
    return null;
  }

  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title || "Current page",
    siteKey: getSiteKeyFromUrl(tab.url),
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const ZAP_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

function createSiteSummaryMarkup(summaries: SiteSummary[]): string {
  if (summaries.length === 0) {
    return `<p class="empty">No other sites yet.</p>`;
  }

  const rows = summaries
    .slice(0, 6)
    .map(
      (summary) => `
        <li class="site-row">
          <span class="domain">${escapeHtml(summary.siteKey)}</span>
          <span class="meta">${summary.count} · ${formatDate(summary.latestCreatedAt)}</span>
        </li>
      `,
    )
    .join("");

  return `<ul class="row-list">${rows}</ul>`;
}

function createZapItemMarkup(rule: ZapRule): string {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setActionState(isBusy: boolean): void {
  document
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((button) => {
      button.disabled = isBusy;
    });
}

function setStatusMessage(message: string, tone: "default" | "error" = "default"): void {
  const status = document.getElementById("status-message");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.tone = tone;
}

async function runPopupCommand(
  message: object,
  options: { closeOnSuccess?: boolean; loadingMessage: string; successMessage?: string },
): Promise<boolean> {
  try {
    setActionState(true);
    setStatusMessage(options.loadingMessage);
    const response = await sendRuntimeMessage<CommandResult>(message);
    if (!response.success) {
      setStatusMessage(
        response.error || "That action could not be completed on this tab.",
        "error",
      );
      return false;
    }

    setStatusMessage(options.successMessage || "Done.");
    if (options.closeOnSuccess) {
      window.close();
    }
    return true;
  } catch (error) {
    console.warn("[Zap] Popup command failed.", error);
    setStatusMessage("The extension hit an unexpected error. Please try again.", "error");
    return false;
  } finally {
    setActionState(false);
  }
}

async function render(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  const context = await getActiveTabContext();
  if (!context) {
    app.innerHTML = `
      <header class="strip">
        <span class="wordmark">${ZAP_ICON_SVG}Zap</span>
      </header>
      <p class="empty empty-page">Zap only works on standard http and https pages.</p>
    `;
    return;
  }

  const data = await sendRuntimeMessage<ListZapsResponse>({
    type: "LIST_ZAPS",
    payload: { siteKey: context.siteKey },
  });

  const siteZapsMarkup =
    data.siteRules.length === 0
      ? `<p class="empty">Nothing zapped here yet.</p>`
      : `<ul class="row-list">${data.siteRules.map(createZapItemMarkup).join("")}</ul>`;

  const otherSites = data.siteSummaries.filter(
    (summary) => summary.siteKey !== context.siteKey,
  );

  app.innerHTML = `
    <header class="strip">
      <span class="wordmark">${ZAP_ICON_SVG}Zap</span>
      <span class="host-chip" title="${escapeHtml(context.title)}">${escapeHtml(context.siteKey)}</span>
    </header>

    <div class="mode-row">
      <button id="enter-zap" class="mode-button" type="button">
        <span class="dot" data-tone="accent"></span>Zap mode
      </button>
      <button id="exit-zap" class="mode-button" type="button">
        <span class="dot"></span>Stop
      </button>
    </div>

    <p id="status-message" class="status" data-tone="default" role="status" aria-live="polite">Ready.</p>

    <section>
      <div class="section-head">
        <span class="section-title">This site <span class="count">${data.siteRules.length}</span></span>
        <button id="restore-all" class="text-button" type="button" ${
          data.siteRules.length === 0 ? "disabled" : ""
        }>Restore all</button>
      </div>
      ${siteZapsMarkup}
    </section>

    <section>
      <div class="section-head">
        <span class="section-title">Other sites <span class="count">${otherSites.length}</span></span>
      </div>
      ${createSiteSummaryMarkup(otherSites)}
    </section>

    <a class="manage-link" href="${chrome.runtime.getURL("manage.html")}" target="_blank" rel="noopener">
      Manage all zaps
    </a>
  `;

  const enterButton = document.getElementById("enter-zap");
  enterButton?.addEventListener("click", async () => {
    await runPopupCommand(
      {
        type: "ENTER_ZAP_MODE",
        payload: { tabId: context.tabId },
      },
      {
        closeOnSuccess: true,
        loadingMessage: "Starting Zap mode…",
        successMessage: "Zap mode is ready.",
      },
    );
  });

  const exitButton = document.getElementById("exit-zap");
  exitButton?.addEventListener("click", async () => {
    await runPopupCommand(
      {
        type: "EXIT_ZAP_MODE",
        payload: { tabId: context.tabId },
      },
      {
        closeOnSuccess: true,
        loadingMessage: "Exiting Zap mode…",
        successMessage: "Zap mode is off.",
      },
    );
  });

  const restoreAllButton = document.getElementById("restore-all");
  restoreAllButton?.addEventListener("click", async () => {
    const success = await runPopupCommand(
      {
        type: "RESTORE_SITE_ZAPS",
        payload: { siteKey: context.siteKey, tabId: context.tabId },
      },
      {
        loadingMessage: "Restoring everything for this site…",
        successMessage: "All saved zaps were restored for this site.",
      },
    );
    if (success) {
      await render();
    }
  });

  app.querySelectorAll<HTMLButtonElement>("[data-restore-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.restoreId;
      if (!id) {
        return;
      }

      const success = await runPopupCommand(
        {
          type: "RESTORE_ZAP",
          payload: { id, tabId: context.tabId },
        },
        {
          loadingMessage: "Restoring this zap…",
          successMessage: "The saved zap was restored.",
        },
      );
      if (success) {
        await render();
      }
    });
  });
}

void render();
