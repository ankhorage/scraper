import type { Page } from 'puppeteer';

import type { DynamicElementSnapshot } from '../../../../types/public.js';

interface CapturedDynamicSnapshot {
  readonly relevantState: string;
  readonly snapshot: DynamicElementSnapshot;
}

/*** Capture one browser target together with the state used to classify observable animation. */
export const captureDynamicSnapshotAsync = async (
  page: Page,
  sourceRef: string,
): Promise<CapturedDynamicSnapshot> => page.evaluate(snapshotDynamicElement, sourceRef);

/*** Serialize browser-local animation evidence without representing pseudo-elements as DOM nodes. */
const snapshotDynamicElement = (sourceRef: string): CapturedDynamicSnapshot => {
  const element = globalThis.__ankhorageScraperFindElement(sourceRef);
  if (!element) throw new Error('Dynamic candidate disappeared before it could be captured.');
  return {
    relevantState: globalThis.__ankhorageScraperReadRelevantState(element),
    snapshot: {
      animationEvidence: globalThis.__ankhorageScraperExtractAnimationEvidence(element),
      capturedAt: new Date().toISOString(),
      element: globalThis.__ankhorageScraperExtractElement(element),
    },
  };
};
