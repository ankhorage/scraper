import type { Page } from 'puppeteer';

import type {
  DynamicCaptureOptions,
  DynamicElementEvidence,
  DynamicElementSnapshot,
} from '../../../../types/public.js';

interface DynamicCaptureBudget {
  readonly overallMs: number;
  readonly perTargetMs: number;
  readonly quietMs: number;
  readonly targetLimit: number;
}

interface SettlingResult {
  readonly changed: boolean;
  readonly quiet: boolean;
  readonly timedOut: boolean;
}

interface CandidateSource {
  readonly priority: number;
  readonly sourceRef: string;
  readonly top: number;
}

const defaultBudget: DynamicCaptureBudget = {
  overallMs: 4_000,
  perTargetMs: 1_200,
  quietMs: 120,
  targetLimit: 24,
};

/*** Capture bounded viewport-activation evidence without treating a timeout as a settled value. */
export const captureDynamicElementsAsync = async (
  page: Page,
  timeoutMs: number,
  configured: DynamicCaptureOptions | undefined,
): Promise<readonly DynamicElementEvidence[]> => {
  const budget = toCaptureBudget(timeoutMs, configured);
  const startedAt = Date.now();
  const initialScroll = await page.evaluate(readScrollPosition);
  try {
    const candidates = await discoverCandidateSourceRefsAsync(page, budget.targetLimit);
    const evidence: DynamicElementEvidence[] = [];
    for (const sourceRef of candidates) {
      if (Date.now() - startedAt >= budget.overallMs) break;
      evidence.push(await captureCandidateEvidenceAsync(page, sourceRef, budget, startedAt));
    }
    return evidence;
  } finally {
    await page.evaluate(restoreScrollPosition, initialScroll);
  }
};

/*** Read the scroll origin so dynamic capture leaves the rendered page layout where it found it. */
const readScrollPosition = (): { readonly x: number; readonly y: number } => ({
  x: scrollX,
  y: scrollY,
});

/*** Restore the page origin after successful, timed-out, or failed candidate sampling. */
const restoreScrollPosition = ({ x, y }: { readonly x: number; readonly y: number }): void => {
  scrollTo(x, y);
};

/*** Fit dynamic work inside the caller's navigation budget while retaining explicit resource caps. */
const toCaptureBudget = (
  timeoutMs: number,
  configured: DynamicCaptureOptions | undefined,
): DynamicCaptureBudget => {
  const availableMs = Math.max(1, assertPositiveFiniteInteger(timeoutMs, 'timeoutMs') - 250);
  const overallMs = Math.min(
    assertPositiveFiniteInteger(
      configured?.overallTimeoutMs ?? defaultBudget.overallMs,
      'dynamicCapture.overallTimeoutMs',
    ),
    defaultBudget.overallMs,
    availableMs,
  );
  const perTargetMs = Math.min(
    assertPositiveFiniteInteger(
      configured?.perTargetTimeoutMs ?? defaultBudget.perTargetMs,
      'dynamicCapture.perTargetTimeoutMs',
    ),
    defaultBudget.perTargetMs,
    overallMs,
  );
  return {
    overallMs,
    perTargetMs,
    quietMs: Math.min(
      assertPositiveFiniteInteger(
        configured?.stabilityWindowMs ?? defaultBudget.quietMs,
        'dynamicCapture.stabilityWindowMs',
      ),
      defaultBudget.quietMs,
      perTargetMs,
    ),
    targetLimit: Math.min(
      assertPositiveFiniteInteger(
        configured?.maxCandidates ?? defaultBudget.targetLimit,
        'dynamicCapture.maxCandidates',
      ),
      defaultBudget.targetLimit,
    ),
  };
};

/*** Reject invalid public resource limits before they can weaken bounded browser capture. */
const assertPositiveFiniteInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite integer.`);
  }
  return value;
};

/*** Discover stable DOM references for prioritized animated candidates. */
const discoverCandidateSourceRefsAsync = async (
  page: Page,
  limit: number,
): Promise<readonly string[]> => page.evaluate(discoverCandidateSourceRefs, limit);

/*** Retain initial, activated, and defensibly settled snapshots for one candidate. */
const captureCandidateEvidenceAsync = async (
  page: Page,
  sourceRef: string,
  budget: DynamicCaptureBudget,
  startedAt: number,
): Promise<DynamicElementEvidence> => {
  const initial = await snapshotDynamicElementAsync(page, sourceRef);
  await activateViewportAsync(page, sourceRef);
  const triggered = await snapshotDynamicElementAsync(page, sourceRef);
  const remainingMs = budget.overallMs - (Date.now() - startedAt);
  const settling = await waitForSettlingAsync(
    page,
    sourceRef,
    budget.quietMs,
    Math.max(0, Math.min(remainingMs, budget.perTargetMs)),
  );
  const settled = await snapshotDynamicElementAsync(page, sourceRef);
  return toDynamicEvidence(sourceRef, initial, triggered, settled, settling);
};

/*** Extract one timestamped browser snapshot through the installed element extractor. */
const snapshotDynamicElementAsync = async (
  page: Page,
  sourceRef: string,
): Promise<DynamicElementSnapshot> => page.evaluate(snapshotDynamicElement, sourceRef);

/*** Scroll one candidate into the viewport and allow native intersection work through two frames. */
const activateViewportAsync = async (page: Page, sourceRef: string): Promise<void> => {
  await page.evaluate(activateViewport, sourceRef);
};

/*** Sample relevant geometry, semantics, and Web Animations state until locally quiet. */
const waitForSettlingAsync = async (
  page: Page,
  sourceRef: string,
  quietMs: number,
  timeoutMs: number,
): Promise<SettlingResult> => page.evaluate(waitForSettling, { quietMs, sourceRef, timeoutMs });

/*** Classify settling evidence without fabricating a value from an unchanged initial geometry. */
const toDynamicEvidence = (
  sourceRef: string,
  initial: DynamicElementSnapshot,
  triggered: DynamicElementSnapshot,
  settled: DynamicElementSnapshot,
  settling: SettlingResult,
): DynamicElementEvidence => {
  const changed = initial.element.rect.width !== triggered.element.rect.width || settling.changed;
  const explicitZero =
    settled.element.attributes['aria-valuenow'] === '0' ||
    (settled.element.tagName === 'progress' && settled.element.attributes.value === '0');
  const verified = changed || explicitZero;
  return {
    initial,
    outcome: verified && settling.quiet ? 'settled' : 'incomplete',
    reason:
      verified && settling.quiet
        ? null
        : settling.timedOut
          ? 'The activated element did not become stable within its bounded capture budget.'
          : 'Activation produced no observable change and no explicit semantic zero value.',
    settled: verified && settling.quiet ? settled : null,
    sourceRef,
    triggered,
  };
};

/*** Locate candidates without coupling the adapter to site-specific selectors. */
const discoverCandidateSourceRefs = (limit: number): readonly string[] => {
  const candidates = [...document.querySelectorAll('body *')]
    .filter((element) => !element.closest('header, footer'))
    .flatMap((element): CandidateSource[] => {
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        element.getBoundingClientRect().height <= 0
      ) {
        return [];
      }
      const className = element.getAttribute('class') ?? '';
      const priority = element.matches('progress, [role="progressbar"], [aria-valuenow]')
        ? 0
        : element
              .getAttributeNames()
              .some((name) => /^(data-(progress|count|value)|aria-valuenow)$/i.test(name))
          ? 1
          : /(?:progress|counter|reveal|animate|motion)/i.test(className)
            ? 2
            : style.animationName !== 'none'
              ? 3
              : style.transitionDuration !== '0s'
                ? 4
                : null;
      return priority === null
        ? []
        : [
            {
              priority,
              sourceRef: globalThis.__ankhorageScraperElementPath(element),
              top: element.getBoundingClientRect().top + scrollY,
            },
          ];
    });
  return [...new Map(candidates.map((candidate) => [candidate.sourceRef, candidate])).values()]
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Math.abs(left.top - scrollY) - Math.abs(right.top - scrollY) ||
        left.sourceRef.localeCompare(right.sourceRef),
    )
    .slice(0, limit)
    .map(({ sourceRef }) => sourceRef);
};

/*** Snapshot a single installed source reference in the page context. */
const snapshotDynamicElement = (sourceRef: string): DynamicElementSnapshot => {
  const element = globalThis.__ankhorageScraperFindElement(sourceRef);
  if (!element) throw new Error('Dynamic candidate disappeared before it could be captured.');
  return {
    capturedAt: new Date().toISOString(),
    element: globalThis.__ankhorageScraperExtractElement(element),
  };
};

/*** Trigger native viewport observers without invoking synthetic application events. */
const activateViewport = async (sourceRef: string): Promise<void> => {
  const element = globalThis.__ankhorageScraperFindElement(sourceRef);
  if (!element) throw new Error('Dynamic candidate disappeared before activation.');
  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
};

/*** Determine local stability with deterministic observer cleanup on both quiet and timeout paths. */
const waitForSettling = async ({
  quietMs,
  sourceRef,
  timeoutMs,
}: {
  readonly quietMs: number;
  readonly sourceRef: string;
  readonly timeoutMs: number;
}): Promise<SettlingResult> => {
  const element = globalThis.__ankhorageScraperFindElement(sourceRef);
  if (!element) return { changed: false, quiet: false, timedOut: false };
  const startedAt = performance.now();
  let changed = false;
  let lastChangeAt = startedAt;
  let previous = globalThis.__ankhorageScraperReadRelevantState(element);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => undefined);
    observer.observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const sample = () => {
      const now = performance.now();
      const current = globalThis.__ankhorageScraperReadRelevantState(element);
      const running = element
        .getAnimations({ subtree: true })
        .some(({ playState }) => playState === 'running');
      if (current !== previous) {
        changed = true;
        previous = current;
        lastChangeAt = now;
      }
      const quiet = !running && now - lastChangeAt >= quietMs;
      const timedOut = now - startedAt >= timeoutMs;
      if (quiet || timedOut) {
        observer.disconnect();
        return resolve({ changed, quiet, timedOut });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
};
