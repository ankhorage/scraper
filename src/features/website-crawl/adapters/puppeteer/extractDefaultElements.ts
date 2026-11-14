import type { ElementObservation } from '../../../../types/public.js';

/*** Extract the immutable default DOM state before dynamic viewport activation can mutate it. */
export const extractDefaultElements = (): readonly ElementObservation[] =>
  [...document.querySelectorAll('body *')].map(globalThis.__ankhorageScraperExtractElement);
