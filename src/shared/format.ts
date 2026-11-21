import { describeStyleValues } from "./style";
import type { BoostRule, BoostType } from "./types";

export const TYPE_LABELS: Record<BoostType, string> = {
  remove: "Zap",
  recolor: "Recolor",
  font: "Font",
  text: "Text",
  style: "Style",
  css: "CSS",
};

export const ZAP_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h16L12 12h8L3 23l4-8H2L12 6H5z"/></svg>`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

// A label can be empty (an element with no text, or a hand-written import); the selector
// is the next most recognisable thing to show. The isolate marks keep a right-to-left
// label from reordering the values that follow it on the same line.
function ruleLabel(rule: BoostRule): string {
  return `\u2068${rule.label.trim() || rule.selector}\u2069`;
}

export function describeBoostRule(rule: BoostRule): string {
  switch (rule.type) {
    case "remove":
      return ruleLabel(rule);
    case "recolor": {
      const parts: string[] = [];
      if (rule.textColor) {
        parts.push(`text ${rule.textColor}`);
      }
      if (rule.backgroundColor) {
        parts.push(`bg ${rule.backgroundColor}`);
      }
      const scope = rule.scope === "page" ? "Whole page" : ruleLabel(rule);
      return parts.length > 0 ? `${scope} · ${parts.join(", ")}` : scope;
    }
    case "font": {
      const scope = rule.scope === "page" ? "Whole page" : ruleLabel(rule);
      return `${scope} · ${rule.fontFamily}`;
    }
    case "text":
      return `"${truncate(rule.originalText, 24)}" → "${truncate(rule.newText, 24)}"`;
    case "style": {
      const scope = rule.scope === "page" ? "Whole page" : ruleLabel(rule);
      return `${scope} · ${describeStyleValues(rule)}`;
    }
    case "css": {
      const lines = rule.css.split("\n").filter((line) => line.trim().length > 0).length;
      return `Custom CSS · ${lines} ${lines === 1 ? "line" : "lines"}`;
    }
  }
}

/**
 * Shared markup for a boost row's two text lines. Both are single-line and truncate, so
 * each carries its full value as a tooltip.
 */
export function boostRowCopyMarkup(rule: BoostRule): string {
  const description = escapeHtml(describeBoostRule(rule));
  const selector = escapeHtml(rule.selector);
  return `
    <p class="row-label" title="${description}"><span class="type-badge">${TYPE_LABELS[rule.type]}</span>${description}</p>
    <p class="row-meta" title="${selector}">${formatDate(rule.createdAt)} · <code>${selector}</code></p>
  `;
}
