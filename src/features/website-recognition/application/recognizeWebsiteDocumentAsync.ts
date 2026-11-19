import type {
  WebsiteObservationDocument,
  WebsiteRecognitionDocument,
} from '@ankhorage/contracts/website';

/*** Invoke the published Rules Design recognition entrypoint without duplicating its classification policy. */
export const recognizeWebsiteDocumentAsync = async (
  document: WebsiteObservationDocument,
): Promise<WebsiteRecognitionDocument> => {
  const entrypoint = import.meta.resolve('@ankhorage/rules-design');
  const rulesDesign: unknown = await import(entrypoint);
  if (!isRulesDesignModule(rulesDesign))
    throw new TypeError('Rules Design does not expose recognizeWebsiteDocument.');
  return rulesDesign.recognizeWebsiteDocument(document);
};

/*** Validate the required published recognition function at the package boundary. */
const isRulesDesignModule = (
  value: unknown,
): value is {
  readonly recognizeWebsiteDocument: (
    document: WebsiteObservationDocument,
  ) => WebsiteRecognitionDocument;
} =>
  typeof value === 'object' &&
  value !== null &&
  'recognizeWebsiteDocument' in value &&
  typeof value.recognizeWebsiteDocument === 'function';
