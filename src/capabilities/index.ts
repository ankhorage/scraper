import type { Capability } from '@ankhorage/contracts/capability';

/*** Publish the executable Scraper capability used by Ankh provider discovery. */
export const CAPABILITIES = [
  {
    id: 'scraper.crawl',
    owner: '@ankhorage/scraper',
    access: ['invoke'],
    binding: { kind: 'action', bindableAs: ['target'] },
    label: 'Crawl website',
    description: 'Capture bounded browser observations for a public website.',
  },
] as const satisfies readonly Capability[];
