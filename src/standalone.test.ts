import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

interface PackageManifest {
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly name: string;
  readonly version: string;
}

describe('packed consumer', () => {
  test(
    'imports the public API and type-checks a TypeScript consumer',
    testPackedConsumerAsync,
    60_000,
  );
});

const testPackedConsumerAsync = async (): Promise<void> => {
  const repositoryRoot = process.cwd();
  const manifest = await readPackageManifestAsync(join(repositoryRoot, 'package.json'));
  const archivePath = join(repositoryRoot, createArchiveName(manifest));
  const consumerDirectory = await mkdtemp(join(tmpdir(), 'ankhorage-scraper-consumer-'));

  try {
    await runCommandAsync(['bun', 'pm', 'pack'], repositoryRoot, consumerDirectory);
    await writeConsumerAsync(consumerDirectory, archivePath, manifest.devDependencies.typescript);
    await runCommandAsync(
      ['bun', 'install', '--ignore-scripts'],
      consumerDirectory,
      consumerDirectory,
    );
    await runCommandAsync(['bun', 'run', 'typecheck'], consumerDirectory, consumerDirectory);
    await runCommandAsync(['bun', 'run', 'runtime'], consumerDirectory, consumerDirectory);
  } finally {
    await rm(archivePath, { force: true });
    await rm(consumerDirectory, { force: true, recursive: true });
  }
};

const readPackageManifestAsync = async (path: string): Promise<PackageManifest> =>
  JSON.parse(await readFile(path, 'utf8')) as PackageManifest;

const createArchiveName = (manifest: PackageManifest): string =>
  `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`;

const writeConsumerAsync = async (
  directory: string,
  archivePath: string,
  typescriptVersion: string | undefined,
): Promise<void> => {
  if (!typescriptVersion)
    throw new Error('Expected the package to declare TypeScript for consumer validation.');

  await Promise.all([
    writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        dependencies: { '@ankhorage/scraper': `file:${archivePath}` },
        devDependencies: { typescript: typescriptVersion },
        name: 'scraper-packed-consumer',
        private: true,
        scripts: { runtime: 'bun run runtime.ts', typecheck: 'tsc --noEmit' },
        type: 'module',
      }),
    ),
    writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          target: 'ES2024',
        },
        include: ['consumer.ts'],
      }),
    ),
    writeFile(
      join(directory, 'consumer.ts'),
      "import { createWebsiteCrawler, type CrawlOptions, type CrawlResult } from '@ankhorage/scraper';\n\nconst options: CrawlOptions = { url: 'https://example.com' };\nconst crawler = createWebsiteCrawler();\nconst crawl: Promise<CrawlResult> = crawler.crawlWebsiteAsync(options);\n\nvoid crawl;\n",
    ),
    writeFile(
      join(directory, 'runtime.ts'),
      "import { createWebsiteCrawler } from '@ankhorage/scraper';\n\nconst crawler = createWebsiteCrawler();\nif (typeof crawler.crawlWebsiteAsync !== 'function') {\n  throw new Error('Expected the packed public crawler API.');\n}\n",
    ),
  ]);
};

const runCommandAsync = async (
  command: [string, ...string[]],
  cwd: string,
  temporaryDirectory: string,
): Promise<void> => {
  const result = Bun.spawn({
    cmd: command,
    cwd,
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: join(temporaryDirectory, 'bun-cache'),
      TMPDIR: join(temporaryDirectory, 'tmp'),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const exitCode = await result.exited;
  const output = `${await new Response(result.stdout).text()}${await new Response(result.stderr).text()}`;

  expect(exitCode, output).toBe(0);
};
