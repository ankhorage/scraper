/*** Normalize a browser URL for deterministic queueing and observation identifiers. */
export const normalizeUrl = (input: string): string => {
  const url = new URL(input);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs can be crawled.');
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.href;
};
