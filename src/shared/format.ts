import type { BoostRule, BoostType } from "./types";

export const TYPE_LABELS: Record<BoostType, string> = {
  remove: "Zap",
  recolor: "Recolor",
  font: "Font",
  text: "Text",
};

export const ZAP_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

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

export function describeBoostRule(rule: BoostRule): string {
  switch (rule.type) {
    case "remove":
      return rule.label;
    case "recolor": {
      const parts: string[] = [];
      if (rule.textColor) {
        parts.push(`text ${rule.textColor}`);
      }
      if (rule.backgroundColor) {
        parts.push(`bg ${rule.backgroundColor}`);
      }
      const scope = rule.scope === "page" ? "Whole page" : rule.label;
      return parts.length > 0 ? `${scope} · ${parts.join(", ")}` : scope;
    }
    case "font": {
      const scope = rule.scope === "page" ? "Whole page" : rule.label;
      return `${scope} · ${rule.fontFamily}`;
    }
    case "text":
      return `"${truncate(rule.originalText, 24)}" → "${truncate(rule.newText, 24)}"`;
  }
}
