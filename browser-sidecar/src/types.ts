import type { Browser, BrowserContext, Page } from "playwright";
import type { StructuredLocator } from "./protocol.js";

export interface ManagedSession {
  sessionId: string;
  profileId: string;
  contextId: string;
  pageId: string;
  context: BrowserContext;
  browser?: Browser;
  page: Page;
  startedAt: string;
  closeAutomatically: boolean;
  consoleErrors: string[];
  failedNetworkRequests: string[];
  sensitiveLocators: StructuredLocator[];
  tracePath?: string;
}

export interface RecordedStep {
  id: string;
  action: string;
  name: string;
  configuration: Record<string, unknown>;
  sensitiveInputRequired?: boolean;
}
