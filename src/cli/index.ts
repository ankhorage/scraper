import { readFileSync } from 'node:fs';

import type { AnkhRuntimeCommandProvider } from '@ankhorage/ankh';

import { CAPABILITIES } from '../capabilities/index.js';
import { crawl } from './commands/crawl.js';

const provider = {
  id: '@ankhorage/scraper',
  category: 'scraper',
  version: readPackageVersion(),
  capabilities: CAPABILITIES,
  commands: [
    {
      path: ['crawl'],
      capability: 'scraper.crawl',
      summary: 'Capture bounded browser observations for a public website.',
    },
  ],
  handlers: [
    {
      path: ['crawl'],
      handler: async ({ argv, context }) => await crawl(argv, context),
    },
  ],
} satisfies AnkhRuntimeCommandProvider;

export default provider;

/*** Read the package version that is published with this provider module. */
function readPackageVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  if (!isRecord(parsed) || typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json must define a non-empty version.');
  }
  return parsed.version;
}

/*** Narrow JSON input to a non-null record without accepting arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
