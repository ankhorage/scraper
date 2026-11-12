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

/** Raw responsive evidence retained by the scraper outside the portable observation document. */
export interface BreakpointEvidence {
  readonly condition: string;
  readonly kind: 'container' | 'diagnostic' | 'viewport';
  readonly source: string;
  /** Canonical page URL whose CSSOM produced this evidence. */
  readonly sourceUrl: string;
}

/** A bounded browser probe of responsive facts, retained separately from full observations. */
export interface BreakpointProbe {
  readonly conditionMatches: readonly string[];
  readonly hasHorizontalOverflow: boolean;
  readonly layout: readonly string[];
  readonly navigation: readonly string[];
  readonly width: number;
}

/** Explain one full viewport measurement selected from verified responsive probes. */
export interface BreakpointMeasurement {
  readonly reason: string;
  readonly width: number;
}

/** Explain a candidate responsive state that was deliberately not fully measured. */
export interface BreakpointOmission {
  readonly reason: string;
  readonly width: number;
}

/** Per-page automatic-breakpoint provenance and bounded-coverage status. */
export interface BreakpointCoverage {
  readonly evidence: readonly BreakpointEvidence[];
  readonly measurements: readonly BreakpointMeasurement[];
  readonly omissions: readonly BreakpointOmission[];
  readonly probes: readonly BreakpointProbe[];
  readonly sourceUrl: string;
  readonly uncertainty: readonly string[];
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
  readonly code:
    | 'blocked'
    | 'robots'
    | 'unreachable'
    | 'limit'
    | 'redirect'
    | 'duplicate'
    | 'conflict'
    | 'breakpoint';
  readonly captureFingerprint?: string;
  readonly existingCaptureFingerprint?: string;
  readonly finalUrl?: string;
  readonly message: string;
  readonly sourceUrl: string;
  readonly url: string;
  readonly viewportId?: string;
}

export interface CrawlResult {
  readonly breakpointCoverage: readonly BreakpointCoverage[];
  readonly breakpointEvidence: readonly BreakpointEvidence[];
  readonly document: WebsiteObservationDocument;
  readonly diagnostics: readonly CrawlDiagnostic[];
}
