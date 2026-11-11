import type { RobotsPort } from '../../ports/RobotsPort.js';

/*** Create a robots.txt adapter that denies a page only when an explicit rule disallows it. */
export const createRobotsPort = (): RobotsPort => ({
  isAllowedAsync: async (url: string): Promise<boolean> => {
    const robotsUrl = new URL('/robots.txt', url).href;

    try {
      const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return true;
      return !isDisallowed(await response.text(), new URL(url).pathname);
    } catch {
      return true;
    }
  },
});

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
