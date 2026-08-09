export type ZapStrategy = "css-hide";

export interface ZapRule {
  id: string;
  siteKey: string;
  selector: string;
  label: string;
  createdAt: string;
  pageUrl: string;
  pageTitle: string;
  strategy: ZapStrategy;
}

export interface CreateZapPayload {
  selector: string;
  label: string;
  pageUrl: string;
  pageTitle: string;
}

export interface ListZapsPayload {
  siteKey?: string;
}

export interface RestoreZapPayload {
  id: string;
  tabId?: number;
}

export interface RestoreSiteZapsPayload {
  siteKey: string;
  tabId?: number;
}

export interface SiteSummary {
  siteKey: string;
  count: number;
  latestCreatedAt: string;
}

export interface ListZapsResponse {
  siteRules: ZapRule[];
  siteSummaries: SiteSummary[];
}

export interface ImportableZapRule {
  siteKey: string;
  selector: string;
  label: string;
  pageUrl?: string;
  pageTitle?: string;
  createdAt?: string;
}

export interface ImportZapsPayload {
  rules: ImportableZapRule[];
}

export interface ImportZapsResponse {
  addedCount: number;
  skippedCount: number;
}

export interface RestoreAllZapsResponse {
  removedCount: number;
}

export interface ActiveTabContext {
  tabId: number;
  url: string;
  title: string;
  siteKey: string;
}

export interface CommandResult {
  success: boolean;
  error?: string;
}

export type PopupToBackgroundMessage =
  | { type: "ENTER_ZAP_MODE"; payload: { tabId: number } }
  | { type: "EXIT_ZAP_MODE"; payload: { tabId: number } }
  | { type: "LIST_ZAPS"; payload: ListZapsPayload }
  | { type: "RESTORE_ZAP"; payload: RestoreZapPayload }
  | { type: "RESTORE_SITE_ZAPS"; payload: RestoreSiteZapsPayload }
  | { type: "RESTORE_ALL_ZAPS"; payload: Record<string, never> }
  | { type: "IMPORT_ZAPS"; payload: ImportZapsPayload };

export type ContentToBackgroundMessage = {
  type: "CREATE_ZAP";
  payload: CreateZapPayload;
};

export type BackgroundToContentMessage =
  | { type: "ENTER_ZAP_MODE" }
  | { type: "EXIT_ZAP_MODE" }
  | { type: "REFRESH_ZAPS" }
  | { type: "PING" };
