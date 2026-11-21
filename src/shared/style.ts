import type { BoostScope, StyleValues, TextAlign } from "./types";

export type NumericStyleKey = Exclude<keyof StyleValues, "textAlign">;

export interface StylePropSpec {
  key: NumericStyleKey;
  property: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  pageScope: boolean;
  label: string;
}

// Single source of truth for the Style tool: validation, CSS output, the HUD editor,
// and descriptions all derive from this table. fontSize/padding/borderRadius/opacity
// are element-only because page-wide px overrides wreck layouts — the editor points
// users at browser zoom for whole-page text size instead.
export const STYLE_NUMERIC_PROPS: StylePropSpec[] = [
  { key: "fontSize", property: "font-size", unit: "px", min: 8, max: 96, step: 1, pageScope: false, label: "Size" },
  { key: "fontWeight", property: "font-weight", unit: "", min: 100, max: 900, step: 100, pageScope: true, label: "Weight" },
  { key: "lineHeight", property: "line-height", unit: "", min: 1, max: 3, step: 0.1, pageScope: true, label: "Line height" },
  { key: "letterSpacing", property: "letter-spacing", unit: "px", min: -2, max: 10, step: 0.5, pageScope: true, label: "Letter spacing" },
  { key: "padding", property: "padding", unit: "px", min: 0, max: 64, step: 1, pageScope: false, label: "Padding" },
  { key: "borderRadius", property: "border-radius", unit: "px", min: 0, max: 48, step: 1, pageScope: false, label: "Corners" },
  { key: "opacity", property: "opacity", unit: "", min: 0.1, max: 1, step: 0.05, pageScope: false, label: "Opacity" },
];

export const TEXT_ALIGN_VALUES: TextAlign[] = ["left", "center", "right", "justify"];
export const TEXT_ALIGN_LABEL = "Align";

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Keeps only keys the Style tool can express: finite numbers inside their spec range
 * (out-of-range is rejected, not clamped), a valid textAlign, and nothing marked
 * element-only when the scope is "page". Returns null when nothing survives.
 */
export function normalizeStyleValues(
  record: Record<string, unknown>,
  scope: BoostScope,
): StyleValues | null {
  const values: StyleValues = {};

  for (const spec of STYLE_NUMERIC_PROPS) {
    if (scope === "page" && !spec.pageScope) {
      continue;
    }
    const value = record[spec.key];
    if (typeof value === "number" && Number.isFinite(value) && value >= spec.min && value <= spec.max) {
      values[spec.key] = value;
    }
  }

  // textAlign is allowed at both scopes.
  if (TEXT_ALIGN_VALUES.includes(record.textAlign as TextAlign)) {
    values.textAlign = record.textAlign as TextAlign;
  }

  return Object.keys(values).length > 0 ? values : null;
}

/**
 * Turns validated style values into `!important` declarations. Values are only ever
 * numbers or a fixed textAlign enum, so there is no CSS-injection surface here.
 */
export function styleDeclarations(values: StyleValues): string {
  const declarations: string[] = [];

  for (const spec of STYLE_NUMERIC_PROPS) {
    const value = values[spec.key];
    if (typeof value === "number") {
      declarations.push(`${spec.property}: ${formatNumber(value)}${spec.unit} !important`);
    }
  }

  if (values.textAlign) {
    declarations.push(`text-align: ${values.textAlign} !important`);
  }

  return declarations.length > 0 ? `${declarations.join("; ")};` : "";
}

export function describeStyleValues(values: StyleValues): string {
  const parts: string[] = [];

  for (const spec of STYLE_NUMERIC_PROPS) {
    const value = values[spec.key];
    if (typeof value !== "number") {
      continue;
    }
    const formatted =
      spec.key === "opacity"
        ? `${formatNumber(value * 100)}%`
        : `${formatNumber(value)}${spec.unit}`;
    parts.push(`${spec.label.toLowerCase()} ${formatted}`);
  }

  if (values.textAlign) {
    parts.push(`align ${values.textAlign}`);
  }

  return parts.join(", ");
}
