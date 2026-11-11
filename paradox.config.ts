import { defineParadoxConfig } from '@ankhorage/paradox';

export default defineParadoxConfig({
  mode: 'write',
  docs: {
    description: 'Safe, bounded browser observations for public websites.',
    title: '@ankhorage/scraper',
  },
  output: { dir: './paradox' },
  package: { entrypoints: ['src/index.ts'], root: '.' },
});
