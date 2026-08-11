import { buildElementLabel, buildElementSelector } from "../shared/selector";
import type {
  BackgroundToContentMessage,
  BoostRule,
  BoostScope,
  BoostType,
  CreateBoostPayload,
} from "../shared/types";

// Content scripts load as classic (non-module) scripts, so the storage reader is
// inlined here rather than imported from ../shared/storage — a static `import` in a
// content script bundle fails silently since it can't resolve at runtime.
const BOOST_STORAGE_KEY = "boostRulesV1";
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

  await chrome.storage.local.set({ [BOOST_STORAGE_KEY]: migrated });
  return migrated;
}

async function getAllBoostRules(): Promise<BoostRule[]> {
  const result = await chrome.storage.local.get(BOOST_STORAGE_KEY);
  const rules = result[BOOST_STORAGE_KEY];

  if (Array.isArray(rules)) {
    return rules as BoostRule[];
  }

  return migrateLegacyRules();
}

const OVERLAY_ROOT_ATTRIBUTE = "data-zap-extension-root";
const STYLE_ELEMENT_ID = "zap-extension-style";
const HIGHLIGHT_ID = "zap-extension-highlight";
const HUD_ID = "zap-extension-hud";
const FONT_DATALIST_ID = "zap-extension-font-presets";
const WWW_PREFIX = /^www\./i;
const INITIALIZED_FLAG = "__zapExtensionInitialized";

declare global {
  interface Window {
    __zapExtensionInitialized?: boolean;
  }
}

const TOOL_LABELS: Record<BoostType, string> = {
  remove: "Zap",
  recolor: "Recolor",
  font: "Font",
  text: "Text",
};

const TOOL_HINTS: Record<BoostType, string> = {
  remove: "Click to remove permanently, Shift+click to remove just for this visit.",
  recolor: "Click an element to change its text or background color.",
  font: "Click an element to change its font.",
  text: "Click an element to edit its text.",
};

const FONT_PRESETS: Array<{ label: string; value: string }> = [
  { label: "System Sans", value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { label: "System Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "System Mono", value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  { label: "Rounded", value: "'Segoe UI Rounded', 'SF Pro Rounded', system-ui, sans-serif" },
  { label: "Comic", value: "'Comic Sans MS', 'Comic Sans', cursive" },
];

interface EditSession {
  tool: "recolor" | "font" | "text";
  target: Element;
  originalTargetStyle: string | null;
  originalHtmlStyle: string | null;
  originalBodyStyle: string | null;
  originalText: string;
}

type PendingAction =
  | { kind: "remove"; ruleId: string | null; element: Element; parent: Element; nextSibling: Element | null }
  | { kind: "recolor" | "font"; ruleId: string }
  | { kind: "text"; ruleId: string; target: Element; originalText: string };

function getSiteKeyFromUrl(url: string): string {
  return new URL(url).hostname.replace(WWW_PREFIX, "").toLowerCase();
}

function restoreAttr(element: Element, value: string | null): void {
  if (value === null) {
    element.removeAttribute("style");
  } else {
    element.setAttribute("style", value);
  }
}

function setImportantStyle(element: Element, property: string, value: string | null): void {
  const style = (element as HTMLElement).style;
  if (value) {
    style.setProperty(property, value, "important");
  } else {
    style.removeProperty(property);
  }
}

function rgbToHex(value: string): string {
  const numbers = value.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 3) {
    return "#000000";
  }

  const [r, g, b] = numbers.map((component) => Math.max(0, Math.min(255, Math.round(Number(component)))));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function styleFormRow(row: HTMLDivElement): void {
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "6px";
  row.style.marginTop = "8px";
}

function styleTextInput(input: HTMLInputElement | HTMLTextAreaElement): void {
  input.style.flex = "1";
  input.style.font = "inherit";
  input.style.fontSize = "11px";
  input.style.color = "#f2f1ec";
  input.style.background = "rgba(255, 255, 255, 0.08)";
  input.style.border = "1px solid rgba(255, 255, 255, 0.18)";
  input.style.borderRadius = "4px";
  input.style.padding = "4px 6px";
  input.style.width = "100%";
  input.style.boxSizing = "border-box";
}

function styleActionButton(button: HTMLButtonElement, tone: "accent" | "muted"): void {
  button.style.flex = "1";
  button.style.padding = "6px 8px";
  button.style.fontSize = "10px";
  button.style.fontWeight = "700";
  button.style.letterSpacing = "0.05em";
  button.style.textTransform = "uppercase";
  button.style.borderRadius = "4px";
  button.style.cursor = "pointer";
  button.style.border =
    tone === "accent" ? "1px solid rgba(255, 216, 61, 0.6)" : "1px solid rgba(255, 255, 255, 0.18)";
  button.style.background = tone === "accent" ? "rgba(255, 216, 61, 0.15)" : "transparent";
  button.style.color = tone === "accent" ? "#ffd83d" : "#f2f1ec";
}

function styleTabButton(button: HTMLButtonElement, active: boolean): void {
  button.style.flex = "1";
  button.style.padding = "5px 6px";
  button.style.fontSize = "10px";
  button.style.fontWeight = "700";
  button.style.letterSpacing = "0.04em";
  button.style.textTransform = "uppercase";
  button.style.borderRadius = "4px";
  button.style.cursor = "pointer";
  button.style.border = active
    ? "1px solid rgba(255, 216, 61, 0.6)"
    : "1px solid rgba(255, 255, 255, 0.14)";
  button.style.background = active ? "rgba(255, 216, 61, 0.18)" : "transparent";
  button.style.color = active ? "#ffd83d" : "#c7c8c4";
}

function createCheckboxRow(labelText: string): { row: HTMLDivElement; toggle: HTMLInputElement } {
  const row = document.createElement("div");
  styleFormRow(row);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";

  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.gap = "6px";
  label.style.fontSize = "11px";
  label.append(toggle, document.createTextNode(` ${labelText}`));

  row.append(label);
  return { row, toggle };
}

function createToggleColorRow(
  labelText: string,
  initialColor: string,
): { row: HTMLDivElement; toggle: HTMLInputElement; color: HTMLInputElement } {
  const row = document.createElement("div");
  styleFormRow(row);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";

  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.gap = "6px";
  label.style.flex = "1";
  label.style.fontSize = "11px";
  label.append(toggle, document.createTextNode(` ${labelText}`));

  const color = document.createElement("input");
  color.type = "color";
  color.value = initialColor;
  color.style.width = "36px";
  color.style.height = "22px";
  color.style.border = "none";
  color.style.background = "none";
  color.style.padding = "0";
  color.style.opacity = toggle.checked ? "1" : "0.45";

  const syncOpacity = () => {
    color.style.opacity = toggle.checked ? "1" : "0.45";
  };
  toggle.addEventListener("change", syncOpacity);

  const autoEnable = () => {
    if (!toggle.checked) {
      toggle.checked = true;
      syncOpacity();
      toggle.dispatchEvent(new Event("change"));
    }
  };
  color.addEventListener("input", autoEnable);
  color.addEventListener("change", autoEnable);

  row.append(label, color);
  return { row, toggle, color };
}

function createFontRow(initialValue: string): { row: HTMLDivElement; input: HTMLInputElement } {
  const row = document.createElement("div");
  styleFormRow(row);

  const input = document.createElement("input");
  input.type = "text";
  input.value = initialValue;
  input.setAttribute("list", FONT_DATALIST_ID);
  styleTextInput(input);

  row.append(input);
  return { row, input };
}

function ensureFontDatalist(root: HTMLElement): void {
  if (document.getElementById(FONT_DATALIST_ID)) {
    return;
  }

  const datalist = document.createElement("datalist");
  datalist.id = FONT_DATALIST_ID;
  for (const preset of FONT_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.value;
    option.label = preset.label;
    datalist.append(option);
  }

  root.append(datalist);
}

class BoostPicker {
  private active = false;
  private activeTool: BoostType = "remove";
  private highlightedElement: Element | null = null;
  private overlayRoot: HTMLDivElement | null = null;
  private highlightBox: HTMLDivElement | null = null;
  private hudText: HTMLParagraphElement | null = null;
  private hudUndo: HTMLButtonElement | null = null;
  private editorPanel: HTMLDivElement | null = null;
  private tabButtons: Partial<Record<BoostType, HTMLButtonElement>> = {};
  private lastAction: PendingAction | null = null;
  private editSession: EditSession | null = null;

  enter(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.activeTool = "remove";
    this.lastAction = null;
    this.editSession = null;
    this.ensureOverlay();
    this.syncTabButtonStyles();
    this.updateHud(TOOL_HINTS.remove);
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
    this.lastAction = null;
    this.cancelEditSession();
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
    hud.style.position = "fixed";
    hud.style.top = "20px";
    hud.style.right = "20px";
    hud.style.width = "260px";
    hud.style.padding = "14px 16px";
    hud.style.borderRadius = "8px";
    hud.style.border = "1px solid rgba(255, 216, 61, 0.28)";
    hud.style.background = "rgba(19, 20, 21, 0.95)";
    hud.style.color = "#f2f1ec";
    hud.style.fontFamily =
      "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
    hud.style.fontSize = "12px";
    hud.style.lineHeight = "1.5";
    hud.style.letterSpacing = "0.01em";
    hud.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.32)";
    hud.style.pointerEvents = "auto";

    const tabsRow = document.createElement("div");
    tabsRow.style.display = "flex";
    tabsRow.style.gap = "4px";
    tabsRow.style.marginBottom = "8px";

    (Object.keys(TOOL_LABELS) as BoostType[]).forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = TOOL_LABELS[tool];
      styleTabButton(button, tool === this.activeTool);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setActiveTool(tool);
      });
      this.tabButtons[tool] = button;
      tabsRow.append(button);
    });

    const hudText = document.createElement("p");
    hudText.style.margin = "0";
    hudText.textContent = "Boost mode is off.";

    const editorPanel = document.createElement("div");
    editorPanel.style.display = "none";

    const hudUndo = document.createElement("button");
    hudUndo.type = "button";
    hudUndo.textContent = "Undo";
    hudUndo.style.display = "none";
    hudUndo.style.marginTop = "8px";
    hudUndo.style.padding = "5px 10px";
    hudUndo.style.font = "inherit";
    hudUndo.style.fontSize = "11px";
    hudUndo.style.fontWeight = "700";
    hudUndo.style.letterSpacing = "0.05em";
    hudUndo.style.textTransform = "uppercase";
    hudUndo.style.color = "#ffd83d";
    hudUndo.style.background = "transparent";
    hudUndo.style.border = "1px solid rgba(255, 216, 61, 0.55)";
    hudUndo.style.borderRadius = "4px";
    hudUndo.style.cursor = "pointer";
    hudUndo.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.performUndo();
    });

    hud.append(tabsRow, hudText, editorPanel, hudUndo);
    root.append(highlight, hud);
    ensureFontDatalist(root);

    this.overlayRoot = root;
    this.highlightBox = highlight;
    this.hudText = hudText;
    this.hudUndo = hudUndo;
    this.editorPanel = editorPanel;
    mountOverlay(root);
  }

  private syncTabButtonStyles(): void {
    (Object.entries(this.tabButtons) as [BoostType, HTMLButtonElement][]).forEach(([tool, button]) => {
      styleTabButton(button, tool === this.activeTool);
    });
  }

  private setActiveTool(tool: BoostType): void {
    if (this.activeTool === tool) {
      return;
    }

    this.cancelEditSession();
    this.activeTool = tool;
    this.syncTabButtonStyles();
    this.updateHud(TOOL_HINTS[tool]);
  }

  private updateHud(text: string): void {
    if (!this.hudText) {
      return;
    }

    this.hudText.textContent = text;
    this.hideUndo();
  }

  private showActionConfirmation(message: string, canUndo: boolean): void {
    if (!this.hudText) {
      return;
    }

    this.hudText.textContent = `${message} Press Esc to exit or keep clicking.`;

    if (canUndo) {
      this.showUndo();
    } else {
      this.hideUndo();
    }
  }

  private showUndo(): void {
    if (this.hudUndo) {
      this.hudUndo.style.display = "inline-block";
    }
  }

  private hideUndo(): void {
    if (this.hudUndo) {
      this.hudUndo.style.display = "none";
    }
  }

  private previewTargets(target: Element, wholePage: boolean): Element[] {
    if (!wholePage) {
      return [target];
    }

    const targets: Element[] = [document.documentElement];
    if (document.body) {
      targets.push(document.body);
    }
    return targets;
  }

  private revertPreview(): void {
    const session = this.editSession;
    if (!session) {
      return;
    }

    if (session.tool === "text") {
      session.target.textContent = session.originalText;
      return;
    }

    restoreAttr(session.target, session.originalTargetStyle);
    restoreAttr(document.documentElement, session.originalHtmlStyle);
    if (document.body) {
      restoreAttr(document.body, session.originalBodyStyle);
    }
  }

  private closeEditSession(): void {
    this.editSession = null;
    if (this.editorPanel) {
      this.editorPanel.style.display = "none";
      this.editorPanel.innerHTML = "";
    }
    if (this.lastAction) {
      this.showUndo();
    }
  }

  private cancelEditSession(): void {
    if (!this.editSession) {
      return;
    }

    this.revertPreview();
    this.closeEditSession();
  }

  private async commitBoost(
    payload: CreateBoostPayload,
    label: string,
    tool: "recolor" | "font",
  ): Promise<void> {
    const response = (await chrome.runtime
      .sendMessage({ type: "CREATE_BOOST", payload })
      .catch(() => null)) as { rule?: BoostRule } | null;

    if (!response?.rule) {
      this.revertPreview();
      this.closeEditSession();
      this.updateHud("That boost could not be saved. Please try again.");
      return;
    }

    await refreshAppliedRules();
    this.revertPreview();
    this.closeEditSession();
    this.lastAction = { kind: tool, ruleId: response.rule.id };
    this.showActionConfirmation(`Saved ${tool} for "${label}".`, true);
  }

  private openStyleEditor(tool: "recolor" | "font", target: Element): void {
    const panel = this.editorPanel;
    if (!panel) {
      return;
    }

    this.editSession = {
      tool,
      target,
      originalTargetStyle: target.getAttribute("style"),
      originalHtmlStyle: document.documentElement.getAttribute("style"),
      originalBodyStyle: document.body?.getAttribute("style") ?? null,
      originalText: target.textContent ?? "",
    };

    this.hideUndo();
    this.updateHud(tool === "recolor" ? "Adjust the colors, then Save." : "Pick a font, then Save.");

    panel.innerHTML = "";
    panel.style.display = "block";

    const computed = getComputedStyle(target);
    const wholePageRow = createCheckboxRow("Apply to whole page");

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    styleActionButton(saveButton, "accent");

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    styleActionButton(cancelButton, "muted");

    const actionsRow = document.createElement("div");
    styleFormRow(actionsRow);
    actionsRow.append(saveButton, cancelButton);

    if (tool === "recolor") {
      const textRow = createToggleColorRow("Text color", rgbToHex(computed.color));
      const bgRow = createToggleColorRow("Background", rgbToHex(computed.backgroundColor));

      const applyPreview = () => {
        const targets = this.previewTargets(target, wholePageRow.toggle.checked);
        for (const el of targets) {
          setImportantStyle(el, "color", textRow.toggle.checked ? textRow.color.value : null);
          setImportantStyle(
            el,
            "background-color",
            bgRow.toggle.checked ? bgRow.color.value : null,
          );
        }
      };

      [wholePageRow.toggle, textRow.toggle, textRow.color, bgRow.toggle, bgRow.color].forEach(
        (input) => {
          input.addEventListener("input", applyPreview);
          input.addEventListener("change", applyPreview);
        },
      );

      panel.append(wholePageRow.row, textRow.row, bgRow.row, actionsRow);
      applyPreview();

      saveButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!textRow.toggle.checked && !bgRow.toggle.checked) {
          this.updateHud("Turn on text or background color before saving.");
          return;
        }

        const scope: BoostScope = wholePageRow.toggle.checked ? "page" : "element";
        const selector = scope === "page" ? "html" : buildElementSelector(target);
        const label = scope === "page" ? "Whole page" : buildElementLabel(target);
        const payload: CreateBoostPayload = {
          type: "recolor",
          selector,
          label,
          pageUrl: window.location.href,
          pageTitle: document.title,
          scope,
          textColor: textRow.toggle.checked ? textRow.color.value : undefined,
          backgroundColor: bgRow.toggle.checked ? bgRow.color.value : undefined,
        };

        await this.commitBoost(payload, label, "recolor");
      });
    } else {
      const fontRow = createFontRow(computed.fontFamily);

      const applyPreview = () => {
        const targets = this.previewTargets(target, wholePageRow.toggle.checked);
        for (const el of targets) {
          setImportantStyle(el, "font-family", fontRow.input.value || null);
        }
      };

      [wholePageRow.toggle, fontRow.input].forEach((input) => {
        input.addEventListener("input", applyPreview);
        input.addEventListener("change", applyPreview);
      });

      panel.append(wholePageRow.row, fontRow.row, actionsRow);
      applyPreview();

      saveButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const fontFamily = fontRow.input.value.trim();
        if (!fontFamily) {
          this.updateHud("Enter a font before saving.");
          return;
        }

        const scope: BoostScope = wholePageRow.toggle.checked ? "page" : "element";
        const selector = scope === "page" ? "html" : buildElementSelector(target);
        const label = scope === "page" ? "Whole page" : buildElementLabel(target);
        const payload: CreateBoostPayload = {
          type: "font",
          selector,
          label,
          pageUrl: window.location.href,
          pageTitle: document.title,
          scope,
          fontFamily,
        };

        await this.commitBoost(payload, label, "font");
      });
    }

    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.revertPreview();
      this.closeEditSession();
      this.updateHud(TOOL_HINTS[this.activeTool]);
    });
  }

  private openTextEditor(target: Element): void {
    const panel = this.editorPanel;
    if (!panel) {
      return;
    }

    const originalText = target.textContent ?? "";
    this.editSession = {
      tool: "text",
      target,
      originalTargetStyle: null,
      originalHtmlStyle: null,
      originalBodyStyle: null,
      originalText,
    };

    this.hideUndo();
    this.updateHud("Edit the text, then Save.");

    panel.innerHTML = "";
    panel.style.display = "block";

    const textarea = document.createElement("textarea");
    textarea.value = originalText;
    textarea.rows = 3;
    styleTextInput(textarea);
    textarea.addEventListener("input", () => {
      target.textContent = textarea.value;
    });

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    styleActionButton(saveButton, "accent");

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    styleActionButton(cancelButton, "muted");

    const actionsRow = document.createElement("div");
    styleFormRow(actionsRow);
    actionsRow.append(saveButton, cancelButton);

    panel.append(textarea, actionsRow);

    saveButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const newText = textarea.value;
      if (!newText.trim()) {
        this.updateHud("Enter some text before saving.");
        return;
      }

      const selector = buildElementSelector(target);
      const label = buildElementLabel(target);
      const payload: CreateBoostPayload = {
        type: "text",
        selector,
        label,
        pageUrl: window.location.href,
        pageTitle: document.title,
        originalText,
        newText,
      };

      const response = (await chrome.runtime
        .sendMessage({ type: "CREATE_BOOST", payload })
        .catch(() => null)) as { rule?: BoostRule } | null;

      this.closeEditSession();

      if (!response?.rule) {
        this.updateHud("That boost could not be saved. Please try again.");
        return;
      }

      await refreshAppliedRules();
      this.lastAction = { kind: "text", ruleId: response.rule.id, target, originalText };
      this.showActionConfirmation(`Saved text for "${label}".`, true);
    });

    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.revertPreview();
      this.closeEditSession();
      this.updateHud(TOOL_HINTS.text);
    });
  }

  private async performRemove(target: Element, sessionOnly: boolean): Promise<void> {
    const parent = target.parentElement;
    const nextSibling = target.nextElementSibling;
    const label = buildElementLabel(target);

    let ruleId: string | null = null;

    if (!sessionOnly) {
      const selector = buildElementSelector(target);
      const payload: CreateBoostPayload = {
        type: "remove",
        selector,
        label,
        pageUrl: window.location.href,
        pageTitle: document.title,
      };

      const response = (await chrome.runtime
        .sendMessage({ type: "CREATE_BOOST", payload })
        .catch(() => null)) as { rule?: BoostRule } | null;
      ruleId = response?.rule?.id ?? null;
    }

    target.remove();
    await refreshAppliedRules();

    this.lastAction = parent ? { kind: "remove", ruleId, element: target, parent, nextSibling } : null;
    this.showActionConfirmation(
      sessionOnly ? `Removed "${label}" for this visit.` : `Zapped "${label}".`,
      this.lastAction !== null,
    );
  }

  private performUndo = async (): Promise<void> => {
    const pending = this.lastAction;
    if (!pending) {
      return;
    }

    this.lastAction = null;
    this.hideUndo();

    if (pending.kind === "remove") {
      if (pending.ruleId) {
        await chrome.runtime
          .sendMessage({ type: "RESTORE_BOOST", payload: { id: pending.ruleId } })
          .catch(() => undefined);
        await refreshAppliedRules();
      }

      if (
        pending.nextSibling &&
        pending.nextSibling.isConnected &&
        pending.nextSibling.parentElement === pending.parent
      ) {
        pending.parent.insertBefore(pending.element, pending.nextSibling);
      } else if (pending.parent.isConnected) {
        pending.parent.appendChild(pending.element);
      }

      this.updateHud("Restored. Press Esc to exit or keep clicking to remove more.");
      return;
    }

    await chrome.runtime
      .sendMessage({ type: "RESTORE_BOOST", payload: { id: pending.ruleId } })
      .catch(() => undefined);
    await refreshAppliedRules();

    if (pending.kind === "text") {
      pending.target.textContent = pending.originalText;
    }

    this.updateHud(`Undid the last ${pending.kind} boost. Press Esc to exit or keep clicking.`);
  };

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

    if (this.editSession) {
      this.revertPreview();
      this.closeEditSession();
      this.updateHud(TOOL_HINTS[this.activeTool]);
      return;
    }

    this.exit();
  };

  private handlePointerMove = (event: MouseEvent): void => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!(target instanceof Element)) {
      this.clearHighlight();
      return;
    }

    const candidate = this.findBoostTarget(target);
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

    if (this.activeTool === "remove") {
      await this.performRemove(target, event.shiftKey);
      this.clearHighlight();
      return;
    }

    this.cancelEditSession();
    if (this.activeTool === "text") {
      this.openTextEditor(target);
    } else {
      this.openStyleEditor(this.activeTool, target);
    }
    this.clearHighlight();
  };

  private findBoostTarget(start: Element): Element | null {
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
    this.hudText = null;
    this.hudUndo = null;
    this.editorPanel = null;
    this.tabButtons = {};
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

const picker = new BoostPicker();
let currentRules: BoostRule[] = [];
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

function buildRuleCss(rules: BoostRule[]): string {
  const blocks: string[] = [];

  for (const rule of rules) {
    switch (rule.type) {
      case "remove": {
        if (isSelectorValid(rule.selector)) {
          blocks.push(`${rule.selector} { display: none !important; }`);
        }
        break;
      }
      case "recolor": {
        if (rule.scope === "page") {
          if (rule.backgroundColor) {
            blocks.push(`html, body { background-color: ${rule.backgroundColor} !important; }`);
          }
          if (rule.textColor) {
            blocks.push(`html, html * { color: ${rule.textColor} !important; }`);
          }
        } else if (isSelectorValid(rule.selector)) {
          const decls: string[] = [];
          if (rule.textColor) {
            decls.push(`color: ${rule.textColor} !important;`);
          }
          if (rule.backgroundColor) {
            decls.push(`background-color: ${rule.backgroundColor} !important;`);
          }
          if (decls.length > 0) {
            blocks.push(`${rule.selector} { ${decls.join(" ")} }`);
          }
        }
        break;
      }
      case "font": {
        if (rule.scope === "page") {
          blocks.push(`html, html * { font-family: ${rule.fontFamily} !important; }`);
        } else if (isSelectorValid(rule.selector)) {
          blocks.push(`${rule.selector} { font-family: ${rule.fontFamily} !important; }`);
        }
        break;
      }
      case "text":
        break;
    }
  }

  return blocks.join("\n");
}

function applyTextRules(rules: BoostRule[]): void {
  for (const rule of rules) {
    if (rule.type !== "text" || !isSelectorValid(rule.selector)) {
      continue;
    }

    document.querySelectorAll(rule.selector).forEach((element) => {
      if (element.textContent !== rule.newText) {
        element.textContent = rule.newText;
      }
    });
  }
}

async function refreshAppliedRules(): Promise<void> {
  const siteKey = getSiteKeyFromUrl(window.location.href);
  const allRules = await getAllBoostRules();
  currentRules = allRules.filter((rule) => rule.siteKey === siteKey);
  ensureStyleElement().textContent = buildRuleCss(currentRules);
  applyTextRules(currentRules);
}

function installMutationObserver(): void {
  if (mutationObserver) {
    return;
  }

  mutationObserver = new MutationObserver(() => {
    ensureStyleElement();
    applyTextRules(currentRules);
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

function initializeContentScript(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[BOOST_STORAGE_KEY]) {
      return;
    }

    void refreshAppliedRules();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      const typedMessage = message as BackgroundToContentMessage;

      switch (typedMessage.type) {
        case "PING":
          sendResponse({ success: true });
          return;
        case "ENTER_BOOST_MODE":
          picker.enter();
          sendResponse({ success: true });
          return;
        case "EXIT_BOOST_MODE":
          picker.exit();
          sendResponse({ success: true });
          return;
        case "REFRESH_BOOSTS":
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
}

if (!window[INITIALIZED_FLAG]) {
  window[INITIALIZED_FLAG] = true;
  initializeContentScript();
} else {
  void refreshAppliedRules();
}
