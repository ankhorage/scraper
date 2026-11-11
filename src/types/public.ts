export interface CrawlViewport {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface CrawlOptions {
  readonly url: string;
  readonly maxDepth?: number;
  readonly maxPages?: number;
  readonly maxBytesPerPage?: number;
  readonly navigationTimeoutMs?: number;
  readonly viewports?: readonly CrawlViewport[];
}

import type { WebsiteComputedCss, WebsiteObservationDocument } from '@ankhorage/contracts/website';

export type CssObservation = WebsiteComputedCss;

export interface ElementObservation {
  readonly attributes: Readonly<Record<string, string>>;
  readonly css: CssObservation;
  readonly id: string;
  readonly parentId?: string;
  readonly rect: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly tagName: string;
  readonly text: string;
  readonly visible: boolean;
}

export interface PageObservation {
  readonly assets: readonly string[];
  readonly elements: readonly ElementObservation[];
  readonly links: readonly string[];
  readonly statusCode: number;
  readonly title: string;
  readonly url: string;
  readonly viewport: CrawlViewport;
}

export interface CrawlDiagnostic {
  readonly code: 'blocked' | 'robots' | 'unreachable' | 'limit';
  readonly url: string;
}

export type CrawlResult = WebsiteObservationDocument;
