export type BoostType = "remove" | "recolor" | "font" | "text";
export type BoostScope = "element" | "page";

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

export type BoostRule = RemoveBoostRule | RecolorBoostRule | FontBoostRule | TextBoostRule;

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
  | (CreateBoostPayloadBase & { type: "text"; originalText: string; newText: string });

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
  | { type: "IMPORT_BOOSTS"; payload: ImportBoostsPayload };

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
