import type {
  BreakpointEvidence,
  BreakpointProbe,
  CrawlViewport,
  PageObservation,
} from '../../../types/public.js';

export interface CapturePageInput {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly url: string;
  readonly viewport: CrawlViewport;
}

export interface ResolvePageInput {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly url: string;
  readonly viewport: CrawlViewport;
}

export interface CapturePagePort {
  readonly capturePageAsync: (input: CapturePageInput) => Promise<PageObservation>;
  /** Resolve a browser navigation without collecting CSSOM, probe, or full-page evidence. */
  readonly resolvePageAsync?: (input: ResolvePageInput) => Promise<{ readonly url: string }>;
  readonly discoverBreakpointsAsync?: (input: {
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly url: string;
  }) => Promise<readonly BreakpointEvidence[]>;
  readonly probeResponsiveAsync?: (input: {
    readonly conditions: readonly string[];
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly url: string;
    readonly widths: readonly number[];
  }) => Promise<readonly BreakpointProbe[]>;
  readonly closeAsync: () => Promise<void>;
}
