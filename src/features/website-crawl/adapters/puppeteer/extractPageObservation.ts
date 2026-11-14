import type {
  DynamicElementEvidence,
  ElementObservation,
  PageObservation,
} from '../../../../types/public.js';

interface BrowserExtractionInput {
  readonly dynamicElements: readonly DynamicElementEvidence[];
  readonly elements: readonly ElementObservation[];
  readonly statusCode: number;
  readonly viewport: { readonly height: number; readonly id: string; readonly width: number };
}

/*** Combine browser facts already captured at their owning observation stages into one page result. */
export const extractPageObservation = (input: BrowserExtractionInput): PageObservation => ({
  assets: [...document.querySelectorAll('img, video, audio, source')]
    .map((node) => node.getAttribute('src'))
    .filter((source): source is string => source !== null)
    .map((source) => new URL(source, location.href).href)
    .sort(),
  dynamicElements: input.dynamicElements,
  elements: input.elements,
  links: [...document.querySelectorAll('a[href]')]
    .map((node) => node.getAttribute('href'))
    .filter((href): href is string => href !== null)
    .map((href) => new URL(href, location.href).href)
    .sort(),
  statusCode: input.statusCode,
  title: document.title,
  url: location.href,
  viewport: input.viewport,
});
