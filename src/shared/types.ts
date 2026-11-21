export type BoostType = "remove" | "recolor" | "font" | "text" | "style" | "css";
export type BoostScope = "element" | "page";
export type TextAlign = "left" | "center" | "right" | "justify";

export interface StyleValues {
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  padding?: number;
  borderRadius?: number;
  opacity?: number;
  textAlign?: TextAlign;
}

interface BoostRuleBase {
  id: string;
  siteKey: string;
  selector: string;
  label: string;
  createdAt: string;
  pageUrl: string;
  pageTitle: string;
}

export interface RemoveBoostRule extends BoostRuleBase {
  type: "remove";
}

export interface RecolorBoostRule extends BoostRuleBase {
  type: "recolor";
  scope: BoostScope;
  textColor?: string;
  backgroundColor?: string;
}

export interface FontBoostRule extends BoostRuleBase {
  type: "font";
  scope: BoostScope;
  fontFamily: string;
}

export interface TextBoostRule extends BoostRuleBase {
  type: "text";
  originalText: string;
  newText: string;
}

export interface StyleBoostRule extends BoostRuleBase, StyleValues {
  type: "style";
  scope: BoostScope;
}

export interface CssBoostRule extends BoostRuleBase {
  type: "css";
  css: string;
}

export type BoostRule =
  | RemoveBoostRule
  | RecolorBoostRule
  | FontBoostRule
  | TextBoostRule
  | StyleBoostRule
  | CssBoostRule;

interface CreateBoostPayloadBase {
  selector: string;
  label: string;
  pageUrl: string;
  pageTitle: string;
}

export type CreateBoostPayload =
  | (CreateBoostPayloadBase & { type: "remove" })
  | (CreateBoostPayloadBase & {
      type: "recolor";
      scope: BoostScope;
      textColor?: string;
      backgroundColor?: string;
    })
  | (CreateBoostPayloadBase & { type: "font"; scope: BoostScope; fontFamily: string })
  | (CreateBoostPayloadBase & { type: "text"; originalText: string; newText: string })
  | (CreateBoostPayloadBase & { type: "style"; scope: BoostScope } & StyleValues)
  | (CreateBoostPayloadBase & { type: "css"; css: string });

export interface ListBoostsPayload {
  siteKey?: string;
}

export interface RestoreBoostPayload {
  id: string;
  tabId?: number;
}

export interface RestoreSiteBoostsPayload {
  siteKey: string;
  tabId?: number;
}

export interface SiteSummary {
  siteKey: string;
  count: number;
  latestCreatedAt: string;
}

export interface CommandResult {
  success: boolean;
  error?: string;
}

export interface CreateBoostResponse extends CommandResult {
  rule?: BoostRule;
}

export interface ListBoostsResponse extends CommandResult {
  siteRules: BoostRule[];
  siteSummaries: SiteSummary[];
}

export interface ImportableBoostRule {
  siteKey: string;
  selector: string;
  label: string;
  type?: string;
  scope?: string;
  textColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  originalText?: string;
  newText?: string;
  fontSize?: unknown;
  fontWeight?: unknown;
  lineHeight?: unknown;
  letterSpacing?: unknown;
  padding?: unknown;
  borderRadius?: unknown;
  opacity?: unknown;
  textAlign?: unknown;
  css?: string;
  pageUrl?: string;
  pageTitle?: string;
  createdAt?: string;
}

export interface ImportBoostsPayload {
  rules: ImportableBoostRule[];
}

export interface ImportBoostsResponse extends CommandResult {
  addedCount: number;
  skippedCount: number;
}

export interface RestoreBoostResponse extends CommandResult {
  removed: boolean;
}

export interface RestoreAllBoostsResponse extends CommandResult {
  removedCount: number;
}

export interface UpdateBoostPayload {
  id: string;
  values: Record<string, unknown>;
  tabId?: number;
}

export interface UpdateBoostResponse extends CommandResult {
  rule?: BoostRule;
}

export interface ActiveTabContext {
  tabId: number;
  url: string;
  title: string;
  siteKey: string;
}

export type PopupToBackgroundMessage =
  | { type: "ENTER_BOOST_MODE"; payload: { tabId: number } }
  | { type: "EXIT_BOOST_MODE"; payload: { tabId: number } }
  | { type: "LIST_BOOSTS"; payload: ListBoostsPayload }
  | { type: "RESTORE_BOOST"; payload: RestoreBoostPayload }
  | { type: "RESTORE_SITE_BOOSTS"; payload: RestoreSiteBoostsPayload }
  | { type: "RESTORE_ALL_BOOSTS"; payload: Record<string, never> }
  | { type: "IMPORT_BOOSTS"; payload: ImportBoostsPayload }
  | { type: "UPDATE_BOOST"; payload: UpdateBoostPayload };

export type ContentToBackgroundMessage = {
  type: "CREATE_BOOST";
  payload: CreateBoostPayload;
};

export type RuntimeMessage = PopupToBackgroundMessage | ContentToBackgroundMessage;

export type BackgroundToContentMessage =
  | { type: "ENTER_BOOST_MODE" }
  | { type: "EXIT_BOOST_MODE" }
  | { type: "REFRESH_BOOSTS" }
  | { type: "PING" };
