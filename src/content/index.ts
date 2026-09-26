import { getSiteKeyFromUrl, isSafeCssValue } from "../shared/rules";
import { buildElementLabel, buildElementSelector } from "../shared/selector";
import { BOOST_STORAGE_KEY, getAllBoostRules } from "../shared/storage";
import type {
  BackgroundToContentMessage,
  BoostRule,
  BoostScope,
  BoostType,
  CreateBoostPayload,
  CreateBoostResponse,
} from "../shared/types";

const OVERLAY_ROOT_ATTRIBUTE = "data-zap-extension-root";
const STYLE_ELEMENT_ID = "zap-extension-style";
const HIGHLIGHT_ID = "zap-extension-highlight";
const HUD_ID = "zap-extension-hud";
const PREVIEW_STYLE_ID = "zap-extension-preview-style";
const HIGHLIGHT_FILL = "linear-gradient(135deg, rgba(255, 140, 66, 0.22), rgba(255, 219, 168, 0.16))";
const HIGHLIGHT_SHADOW = "0 0 0 1px rgba(255,255,255,0.25), 0 18px 40px rgba(26, 17, 10, 0.28)";

// While picking, these never reach the page, so sites that act on pointerdown/mousedown
// (common in React apps and search results) don't navigate or open menus mid-pick.
const SUPPRESSED_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick", "dblclick"];
const FONT_DATALIST_ID = "zap-extension-font-presets";
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
  originalText: string;
  // Only true when the editor offers a text field; otherwise the element's text is never
  // written, so a container whose content changes on its own is never flattened.
  editsText: boolean;
}

type PendingAction =
  | { kind: "remove"; ruleId: string | null; element: Element; originalStyle: string | null }
  | {
      kind: "edit";
      ruleIds: string[];
      textRestore: { target: Element; text: string } | null;
    };

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

interface ParsedColor {
  hex: string;
  alpha: number;
}

function parseComputedColor(value: string): ParsedColor | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    return null;
  }

  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) {
    return null;
  }

  const hex = parts
    .slice(0, 3)
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("");
  return { hex: `#${hex}`, alpha: parts[3] ?? 1 };
}

function textColorHex(element: Element): string {
  return parseComputedColor(getComputedStyle(element).color)?.hex ?? "#000000";
}

/**
 * The background the user actually sees behind an element: a transparent element shows
 * its nearest painted ancestor, so start the picker from that rather than black.
 */
function visibleBackgroundHex(element: Element): string {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const parsed = parseComputedColor(getComputedStyle(current).backgroundColor);
    if (parsed && parsed.alpha > 0) {
      return parsed.hex;
    }
  }
  return "#ffffff";
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
  initiallyOn = false,
): { row: HTMLDivElement; toggle: HTMLInputElement; color: HTMLInputElement } {
  const row = document.createElement("div");
  styleFormRow(row);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = initiallyOn;

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

/**
 * Text boosts replace an element's whole text, which would flatten a container's markup
 * (a card's heading, links, and so on), so only offer it on a single label.
 */
function canEditLabelText(element: Element): boolean {
  return element.children.length === 0 && Boolean(element.textContent?.trim());
}

function createLabelTextRow(
  target: Element,
): { row: HTMLDivElement; input: HTMLTextAreaElement | null } {
  const row = document.createElement("div");
  row.style.marginTop = "10px";

  const heading = document.createElement("div");
  heading.textContent = "Label text";
  heading.style.fontSize = "11px";
  heading.style.marginBottom = "4px";
  row.append(heading);

  if (!canEditLabelText(target)) {
    const hint = document.createElement("div");
    hint.textContent = "Pick a single label (not a container) to change its text.";
    hint.style.fontSize = "10px";
    hint.style.opacity = "0.6";
    row.append(hint);
    return { row, input: null };
  }

  const input = document.createElement("textarea");
  input.value = target.textContent ?? "";
  input.rows = 2;
  styleTextInput(input);
  input.addEventListener("input", () => {
    target.textContent = input.value;
  });
  row.append(input);
  return { row, input };
}

function buildTextPayload(
  selector: string,
  label: string,
  displayedText: string,
  newText: string,
): CreateBoostPayload {
  // Re-editing an already edited label replaces its rule, so keep the text the site
  // actually renders; otherwise the new rule would never match after a reload.
  const existing = currentRules.find((rule) => rule.type === "text" && rule.selector === selector);
  return {
    type: "text",
    selector,
    label,
    pageUrl: window.location.href,
    pageTitle: document.title,
    originalText: existing?.type === "text" ? existing.originalText : displayedText,
    newText,
  };
}

async function restoreRule(id: string): Promise<void> {
  await chrome.runtime
    .sendMessage({ type: "RESTORE_BOOST", payload: { id } })
    .catch(() => undefined);
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

function createFontDatalist(): HTMLDataListElement {
  const datalist = document.createElement("datalist");
  datalist.id = FONT_DATALIST_ID;
  for (const preset of FONT_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.value;
    option.label = preset.label;
    datalist.append(option);
  }

  return datalist;
}

const SAVE_FAILED_MESSAGE = "That boost could not be saved. Please try again.";

async function createBoost(payload: CreateBoostPayload): Promise<CreateBoostResponse> {
  const response = (await chrome.runtime
    .sendMessage({ type: "CREATE_BOOST", payload })
    .catch(() => null)) as CreateBoostResponse | null;
  return response?.success ? response : { success: false, error: response?.error };
}

function isApplicableCssValue(property: string, value: string | undefined): value is string {
  return isSafeCssValue(value) && CSS.supports(property, value);
}

// `:not(#id)` with an id that never exists adds ID-level specificity without changing what
// matches. Sites often style text with `!important` class rules (`.card .title { color:
// … !important }`), and a boost has to win over those to have any visible effect.
const SPECIFICITY_BOOST = ":not(#zap-boost):not(#zap-boost)";

function boosted(selector: string): string {
  return `:is(${selector})${SPECIFICITY_BOOST}`;
}

function recolorCss(
  selector: string,
  scope: BoostScope,
  textColor: string | undefined,
  backgroundColor: string | undefined,
): string {
  const blocks: string[] = [];
  const root = scope === "page" ? boosted("html") : boosted(selector);

  if (isApplicableCssValue("background-color", backgroundColor)) {
    // Clearing background-image too: a gradient or image is painted over background-color,
    // so without this the new color never shows on elements that use one.
    const target = scope === "page" ? boosted("html, body") : root;
    blocks.push(
      `${target} { background-color: ${backgroundColor} !important; background-image: none !important; }`,
    );
  }

  if (isApplicableCssValue("color", textColor)) {
    // Descendants too: headings, links and spans inside the element usually set their own
    // color, so recoloring only the element itself would leave most of its text unchanged.
    blocks.push(`${root}, ${root} * { color: ${textColor} !important; }`);
  }

  return blocks.join("\n");
}

function fontCss(selector: string, scope: BoostScope, fontFamily: string): string {
  if (!isApplicableCssValue("font-family", fontFamily)) {
    return "";
  }

  const target = scope === "page" ? `${boosted("html")}, ${boosted("html")} *` : boosted(selector);
  return `${target} { font-family: ${fontFamily} !important; }`;
}

function setPreviewCss(css: string): void {
  let preview = document.getElementById(PREVIEW_STYLE_ID);
  if (!css) {
    preview?.remove();
    return;
  }

  if (!preview) {
    preview = document.createElement("style");
    preview.id = PREVIEW_STYLE_ID;
    preview.setAttribute(OVERLAY_ROOT_ATTRIBUTE, "true");
  }
  // Last in the document so it wins over the saved boosts stylesheet at equal specificity.
  if (preview !== document.documentElement.lastElementChild) {
    document.documentElement.append(preview);
  }
  preview.textContent = css;
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
    window.addEventListener("click", this.handleClick, true);
    for (const type of SUPPRESSED_EVENTS) {
      window.addEventListener(type, this.suppressPageEvent, true);
    }
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
    window.removeEventListener("click", this.handleClick, true);
    for (const type of SUPPRESSED_EVENTS) {
      window.removeEventListener(type, this.suppressPageEvent, true);
    }
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
    // A closed shadow root keeps page CSS (including Zap's own whole-page `html *` rules)
    // from restyling the HUD, and keeps the page's scripts away from its markup.
    const shadow = root.attachShadow({ mode: "closed" });
    // Keystrokes typed into HUD fields shouldn't trigger the site's keyboard shortcuts.
    for (const type of ["keydown", "keyup", "keypress"]) {
      shadow.addEventListener(type, (event) => {
        if ((event as KeyboardEvent).key !== "Escape") {
          event.stopPropagation();
        }
      });
    }

    const highlight = document.createElement("div");
    highlight.id = HIGHLIGHT_ID;
    highlight.style.position = "fixed";
    highlight.style.pointerEvents = "none";
    highlight.style.border = "2px solid rgba(255, 140, 66, 0.95)";
    highlight.style.borderRadius = "18px";
    highlight.style.background = HIGHLIGHT_FILL;
    highlight.style.boxShadow = HIGHLIGHT_SHADOW;
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
    shadow.append(highlight, hud, createFontDatalist());

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

  private clearStylePreview(): void {
    setPreviewCss("");
    renderSavedCss(currentRules);
  }

  private revertPreview(): void {
    const session = this.editSession;
    if (!session) {
      return;
    }

    this.clearStylePreview();
    if (session.editsText && session.target.textContent !== session.originalText) {
      session.target.textContent = session.originalText;
    }
  }

  private closeEditSession(): void {
    this.editSession = null;
    this.clearHighlight();
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

  /**
   * Saves one or more boosts from an editor as a single step: if any fails, the ones already
   * saved are rolled back, and a single Undo reverts all of them.
   */
  private async commitEdits(payloads: CreateBoostPayload[], message: string): Promise<void> {
    const session = this.editSession;
    const ruleIds: string[] = [];

    for (const payload of payloads) {
      const response = await createBoost(payload);
      if (!response.rule) {
        await Promise.all(ruleIds.map(restoreRule));
        await refreshAppliedRules();
        this.revertPreview();
        this.closeEditSession();
        this.updateHud(response.error ?? SAVE_FAILED_MESSAGE);
        return;
      }
      ruleIds.push(response.rule.id);
    }

    await refreshAppliedRules();
    // Keep the previewed text in place: the saved text rule now matches it.
    this.clearStylePreview();
    this.closeEditSession();

    const textChanged =
      session !== null &&
      session.editsText &&
      session.target.textContent !== session.originalText;
    this.lastAction = {
      kind: "edit",
      ruleIds,
      textRestore: textChanged ? { target: session.target, text: session.originalText } : null,
    };
    this.showActionConfirmation(message, true);
  }

  private openStyleEditor(tool: "recolor" | "font", target: Element): void {
    const panel = this.editorPanel;
    if (!panel) {
      return;
    }

    // Read the starting values before anything about the page changes.
    const selector = buildElementSelector(target);
    const label = buildElementLabel(target);
    const startTextColor = textColorHex(target);
    const startBackground = visibleBackgroundHex(target);
    const startFont = getComputedStyle(target).fontFamily;
    const existing = currentRules.find(
      (rule) => rule.type === tool && rule.scope === "element" && rule.selector === selector,
    );

    this.editSession = {
      tool,
      target,
      originalText: target.textContent ?? "",
      editsText: canEditLabelText(target),
    };
    this.highlight(target, "selected");

    // Saving replaces this element's existing boost of the same type, so take it out of the
    // saved stylesheet while editing; the preview then shows exactly what Save will produce.
    if (existing) {
      renderSavedCss(currentRules.filter((rule) => rule.id !== existing.id));
    }

    this.hideUndo();
    this.updateHud(
      tool === "recolor"
        ? "Pick a text and/or background color, then Save."
        : "Pick a font, then Save.",
    );

    panel.innerHTML = "";
    panel.style.display = "block";

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

    const labelTextRow = createLabelTextRow(target);
    const originalText = target.textContent ?? "";
    const textChange = (): string | null => {
      const value = labelTextRow.input?.value;
      return value !== undefined && value !== originalText ? value : null;
    };
    const textPayloads = (newText: string | null): CreateBoostPayload[] =>
      newText === null ? [] : [buildTextPayload(selector, label, originalText, newText)];
    const savedMessage = (styleSaved: boolean, newText: string | null, scope: BoostScope) => {
      const parts = [styleSaved ? tool : "", newText !== null ? "text" : ""].filter(Boolean);
      return `Saved ${parts.join(" and ")} for "${labelFor(scope)}".`;
    };

    const scopeOf = (): BoostScope => (wholePageRow.toggle.checked ? "page" : "element");
    const selectorFor = (scope: BoostScope) => (scope === "page" ? "html" : selector);
    const labelFor = (scope: BoostScope) => (scope === "page" ? "Whole page" : label);

    if (tool === "recolor") {
      const existingRecolor = existing?.type === "recolor" ? existing : undefined;
      const textRow = createToggleColorRow(
        "Text color",
        existingRecolor?.textColor ?? startTextColor,
        Boolean(existingRecolor?.textColor),
      );
      const bgRow = createToggleColorRow(
        "Background",
        existingRecolor?.backgroundColor ?? startBackground,
        Boolean(existingRecolor?.backgroundColor),
      );
      const colors = () => ({
        textColor: textRow.toggle.checked ? textRow.color.value : undefined,
        backgroundColor: bgRow.toggle.checked ? bgRow.color.value : undefined,
      });

      const applyPreview = () => {
        const { textColor, backgroundColor } = colors();
        const scope = scopeOf();
        setPreviewCss(recolorCss(selectorFor(scope), scope, textColor, backgroundColor));
      };

      [wholePageRow.toggle, textRow.toggle, textRow.color, bgRow.toggle, bgRow.color].forEach(
        (input) => {
          input.addEventListener("input", applyPreview);
          input.addEventListener("change", applyPreview);
        },
      );

      panel.append(wholePageRow.row, textRow.row, bgRow.row, labelTextRow.row, actionsRow);
      applyPreview();

      saveButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const { textColor, backgroundColor } = colors();
        const newText = textChange();
        if (newText !== null && !newText.trim()) {
          this.updateHud("Enter some label text, or Cancel to keep the original.");
          return;
        }
        if (!textColor && !backgroundColor && newText === null) {
          this.updateHud("Turn on a color or change the label text before saving.");
          return;
        }

        const scope = scopeOf();
        const hasColors = Boolean(textColor || backgroundColor);
        const payloads: CreateBoostPayload[] = hasColors
          ? [
              {
                type: "recolor",
                selector: selectorFor(scope),
                label: labelFor(scope),
                pageUrl: window.location.href,
                pageTitle: document.title,
                scope,
                textColor,
                backgroundColor,
              },
            ]
          : [];
        await this.commitEdits(
          [...payloads, ...textPayloads(newText)],
          savedMessage(hasColors, newText, scope),
        );
      });
    } else {
      const fontRow = createFontRow(existing?.type === "font" ? existing.fontFamily : startFont);

      const applyPreview = () => {
        const scope = scopeOf();
        setPreviewCss(fontCss(selectorFor(scope), scope, fontRow.input.value.trim()));
      };

      [wholePageRow.toggle, fontRow.input].forEach((input) => {
        input.addEventListener("input", applyPreview);
        input.addEventListener("change", applyPreview);
      });

      panel.append(wholePageRow.row, fontRow.row, labelTextRow.row, actionsRow);
      applyPreview();

      saveButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const fontFamily = fontRow.input.value.trim();
        const newText = textChange();
        if (newText !== null && !newText.trim()) {
          this.updateHud("Enter some label text, or Cancel to keep the original.");
          return;
        }
        if (!fontFamily) {
          this.updateHud("Enter a font before saving.");
          return;
        }
        if (!isApplicableCssValue("font-family", fontFamily)) {
          this.updateHud("That isn't a valid CSS font list. Try something like: Georgia, serif");
          return;
        }

        const scope = scopeOf();
        await this.commitEdits(
          [
            {
              type: "font",
              selector: selectorFor(scope),
              label: labelFor(scope),
              pageUrl: window.location.href,
              pageTitle: document.title,
              scope,
              fontFamily,
            },
            ...textPayloads(newText),
          ],
          savedMessage(true, newText, scope),
        );
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
    this.editSession = { tool: "text", target, originalText, editsText: true };
    this.highlight(target, "selected");

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

      const label = buildElementLabel(target);
      await this.commitEdits(
        [buildTextPayload(buildElementSelector(target), label, originalText, newText)],
        `Saved text for "${label}".`,
      );
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
    const originalStyle = target.getAttribute("style");
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

      const response = await createBoost(payload);
      if (!response.rule) {
        this.updateHud(
          `${response.error ?? SAVE_FAILED_MESSAGE} Shift+click to remove it for this visit only.`,
        );
        return;
      }
      ruleId = response.rule.id;
    }

    // Hide rather than detach: removing the node would shift the positions that
    // `:nth-of-type` selectors (this one or earlier ones) rely on, hiding the wrong sibling.
    // A saved zap is hidden by its injected rule; a visit-only zap by an inline style.
    if (sessionOnly) {
      setImportantStyle(target, "display", "none");
    } else {
      await refreshAppliedRules();
    }

    this.lastAction = { kind: "remove", ruleId, element: target, originalStyle };
    this.showActionConfirmation(
      sessionOnly ? `Removed "${label}" for this visit.` : `Zapped "${label}".`,
      true,
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
        await restoreRule(pending.ruleId);
        await refreshAppliedRules();
      }

      restoreAttr(pending.element, pending.originalStyle);

      this.updateHud("Restored. Press Esc to exit or keep clicking to remove more.");
      return;
    }

    await Promise.all(pending.ruleIds.map(restoreRule));
    await refreshAppliedRules();

    if (pending.textRestore) {
      pending.textRestore.target.textContent = pending.textRestore.text;
    }

    this.updateHud("Undid the last change. Press Esc to exit or keep clicking.");
  };

  private handleViewportChange = (): void => {
    if (this.editSession) {
      this.highlight(this.editSession.target, "selected");
    } else if (this.highlightedElement) {
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
    // While editing, keep the outline locked on the element being edited so the hover
    // highlight doesn't cover up the live preview.
    if (this.editSession) {
      return;
    }

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

  private isOverlayEvent(event: Event): boolean {
    return this.overlayRoot !== null && event.composedPath().includes(this.overlayRoot);
  }

  private suppressPageEvent = (event: Event): void => {
    if (!this.active || this.isOverlayEvent(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  private handleClick = async (event: MouseEvent): Promise<void> => {
    if (!this.active || this.isOverlayEvent(event)) {
      return;
    }

    this.suppressPageEvent(event);

    // Hover tracking pauses while an editor is open, so resolve the click point directly;
    // clicking another element switches the editor to it.
    const pointed = document.elementFromPoint(event.clientX, event.clientY);
    const target = this.editSession
      ? pointed && this.findBoostTarget(pointed)
      : this.highlightedElement;
    if (!target) {
      return;
    }

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

  private highlight(element: Element, mode: "hover" | "selected" = "hover"): void {
    this.highlightedElement = mode === "hover" ? element : null;
    if (!this.highlightBox) {
      return;
    }

    // "selected" is an outline only: no tint or blur, so the preview colors read true.
    const selected = mode === "selected";
    this.highlightBox.style.borderStyle = selected ? "dashed" : "solid";
    this.highlightBox.style.borderRadius = selected ? "4px" : "18px";
    this.highlightBox.style.background = selected ? "transparent" : HIGHLIGHT_FILL;
    this.highlightBox.style.backdropFilter = selected ? "none" : "blur(2px)";
    this.highlightBox.style.boxShadow = selected ? "none" : HIGHLIGHT_SHADOW;

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

  // Rules are stored newest first; emit oldest first so that when two rules touch the same
  // element, the newer one comes later in the stylesheet and wins.
  for (const rule of [...rules].reverse()) {
    if (rule.type === "text" || !isSelectorValid(rule.selector)) {
      continue;
    }

    switch (rule.type) {
      case "remove":
        blocks.push(`${boosted(rule.selector)} { display: none !important; }`);
        break;
      case "recolor":
        blocks.push(recolorCss(rule.selector, rule.scope, rule.textColor, rule.backgroundColor));
        break;
      case "font":
        blocks.push(fontCss(rule.selector, rule.scope, rule.fontFamily));
        break;
    }
  }

  return blocks.filter(Boolean).join("\n");
}

function renderSavedCss(rules: BoostRule[]): void {
  ensureStyleElement().textContent = buildRuleCss(rules);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function applyTextRules(rules: BoostRule[]): void {
  for (const rule of rules) {
    if (rule.type !== "text" || !isSelectorValid(rule.selector)) {
      continue;
    }

    const originalText = normalizeText(rule.originalText);
    document.querySelectorAll(rule.selector).forEach((element) => {
      const current = element.textContent ?? "";
      if (current === rule.newText) {
        return;
      }
      // Only replace the text the rule was made for, so content the site has since
      // changed (a counter, a timestamp, a different item) isn't overwritten.
      if (originalText && normalizeText(current) !== originalText) {
        return;
      }
      element.textContent = rule.newText;
    });
  }
}

async function refreshAppliedRules(): Promise<void> {
  const siteKey = getSiteKeyFromUrl(window.location.href);
  const allRules = await getAllBoostRules();
  currentRules = allRules.filter((rule) => rule.siteKey === siteKey);
  renderSavedCss(currentRules);
  applyTextRules(currentRules);
}

function installMutationObserver(): void {
  if (mutationObserver) {
    return;
  }

  // Busy pages can fire thousands of mutations a second; coalesce them into at most one
  // re-apply per frame.
  let scheduled = false;
  mutationObserver = new MutationObserver(() => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureStyleElement();
      applyTextRules(currentRules);
    });
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    characterData: true,
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
