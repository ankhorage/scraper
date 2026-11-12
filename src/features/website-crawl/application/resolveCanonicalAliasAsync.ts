import type { CrawlDiagnostic, CrawlOptions, CrawlViewport } from '../../../types/public.js';
import { isSameOrigin } from '../domain/isSameOrigin.js';
import type { CapturePagePort } from '../ports/CapturePagePort.js';
import type { RobotsPort } from '../ports/RobotsPort.js';

interface ResolveCanonicalAliasInput {
  readonly canonicalViewportPlans: ReadonlyMap<
    string,
    readonly NonNullable<CrawlOptions['viewports']>[number][]
  >;
  readonly entry: { readonly sourceUrl: string; readonly url: string };
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly capturePage: CapturePagePort;
}

type CanonicalAliasResolution =
  | { readonly kind: 'blocked'; readonly finalUrl: string }
  | { readonly kind: 'capture'; readonly finalUrl: string }
  | { readonly kind: 'skip'; readonly finalUrl: string }
  | { readonly kind: 'fallback'; readonly message: string };

const identityViewport = { height: 900, id: 'identity', width: 1440 } as const;

/*** Resolve final URL identity and skip only aliases verified at every captured viewport. */
const resolveCanonicalAliasAsync = async ({
  canonicalViewportPlans,
  capturePage,
  entry,
  maxBytes,
  timeoutMs,
}: ResolveCanonicalAliasInput): Promise<CanonicalAliasResolution> => {
  const { resolvePageAsync } = capturePage;
  if (!resolvePageAsync) return { finalUrl: entry.url, kind: 'capture' };
  try {
    const identity = await resolvePageAsync({
      maxBytes,
      origin: new URL(entry.sourceUrl).origin,
      timeoutMs,
      url: entry.url,
      viewport: identityViewport,
    });
    if (!isSameOrigin(identity.url, new URL(entry.url).origin)) {
      return { finalUrl: identity.url, kind: 'blocked' };
    }
    const viewports = canonicalViewportPlans.get(identity.url);
    if (!viewports) return { finalUrl: identity.url, kind: 'capture' };
    const resolutions = await Promise.all(
      viewports.map((viewport) =>
        isIdentityViewport(viewport)
          ? Promise.resolve(identity)
          : resolvePageAsync({
              maxBytes,
              origin: new URL(entry.sourceUrl).origin,
              timeoutMs,
              url: entry.url,
              viewport,
            }),
      ),
    );
    return resolutions.every((resolution) => resolution.url === identity.url)
      ? { finalUrl: identity.url, kind: 'skip' }
      : { finalUrl: identity.url, kind: 'capture' };
  } catch (error) {
    return {
      kind: 'fallback',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/*** Record resolution provenance and return a canonical URL only when capture work remains. */
export const prepareCanonicalCaptureAsync = async ({
  canonicalViewportPlans,
  capturePage,
  diagnostics,
  entry,
  maxBytes,
  robots,
  redirects,
  timeoutMs,
}: ResolveCanonicalAliasInput & {
  readonly diagnostics: CrawlDiagnostic[];
  readonly redirects: Set<string>;
  readonly robots: RobotsPort;
}): Promise<string | undefined> => {
  const resolution = await resolveCanonicalAliasAsync({
    canonicalViewportPlans,
    capturePage,
    entry,
    maxBytes,
    timeoutMs,
  });
  if (resolution.kind === 'fallback') {
    return recordFallback(diagnostics, entry.sourceUrl, entry.url, resolution.message);
  }
  if (resolution.kind === 'blocked') {
    return recordBlocked(diagnostics, entry.sourceUrl, entry.url, resolution.finalUrl);
  }
  if (!(await robots.isAllowedAsync(resolution.finalUrl))) {
    return recordRobotsBlocked(diagnostics, entry.sourceUrl, entry.url, resolution.finalUrl);
  }
  recordRedirect(diagnostics, redirects, entry.sourceUrl, entry.url, resolution.finalUrl);
  if (resolution.kind === 'skip') {
    return recordSkippedAlias(diagnostics, entry.sourceUrl, entry.url, resolution.finalUrl);
  }
  return resolution.finalUrl;
};

/*** Preserve the regular capture pipeline when optional identity navigation is transiently unavailable. */
const recordFallback = (
  diagnostics: CrawlDiagnostic[],
  sourceUrl: string,
  url: string,
  message: string,
): string => {
  diagnostics.push({
    code: 'unreachable',
    message: `Identity navigation failed; continuing with the regular capture pipeline. ${message}`,
    sourceUrl,
    url,
  });
  return url;
};

/*** Refuse an alias whose resolved canonical target is disallowed by robots before capture. */
const recordRobotsBlocked = (
  diagnostics: CrawlDiagnostic[],
  sourceUrl: string,
  url: string,
  finalUrl: string,
): undefined => {
  diagnostics.push({
    code: 'robots',
    finalUrl,
    message: 'robots.txt disallowed the resolved redirect target.',
    sourceUrl,
    url,
  });
  return undefined;
};

/*** Record a final target outside the permitted crawl origin. */
const recordBlocked = (
  diagnostics: CrawlDiagnostic[],
  sourceUrl: string,
  url: string,
  finalUrl: string,
): undefined => {
  diagnostics.push({
    code: 'blocked',
    finalUrl,
    message: 'The final browser URL left the permitted crawl origin.',
    sourceUrl,
    url,
  });
  return undefined;
};

/*** Record each proven alias mapping once without inferring path equivalence. */
const recordRedirect = (
  diagnostics: CrawlDiagnostic[],
  redirects: Set<string>,
  sourceUrl: string,
  url: string,
  finalUrl: string,
): void => {
  if (url === finalUrl || redirects.has(`${url}\u0000${finalUrl}`)) return;
  redirects.add(`${url}\u0000${finalUrl}`);
  diagnostics.push({
    code: 'redirect',
    finalUrl,
    message: 'The requested URL redirected to the canonical final URL.',
    sourceUrl,
    url,
  });
};

/*** Explain that verified identity avoided every expensive responsive phase. */
const recordSkippedAlias = (
  diagnostics: CrawlDiagnostic[],
  sourceUrl: string,
  url: string,
  finalUrl: string,
): undefined => {
  diagnostics.push({
    code: 'duplicate',
    finalUrl,
    message: 'A verified redirect alias was skipped before responsive discovery and capture.',
    sourceUrl,
    url,
  });
  return undefined;
};

/*** Reuse the identity navigation when a full capture needs exactly the same viewport dimensions. */
const isIdentityViewport = (viewport: CrawlViewport): boolean =>
  viewport.width === identityViewport.width && viewport.height === identityViewport.height;
