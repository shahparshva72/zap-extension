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

function createSiteSummaryMarkup(summaries: SiteSummary[]): string {
  if (summaries.length === 0) {
    return `<p class="muted">No saved zaps yet. Enter Zap mode and click the page clutter you never want to see again.</p>`;
  }

  return summaries
    .slice(0, 6)
    .map(
      (summary) => `
        <li class="site-summary-card">
          <span class="site-summary-domain">${summary.siteKey}</span>
          <span class="site-summary-meta">${summary.count} saved · ${formatDate(summary.latestCreatedAt)}</span>
        </li>
      `,
    )
    .join("");
}

function createZapItemMarkup(rule: ZapRule): string {
  return `
    <li class="zap-card">
      <div class="zap-card-copy">
        <p class="zap-label">${escapeHtml(rule.label)}</p>
        <p class="zap-meta">${formatDate(rule.createdAt)} · <code>${escapeHtml(rule.selector)}</code></p>
      </div>
      <button class="ghost-button" data-restore-id="${rule.id}">Restore</button>
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
      <main class="shell">
        <section class="unsupported">
          <p class="eyebrow">Zap</p>
          <h1>Open a regular web page to start.</h1>
          <p class="muted">This version works on standard http and https pages, not browser-internal tabs.</p>
        </section>
      </main>
    `;
    return;
  }

  const data = await sendRuntimeMessage<ListZapsResponse>({
    type: "LIST_ZAPS",
    payload: { siteKey: context.siteKey },
  });

  const siteZapsMarkup =
    data.siteRules.length === 0
      ? `<p class="muted">No zaps saved for ${context.siteKey} yet.</p>`
      : `<ul class="zap-list">${data.siteRules.map(createZapItemMarkup).join("")}</ul>`;

  app.innerHTML = `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Zap</p>
        <h1>Make the page quieter.</h1>
        <p class="hero-copy">Hover the clutter, click once, and keep it gone across ${context.siteKey}.</p>
        <div class="domain-pill">${escapeHtml(context.siteKey)}</div>
      </section>

      <section class="actions-panel">
        <button id="enter-zap" class="primary-button">Enter Zap Mode</button>
        <button id="exit-zap" class="secondary-button">Exit Mode</button>
      </section>

      <p id="status-message" class="status-message" role="status" aria-live="polite">
        Ready for ${escapeHtml(context.siteKey)}.
      </p>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">Current site</p>
            <h2>${escapeHtml(context.title)}</h2>
          </div>
          <button id="restore-all" class="ghost-button" ${
            data.siteRules.length === 0 ? "disabled" : ""
          }>Restore all</button>
        </div>
        ${siteZapsMarkup}
      </section>

      <section class="panel">
        <div class="panel-head compact">
          <div>
            <p class="panel-kicker">Saved across sites</p>
            <h2>Recent activity</h2>
          </div>
        </div>
        <ul class="site-summary-list">${createSiteSummaryMarkup(data.siteSummaries)}</ul>
      </section>
    </main>
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
