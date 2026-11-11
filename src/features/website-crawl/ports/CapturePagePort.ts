import type { CrawlViewport, PageObservation } from '../../../types/public.js';

export interface CapturePageInput {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly url: string;
  readonly viewport: CrawlViewport;
}

export interface CapturePagePort {
  readonly capturePageAsync: (input: CapturePageInput) => Promise<PageObservation>;
  readonly closeAsync: () => Promise<void>;
}
