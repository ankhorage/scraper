import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import type { CrawlResult } from '../../types/public.js';
import { crawl } from './crawl.js';

const invalidRequests = [
  ['--max-pages', '999999999999999999999999999999999999999999999999999999999999999999'],
  ['--max-pages', '1.5'],
  ['--max-depth', '-1'],
  ['--viewport', 'desktop:999999999999999999999999999999999999999999999999999999999999x900'],
  ['--viewport', 'desktop:1440x900', '--viewport', 'desktop:390x844'],
] as const;

for (const request of invalidRequests) {
  test(`rejects invalid crawl arguments before starting a crawl: ${request.join(' ')}`, async () => {
    const output = createContext();
    const result = await crawl(
      ['https://example.test/', ...request, '--output', 'crawl.json'],
      output,
    );

    expect(result.exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toHaveLength(1);
  });
}

test('summarizes many omitted responsive candidates while retaining JSON detail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scraper-cli-'));
  const output = createContext(directory);
  try {
    const result = await crawl(
      [
        'https://example.test/',
        '--output',
        'crawl.json',
        '--breakpoint-output',
        'breakpoints.json',
      ],
      output,
      {
        createWebsiteCrawler: () => ({
          crawlWebsiteAsync: () => Promise.resolve(responsiveCoverageResult),
        }),
      },
    );

    const breakpointOutput = JSON.parse(
      await readFile(join(directory, 'breakpoints.json'), 'utf8'),
    ) as { readonly breakpointCoverage: readonly { readonly omissions: readonly unknown[] }[] };
    expect(result.exitCode).toBe(0);
    expect(output.stderr).toHaveLength(1);
    expect(output.stderr[0]).toContain('Omitted regime (20): Candidate regime omitted.');
    expect(output.stderr[0]).toContain('Representative widths: 320, 321, 322, …px.');
    expect(output.stderr[0]).not.toContain('Width: 323px.');
    expect(breakpointOutput.breakpointCoverage[0]?.omissions).toHaveLength(20);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

const responsiveCoverageResult: CrawlResult = {
  breakpointCoverage: [
    {
      evidence: [],
      measurements: [],
      omissions: Array.from({ length: 20 }, (_, index) => ({
        reason: 'Candidate regime omitted.',
        width: index + 320,
      })),
      probes: [],
      sourceUrl: 'https://example.test/',
      uncertainty: [],
    },
  ],
  breakpointEvidence: [],
  diagnostics: [],
  document: {
    collectedAt: '2026-11-13T00:00:00.000Z',
    documentId: 'website:example',
    pages: [],
    schemaVersion: 1,
    site: { id: 'example', url: 'https://example.test/' },
    source: {
      crawlId: 'crawl:example',
      crawlerId: '@ankhorage/scraper',
      crawlerVersion: 'test',
      revision: null,
    },
  },
};

/*** Creates the command boundary context used to verify that rejected input has no crawl output. */
function createContext(cwd = '/tmp') {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    cwd,
    env: {},
    stderr,
    stdout,
    version: 'test',
    writeStderr: (value: string) => stderr.push(value),
    writeStdout: (value: string) => stdout.push(value),
  };
}
