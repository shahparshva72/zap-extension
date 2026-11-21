import "./styles.css";

import { FONT_PRESETS } from "../shared/fonts";
import {
  boostRowCopyMarkup,
  describeBoostRule,
  escapeHtml,
  formatDate,
  truncate,
  TYPE_LABELS,
  ZAP_ICON_SVG,
} from "../shared/format";
import {
  CUSTOM_CSS_UNSAFE_MESSAGE,
  isEditableBoost,
  isSafeCssValue,
  isSafeCustomCss,
} from "../shared/rules";
import { BOOST_STORAGE_KEY } from "../shared/storage";
import {
  FONT_WEIGHT_OPTIONS,
  formatStyleReadout,
  STYLE_NUMERIC_PROPS,
  TEXT_ALIGN_LABEL,
  TEXT_ALIGN_VALUES,
} from "../shared/style";
import type {
  BoostRule,
  BoostType,
  CommandResult,
  ImportBoostsResponse,
  ImportableBoostRule,
  ListBoostsResponse,
  RestoreAllBoostsResponse,
  StyleValues,
  TextAlign,
} from "../shared/types";

const TYPE_FILTER_OPTIONS: Array<{ value: "all" | BoostType; label: string }> = [
  { value: "all", label: "All types" },
  { value: "remove", label: "Zap" },
  { value: "recolor", label: "Recolor" },
  { value: "font", label: "Font" },
  { value: "text", label: "Text" },
  { value: "style", label: "Style" },
  { value: "css", label: "CSS" },
];

let allRules: BoostRule[] = [];
let pausedSites: string[] = [];
let searchQuery = "";
let typeFilter: "all" | BoostType = "all";
let isBusy = false;
let editingId: string | null = null;
// Set when storage changes while an editor is open; the list reloads once it closes.
let pendingReload = false;
let renderedSnapshot = "";

async function sendRuntimeMessage<TResponse extends CommandResult>(
  message: object,
): Promise<TResponse> {
  const response = (await chrome.runtime.sendMessage(message)) as TResponse | undefined;
  if (!response?.success) {
    throw new Error(response?.error || "The extension hit an unexpected error. Please try again.");
  }
  return response;
}

function reportError(error: unknown, fallback: string): void {
  console.warn("[Zap] Manage action failed.", error);
  setStatusMessage(error instanceof Error ? error.message : fallback, "error");
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

  const typeSelect = document.getElementById("type-filter") as HTMLSelectElement | null;
  if (typeSelect) {
    typeSelect.disabled = isBusy;
  }

  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      ".boost-editor input, .boost-editor textarea, .boost-editor select, .boost-switch",
    )
    .forEach((control) => {
      control.disabled = isBusy;
    });

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

function matchesQuery(rule: BoostRule, query: string): boolean {
  if (!query) {
    return true;
  }

  const extra =
    rule.type === "recolor"
      ? `${rule.textColor ?? ""} ${rule.backgroundColor ?? ""}`
      : rule.type === "font"
        ? rule.fontFamily
        : rule.type === "text"
          ? `${rule.originalText} ${rule.newText}`
          : rule.type === "style"
            ? describeBoostRule(rule)
            : rule.type === "css"
              ? rule.css
              : "";

  const haystack = `${rule.siteKey} ${rule.label} ${rule.selector} ${extra}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesTypeFilter(rule: BoostRule): boolean {
  return typeFilter === "all" || rule.type === typeFilter;
}

function groupBySite(rules: BoostRule[]): Map<string, BoostRule[]> {
  const groups = new Map<string, BoostRule[]>();

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

function createRuleRowMarkup(rule: BoostRule): string {
  const editButton = isEditableBoost(rule)
    ? `<button class="ghost-button" type="button" data-edit-id="${rule.id}">Edit</button>`
    : "";
  return `
    <li class="row${editingId === rule.id ? " row--editing" : ""}${rule.disabled ? " row--off" : ""}" data-rule-id="${rule.id}">
      <input type="checkbox" class="boost-switch" data-toggle-id="${rule.id}" aria-label="Boost on"
        title="Turn this boost on or off" ${rule.disabled ? "" : "checked"} />
      <div class="row-copy">
        ${boostRowCopyMarkup(rule)}
      </div>
      ${editButton}
      <button class="ghost-button" type="button" data-restore-id="${rule.id}">Restore</button>
    </li>
  `;
}

function createSiteGroupMarkup(siteKey: string, rules: BoostRule[]): string {
  const paused = pausedSites.includes(siteKey);
  return `
    <section class="site-group">
      <div class="section-head">
        <span class="section-title"><span class="site-name" title="${escapeHtml(siteKey)}">${escapeHtml(siteKey)}</span> <span class="count">${rules.length}</span>${
          paused ? ` <span class="type-badge">Paused</span>` : ""
        }</span>
        <span class="section-actions">
          <button class="text-button" type="button" data-pause-site="${escapeHtml(siteKey)}">${
            paused ? "Resume site" : "Pause site"
          }</button>
          <button class="text-button" type="button" data-restore-site="${escapeHtml(siteKey)}">Restore all</button>
        </span>
      </div>
      <ul class="row-list${paused ? " dimmed" : ""}">${rules.map(createRuleRowMarkup).join("")}</ul>
    </section>
  `;
}

type CollectResult = { values: Record<string, unknown> } | { error: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function labeledCheckbox(labelText: string, checked: boolean): {
  row: HTMLDivElement;
  label: HTMLLabelElement;
  toggle: HTMLInputElement;
} {
  const row = el("div", "edit-row");
  const label = el("label", "edit-label");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = checked;
  label.append(toggle, document.createTextNode(` ${labelText}`));
  row.append(label);
  return { row, label, toggle };
}

// The color swatch is a convenience; the text input holds the actual value and accepts
// any CSS color, so it is the source of truth. They stay in sync both ways.
function createColorEditRow(
  labelText: string,
  initial: string | undefined,
  fallback: string,
): { row: HTMLDivElement; read: () => string | undefined } {
  const { row, toggle } = labeledCheckbox(labelText, initial !== undefined);

  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = /^#[0-9a-f]{6}$/i.test(initial ?? "") ? (initial as string) : fallback;
  picker.className = "edit-color";

  const text = document.createElement("input");
  text.type = "text";
  text.className = "edit-input";
  text.value = initial ?? fallback;

  picker.addEventListener("input", () => {
    text.value = picker.value;
    toggle.checked = true;
  });
  text.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) {
      picker.value = text.value.trim();
    }
    toggle.checked = true;
  });

  row.append(picker, text);
  return { row, read: () => (toggle.checked ? text.value.trim() : undefined) };
}

function buildEditorForm(
  rule: BoostRule,
  editor: HTMLDivElement,
): { collect: () => CollectResult } {
  if (rule.type === "recolor") {
    const textRow = createColorEditRow("Text color", rule.textColor, "#000000");
    const bgRow = createColorEditRow("Background", rule.backgroundColor, "#ffffff");
    editor.append(textRow.row, bgRow.row);
    return {
      collect: () => {
        const textColor = textRow.read();
        const backgroundColor = bgRow.read();
        if (!textColor && !backgroundColor) {
          return { error: "Turn on at least one color." };
        }
        for (const value of [textColor, backgroundColor]) {
          if (value && !(isSafeCssValue(value) && CSS.supports("color", value))) {
            return { error: `"${truncate(value, 40)}" isn't a usable CSS color.` };
          }
        }
        return { values: { textColor, backgroundColor } };
      },
    };
  }

  if (rule.type === "font") {
    const row = el("div", "edit-row");
    const label = el("label", "edit-label", "Font");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = rule.fontFamily;
    const datalistId = `font-presets-${rule.id}`;
    input.setAttribute("list", datalistId);
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    for (const preset of FONT_PRESETS) {
      const option = document.createElement("option");
      option.value = preset.value;
      option.label = preset.label;
      datalist.append(option);
    }
    row.append(label, input, datalist);
    editor.append(row);
    return {
      collect: () => {
        const fontFamily = input.value.trim();
        if (!fontFamily) {
          return { error: "Enter a font before saving." };
        }
        if (!(isSafeCssValue(fontFamily) && CSS.supports("font-family", fontFamily))) {
          return { error: "That isn't a valid CSS font list. Try something like: Georgia, serif" };
        }
        return { values: { fontFamily } };
      },
    };
  }

  if (rule.type === "text") {
    editor.append(el("div", "edit-note", `Original: "${truncate(rule.originalText, 80)}"`));
    const textarea = document.createElement("textarea");
    textarea.className = "edit-input";
    textarea.rows = 3;
    textarea.value = rule.newText;
    editor.append(textarea);
    return {
      collect: () =>
        textarea.value.trim()
          ? { values: { newText: textarea.value } }
          : { error: "Enter some text before saving." },
    };
  }

  if (rule.type === "style") {
    const entries: Array<{ read: () => [string, unknown] | null }> = [];

    for (const spec of STYLE_NUMERIC_PROPS) {
      if (rule.scope === "page" && !spec.pageScope) {
        continue;
      }
      const current = rule[spec.key];
      const { row, toggle } = labeledCheckbox(spec.label, typeof current === "number");

      let control: HTMLInputElement | HTMLSelectElement;
      if (spec.key === "fontWeight") {
        const select = document.createElement("select");
        select.className = "edit-input";
        for (const option of FONT_WEIGHT_OPTIONS) {
          const item = document.createElement("option");
          item.value = String(option.value);
          item.textContent = `${option.label} ${option.value}`;
          select.append(item);
        }
        select.value = String(current ?? spec.fallback);
        control = select;
      } else {
        const range = document.createElement("input");
        range.type = "range";
        range.min = String(spec.min);
        range.max = String(spec.max);
        range.step = String(spec.step);
        range.value = String(current ?? spec.fallback);
        control = range;
      }

      const readout = el("span", "edit-readout", formatStyleReadout(spec, Number(control.value)));
      const sync = () => {
        toggle.checked = true;
        readout.textContent = formatStyleReadout(spec, Number(control.value));
      };
      control.addEventListener("input", sync);
      control.addEventListener("change", sync);

      row.append(control, readout);
      editor.append(row);
      entries.push({ read: () => (toggle.checked ? [spec.key, Number(control.value)] : null) });
    }

    {
      const { row, toggle } = labeledCheckbox(TEXT_ALIGN_LABEL, Boolean(rule.textAlign));
      const select = document.createElement("select");
      select.className = "edit-input";
      for (const value of TEXT_ALIGN_VALUES) {
        const item = document.createElement("option");
        item.value = value;
        item.textContent = value[0].toUpperCase() + value.slice(1);
        select.append(item);
      }
      select.value = rule.textAlign ?? "left";
      const readout = el("span", "edit-readout", select.value);
      const sync = () => {
        toggle.checked = true;
        readout.textContent = select.value;
      };
      select.addEventListener("input", sync);
      select.addEventListener("change", sync);
      row.append(select, readout);
      editor.append(row);
      entries.push({ read: () => (toggle.checked ? ["textAlign", select.value as TextAlign] : null) });
    }

    return {
      collect: () => {
        const values: StyleValues = {};
        for (const entry of entries) {
          const pair = entry.read();
          if (pair) {
            (values as Record<string, unknown>)[pair[0]] = pair[1];
          }
        }
        return Object.keys(values).length > 0
          ? { values: values as Record<string, unknown> }
          : { error: "Turn on at least one setting." };
      },
    };
  }

  if (rule.type === "css") {
    const textarea = document.createElement("textarea");
    textarea.className = "edit-input edit-css";
    textarea.rows = 12;
    textarea.spellcheck = false;
    textarea.value = rule.css;
    // Tab inside the stylesheet indents instead of moving focus out of the editor.
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      const { selectionStart: start, selectionEnd: end } = textarea;
      textarea.value = `${textarea.value.slice(0, start)}  ${textarea.value.slice(end)}`;
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    });
    editor.append(textarea);
    return {
      collect: () => {
        const css = textarea.value;
        if (!css.trim()) {
          return { error: "Custom CSS can't be empty. Use Restore to remove it." };
        }
        if (!isSafeCustomCss(css)) {
          return { error: CUSTOM_CSS_UNSAFE_MESSAGE };
        }
        return { values: { css } };
      },
    };
  }

  return { collect: () => ({ error: "This boost type has nothing to edit." }) };
}

function mountEditor(rule: BoostRule, li: HTMLLIElement): void {
  li.querySelector(".boost-editor")?.remove();

  const editor = el("div", "boost-editor");
  const scope = "scope" in rule && rule.scope === "page" ? "Whole page" : rule.selector;
  editor.append(el("div", "boost-editor-head", `Editing · ${rule.siteKey} · ${scope}`));

  const { collect } = buildEditorForm(rule, editor);

  const actions = el("div", "edit-actions");
  const save = el("button", "toolbar-button", "Save");
  const cancel = el("button", "ghost-button", "Cancel");
  actions.append(save, cancel);
  editor.append(actions);
  li.append(editor);

  save.addEventListener("click", async () => {
    const result = collect();
    if ("error" in result) {
      setStatusMessage(result.error, "error");
      return;
    }

    setBusy(true);
    try {
      await sendRuntimeMessage({
        type: "UPDATE_BOOST",
        payload: { id: rule.id, values: result.values },
      });
      editingId = null;
      pendingReload = false;
      await loadRules(true);
      setStatusMessage("Saved changes.");
    } catch (error) {
      reportError(error, "That boost could not be saved.");
    } finally {
      setBusy(false);
    }
  });

  cancel.addEventListener("click", () => {
    dismissEditor();
  });
}

function dismissEditor(): void {
  const hadEditor = editingId !== null;
  editingId = null;
  if (pendingReload) {
    pendingReload = false;
    void loadRules(true).catch((error) => reportError(error, "Saved boosts could not be loaded."));
    return;
  }
  if (hadEditor) {
    renderList();
  }
}

function renderList(): void {
  const list = document.getElementById("rule-groups");
  if (!list) {
    return;
  }

  const totalCount = document.getElementById("total-count");
  if (totalCount) {
    totalCount.textContent = `${allRules.length} saved`;
  }

  if (allRules.length === 0) {
    list.innerHTML = `<p class="empty">No boosts saved anywhere yet.</p>`;
    syncControlAvailability();
    return;
  }

  const filtered = allRules.filter(
    (rule) => matchesTypeFilter(rule) && matchesQuery(rule, searchQuery),
  );
  if (filtered.length === 0) {
    list.innerHTML = `<p class="empty">Nothing matches the current filters.</p>`;
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

  if (editingId) {
    const rule = allRules.find((entry) => entry.id === editingId);
    const li = rule
      ? list.querySelector<HTMLLIElement>(`li[data-rule-id="${rule.id}"]`)
      : null;
    if (rule && li) {
      mountEditor(rule, li);
    } else if (!rule) {
      editingId = null;
    }
  }
}

function attachRowHandlers(): void {
  document.querySelectorAll<HTMLInputElement>("[data-toggle-id]").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.dataset.toggleId;
      if (!id) {
        return;
      }

      dismissEditor();
      setBusy(true);
      try {
        await sendRuntimeMessage({
          type: "SET_BOOST_ENABLED",
          payload: { id, enabled: input.checked },
        });
        await loadRules();
        setStatusMessage(input.checked ? "Boost turned on." : "Boost turned off.");
      } catch (error) {
        reportError(error, "That boost could not be updated.");
      } finally {
        setBusy(false);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-pause-site]").forEach((button) => {
    button.addEventListener("click", async () => {
      const siteKey = button.dataset.pauseSite;
      if (!siteKey) {
        return;
      }

      const pausing = !pausedSites.includes(siteKey);
      dismissEditor();
      setBusy(true);
      setStatusMessage(pausing ? `Pausing boosts for ${siteKey}…` : `Resuming boosts for ${siteKey}…`);
      try {
        await sendRuntimeMessage({
          type: "SET_SITE_PAUSED",
          payload: { siteKey, paused: pausing },
        });
        await loadRules();
        setStatusMessage(
          pausing ? `Boosts paused on ${siteKey}.` : `Boosts resumed on ${siteKey}.`,
        );
      } catch (error) {
        reportError(error, `Boosts for ${siteKey} could not be updated.`);
      } finally {
        setBusy(false);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.editId;
      const rule = allRules.find((entry) => entry.id === id);
      if (!rule) {
        return;
      }
      // One editor at a time; clicking Edit on the open row closes it.
      if (editingId === rule.id) {
        dismissEditor();
      } else {
        editingId = rule.id;
        setStatusMessage("Ready.");
        renderList();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-restore-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.restoreId;
      if (!id) {
        return;
      }

      setBusy(true);
      setStatusMessage("Restoring…");
      try {
        await sendRuntimeMessage({ type: "RESTORE_BOOST", payload: { id } });
        await loadRules();
        setStatusMessage("Restored.");
      } catch (error) {
        reportError(error, "That boost could not be restored.");
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
        await sendRuntimeMessage({ type: "RESTORE_SITE_BOOSTS", payload: { siteKey } });
        await loadRules();
        setStatusMessage(`Restored everything for ${siteKey}.`);
      } catch (error) {
        reportError(error, `Boosts for ${siteKey} could not be restored.`);
      } finally {
        setBusy(false);
      }
    });
  });
}

async function loadRules(force = false): Promise<void> {
  const data = await sendRuntimeMessage<ListBoostsResponse>({
    type: "LIST_BOOSTS",
    payload: {},
  });
  // An action reloads the list itself and then storage reports the same change; the
  // second pass would rebuild every row for nothing.
  const snapshot = JSON.stringify([data.siteRules, data.pausedSites]);
  if (snapshot === renderedSnapshot && !force) {
    return;
  }
  renderedSnapshot = snapshot;
  allRules = data.siteRules;
  pausedSites = data.pausedSites;
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

function parseImportFile(raw: string): ImportableBoostRule[] {
  const parsed: unknown = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { rules?: unknown })?.rules)
      ? (parsed as { rules: unknown[] }).rules
      : null;

  if (!list) {
    throw new Error('Expected a JSON array of boosts, or an object with a "rules" array.');
  }

  return list
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      siteKey: typeof entry.siteKey === "string" ? entry.siteKey : "",
      disabled: typeof entry.disabled === "boolean" ? entry.disabled : undefined,
      selector: typeof entry.selector === "string" ? entry.selector : "",
      label: typeof entry.label === "string" ? entry.label : "",
      type: typeof entry.type === "string" ? entry.type : undefined,
      scope: typeof entry.scope === "string" ? entry.scope : undefined,
      textColor: typeof entry.textColor === "string" ? entry.textColor : undefined,
      backgroundColor: typeof entry.backgroundColor === "string" ? entry.backgroundColor : undefined,
      fontFamily: typeof entry.fontFamily === "string" ? entry.fontFamily : undefined,
      originalText: typeof entry.originalText === "string" ? entry.originalText : undefined,
      newText: typeof entry.newText === "string" ? entry.newText : undefined,
      fontSize: typeof entry.fontSize === "number" ? entry.fontSize : undefined,
      fontWeight: typeof entry.fontWeight === "number" ? entry.fontWeight : undefined,
      lineHeight: typeof entry.lineHeight === "number" ? entry.lineHeight : undefined,
      letterSpacing: typeof entry.letterSpacing === "number" ? entry.letterSpacing : undefined,
      padding: typeof entry.padding === "number" ? entry.padding : undefined,
      borderRadius: typeof entry.borderRadius === "number" ? entry.borderRadius : undefined,
      opacity: typeof entry.opacity === "number" ? entry.opacity : undefined,
      textAlign: typeof entry.textAlign === "string" ? entry.textAlign : undefined,
      css: typeof entry.css === "string" ? entry.css : undefined,
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
          placeholder="Search by site, label, selector, or value"
          autocomplete="off"
        />
        <select id="type-filter" class="toolbar-button">
          ${TYPE_FILTER_OPTIONS.map(
            (option) => `<option value="${option.value}">${option.label}</option>`,
          ).join("")}
        </select>
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
  // Re-rendering a few hundred rows on every keystroke makes typing lag, so wait for a
  // short pause instead.
  let searchTimer: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchQuery = searchInput.value;
      dismissEditor();
      renderList();
    }, 120);
  });

  const typeSelect = document.getElementById("type-filter") as HTMLSelectElement;
  typeSelect.addEventListener("change", () => {
    typeFilter = typeSelect.value as "all" | BoostType;
    dismissEditor();
    renderList();
  });

  document.getElementById("export-button")?.addEventListener("click", () => {
    downloadJson(`zap-boosts-${new Date().toISOString().slice(0, 10)}.json`, allRules);
    setStatusMessage(`Exported ${pluralize(allRules.length, "boost")}.`);
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
      const result = await sendRuntimeMessage<ImportBoostsResponse>({
        type: "IMPORT_BOOSTS",
        payload: { rules },
      });
      await loadRules();
      setStatusMessage(
        result.skippedCount > 0
          ? `Imported ${pluralize(result.addedCount, "boost")}, skipped ${result.skippedCount} invalid ${
              result.skippedCount === 1 ? "entry" : "entries"
            }.`
          : `Imported ${pluralize(result.addedCount, "boost")}.`,
      );
    } catch (error) {
      reportError(error, "That file could not be imported.");
    } finally {
      setBusy(false);
    }
  });

  document.getElementById("restore-everything")?.addEventListener("click", async () => {
    if (!window.confirm("Restore every saved boost across every site? This cannot be undone.")) {
      return;
    }

    setBusy(true);
    setStatusMessage("Restoring everything…");
    try {
      const result = await sendRuntimeMessage<RestoreAllBoostsResponse>({
        type: "RESTORE_ALL_BOOSTS",
        payload: {},
      });
      await loadRules();
      setStatusMessage(`Restored ${pluralize(result.removedCount, "boost")}.`);
    } catch (error) {
      reportError(error, "Boosts could not be restored.");
    } finally {
      setBusy(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[BOOST_STORAGE_KEY]) {
      return;
    }
    // Don't blow away in-progress edits; reload once the editor closes instead.
    if (editingId) {
      pendingReload = true;
      return;
    }
    void loadRules().catch((error) => reportError(error, "Saved boosts could not be loaded."));
  });

  void (async () => {
    await loadRules().catch((error) => reportError(error, "Saved boosts could not be loaded."));

    // manage.html?edit=<id> opens that rule's editor (e.g. from the popup's Edit link).
    const editId = new URLSearchParams(window.location.search).get("edit");
    const target = editId ? allRules.find((entry) => entry.id === editId) : undefined;
    if (target && isEditableBoost(target)) {
      editingId = target.id;
      renderList();
      document
        .querySelector(`li[data-rule-id="${target.id}"]`)
        ?.scrollIntoView({ block: "center" });
    }
  })();
}

render();
