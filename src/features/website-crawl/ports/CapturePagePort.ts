import type { BreakpointEvidence, CrawlViewport, PageObservation } from '../../../types/public.js';

export interface CapturePageInput {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly url: string;
  readonly viewport: CrawlViewport;
}

export interface CapturePagePort {
  readonly capturePageAsync: (input: CapturePageInput) => Promise<PageObservation>;
  readonly discoverBreakpointsAsync?: (input: {
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly url: string;
  }) => Promise<readonly BreakpointEvidence[]>;
  readonly closeAsync: () => Promise<void>;
}
