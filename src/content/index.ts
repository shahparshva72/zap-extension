import { buildElementLabel, buildElementSelector } from "../shared/selector";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  ZapRule,
} from "../shared/types";

const OVERLAY_ROOT_ATTRIBUTE = "data-zap-extension-root";
const STYLE_ELEMENT_ID = "zap-extension-style";
const HIGHLIGHT_ID = "zap-extension-highlight";
const HUD_ID = "zap-extension-hud";
const STORAGE_KEY = "zapRulesV1";
const WWW_PREFIX = /^www\./i;

function getSiteKeyFromUrl(url: string): string {
  return new URL(url).hostname.replace(WWW_PREFIX, "").toLowerCase();
}

async function listZapRules(siteKey: string): Promise<ZapRule[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const rules = result[STORAGE_KEY];
  const allRules = Array.isArray(rules) ? (rules as ZapRule[]) : [];
  return allRules.filter((rule) => rule.siteKey === siteKey);
}

class ZapPicker {
  private active = false;
  private highlightedElement: Element | null = null;
  private overlayRoot: HTMLDivElement | null = null;
  private highlightBox: HTMLDivElement | null = null;
  private hud: HTMLDivElement | null = null;

  enter(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.ensureOverlay();
    this.updateHud("Zap mode is active. Hover any element and click to remove it.");
    document.addEventListener("mousemove", this.handlePointerMove, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
    window.addEventListener("scroll", this.handleViewportChange, true);
    window.addEventListener("resize", this.handleViewportChange, true);
  }

  exit(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.highlightedElement = null;
    document.removeEventListener("mousemove", this.handlePointerMove, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    window.removeEventListener("scroll", this.handleViewportChange, true);
    window.removeEventListener("resize", this.handleViewportChange, true);
    this.teardownOverlay();
  }

  private ensureOverlay(): void {
    if (this.overlayRoot) {
      return;
    }

    const root = document.createElement("div");
    root.setAttribute(OVERLAY_ROOT_ATTRIBUTE, "true");
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.pointerEvents = "none";
    root.style.zIndex = "2147483647";

    const highlight = document.createElement("div");
    highlight.id = HIGHLIGHT_ID;
    highlight.style.position = "fixed";
    highlight.style.pointerEvents = "none";
    highlight.style.border = "2px solid rgba(255, 140, 66, 0.95)";
    highlight.style.borderRadius = "18px";
    highlight.style.background =
      "linear-gradient(135deg, rgba(255, 140, 66, 0.22), rgba(255, 219, 168, 0.16))";
    highlight.style.boxShadow =
      "0 0 0 1px rgba(255,255,255,0.25), 0 18px 40px rgba(26, 17, 10, 0.28)";
    highlight.style.backdropFilter = "blur(2px)";
    highlight.style.opacity = "0";
    highlight.style.transition = "opacity 120ms ease, transform 120ms ease";

    const hud = document.createElement("div");
    hud.id = HUD_ID;
    hud.textContent = "Zap mode is off.";
    hud.style.position = "fixed";
    hud.style.top = "20px";
    hud.style.right = "20px";
    hud.style.maxWidth = "280px";
    hud.style.padding = "14px 16px";
    hud.style.borderRadius = "18px";
    hud.style.border = "1px solid rgba(255, 205, 149, 0.34)";
    hud.style.background =
      "linear-gradient(155deg, rgba(16, 11, 7, 0.94), rgba(52, 32, 18, 0.92))";
    hud.style.color = "#fff6e9";
    hud.style.fontFamily = "'Iowan Old Style', 'Palatino Linotype', serif";
    hud.style.fontSize = "13px";
    hud.style.lineHeight = "1.4";
    hud.style.letterSpacing = "0.02em";
    hud.style.boxShadow = "0 16px 36px rgba(20, 12, 8, 0.36)";

    root.append(highlight, hud);

    this.overlayRoot = root;
    this.highlightBox = highlight;
    this.hud = hud;
    mountOverlay(root);
  }

  private updateHud(text: string): void {
    if (!this.hud) {
      return;
    }

    this.hud.textContent = text;
  }

  private handleViewportChange = (): void => {
    if (this.highlightedElement) {
      this.highlight(this.highlightedElement);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.exit();
  };

  private handlePointerMove = (event: MouseEvent): void => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!(target instanceof Element)) {
      this.clearHighlight();
      return;
    }

    const candidate = this.findZapTarget(target);
    if (!candidate) {
      this.clearHighlight();
      return;
    }

    this.highlight(candidate);
  };

  private handleClick = async (event: MouseEvent): Promise<void> => {
    if (!this.active || !this.highlightedElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const target = this.highlightedElement;
    const selector = buildElementSelector(target);
    const label = buildElementLabel(target);

    const message: ContentToBackgroundMessage = {
      type: "CREATE_ZAP",
      payload: {
        selector,
        label,
        pageUrl: window.location.href,
        pageTitle: document.title,
      },
    };

    const response = (await chrome.runtime.sendMessage(message)) as {
      rule?: ZapRule;
    };

    target.remove();
    await refreshAppliedRules();
    this.updateHud(
      response.rule
        ? `Zapped "${response.rule.label}". Press Esc to exit or keep clicking to remove more.`
        : "Element removed. Press Esc to exit or keep clicking to remove more.",
    );
    this.clearHighlight();
  };

  private findZapTarget(start: Element): Element | null {
    let current: Element | null = start;
    while (current) {
      if (current.closest(`[${OVERLAY_ROOT_ATTRIBUTE}]`)) {
        return null;
      }

      if (current === document.documentElement || current === document.body) {
        return null;
      }

      const rect = current.getBoundingClientRect();
      if (rect.width > 8 && rect.height > 8) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  private clearHighlight(): void {
    this.highlightedElement = null;
    if (this.highlightBox) {
      this.highlightBox.style.opacity = "0";
    }
  }

  private teardownOverlay(): void {
    this.highlightedElement = null;
    this.overlayRoot?.remove();
    this.overlayRoot = null;
    this.highlightBox = null;
    this.hud = null;
  }

  private highlight(element: Element): void {
    this.highlightedElement = element;
    if (!this.highlightBox) {
      return;
    }

    const rect = element.getBoundingClientRect();
    this.highlightBox.style.opacity = "1";
    this.highlightBox.style.transform = "translateZ(0)";
    this.highlightBox.style.top = `${Math.max(rect.top, 0)}px`;
    this.highlightBox.style.left = `${Math.max(rect.left, 0)}px`;
    this.highlightBox.style.width = `${Math.max(rect.width, 0)}px`;
    this.highlightBox.style.height = `${Math.max(rect.height, 0)}px`;
  }
}

const picker = new ZapPicker();
let currentRules: ZapRule[] = [];
let styleElement: HTMLStyleElement | null = null;
let mutationObserver: MutationObserver | null = null;
let historyPatched = false;

function mountOverlay(root: HTMLDivElement): void {
  const mountTarget = document.documentElement || document.body;
  if (!mountTarget.contains(root)) {
    mountTarget.append(root);
  }
}

function isSelectorValid(selector: string): boolean {
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function ensureStyleElement(): HTMLStyleElement {
  if (styleElement && document.contains(styleElement)) {
    return styleElement;
  }

  styleElement =
    document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = STYLE_ELEMENT_ID;
    styleElement.setAttribute(OVERLAY_ROOT_ATTRIBUTE, "true");
  }

  const parent = document.head || document.documentElement;
  if (!parent.contains(styleElement)) {
    parent.append(styleElement);
  }

  return styleElement;
}

function buildRuleCss(rules: ZapRule[]): string {
  const selectors = rules
    .map((rule) => rule.selector)
    .filter(isSelectorValid)
    .map((selector) => `${selector} { display: none !important; }`);

  return selectors.join("\n");
}

async function refreshAppliedRules(): Promise<void> {
  const siteKey = getSiteKeyFromUrl(window.location.href);
  currentRules = await listZapRules(siteKey);
  const nextCss = buildRuleCss(currentRules);
  ensureStyleElement().textContent = nextCss;
}

function installMutationObserver(): void {
  if (mutationObserver) {
    return;
  }

  mutationObserver = new MutationObserver(() => {
    ensureStyleElement();
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function patchHistoryEvents(): void {
  if (historyPatched) {
    return;
  }

  historyPatched = true;

  const wrapHistoryMethod = (methodName: "pushState" | "replaceState") => {
    const original = history[methodName];
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      void refreshAppliedRules();
      return result;
    };
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", () => {
    void refreshAppliedRules();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    const typedMessage = message as BackgroundToContentMessage;

    switch (typedMessage.type) {
      case "ENTER_ZAP_MODE":
        picker.enter();
        sendResponse({ success: true });
        return;
      case "EXIT_ZAP_MODE":
        picker.exit();
        sendResponse({ success: true });
        return;
      case "REFRESH_ZAPS":
        await refreshAppliedRules();
        sendResponse({ success: true });
        return;
      default:
        sendResponse({ success: false });
    }
  })();

  return true;
});

void refreshAppliedRules();
installMutationObserver();
patchHistoryEvents();
