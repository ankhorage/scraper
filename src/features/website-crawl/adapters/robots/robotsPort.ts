import type { RobotsPort } from '../../ports/RobotsPort.js';
import { assertPublicUrlAsync } from '../network/assertPublicUrlAsync.js';

/*** Create a robots.txt adapter that denies a page only when an explicit rule disallows it. */
export const createRobotsPort = (): RobotsPort => ({
  isAllowedAsync: async (url: string): Promise<boolean> => isAllowedByRobotsAsync(url),
});

/*** Fetch robots.txt only through individually validated, manually followed public redirects. */
const isAllowedByRobotsAsync = async (input: string): Promise<boolean> => {
  try {
    const pageUrl = await assertPublicUrlAsync(input);
    const response = await fetchPublicAsync(new URL('/robots.txt', pageUrl));
    return response.ok ? !isDisallowed(await response.text(), pageUrl.pathname) : true;
  } catch {
    return true;
  }
};

/*** Follow a bounded robots redirect chain while validating every next network target. */
const fetchPublicAsync = async (initialUrl: URL): Promise<Response> => {
  let url = initialUrl;
  for (const _ of Array.from({ length: 5 })) {
    await assertPublicUrlAsync(url.href);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = new URL(location, url);
  }
  throw new Error('robots.txt redirect limit exceeded');
};

/*** Match the user-agent-independent disallow rules applicable to this crawler. */
const isDisallowed = (robotsText: string, pathname: string): boolean => {
  const rules = robotsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^disallow\s*:/i.test(line))
    .map((line) => line.slice(line.indexOf(':') + 1).trim())
    .filter(Boolean);
  return rules.some((rule) => pathname.startsWith(rule));
};
