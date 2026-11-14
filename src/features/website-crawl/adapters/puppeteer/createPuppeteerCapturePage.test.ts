import { createServer } from 'node:http';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import type { DynamicCaptureOptions, PageObservation } from '../../../../types/public.js';
import { toWebsiteObservationDocument } from '../../application/toWebsiteObservationDocument.js';
import { createPuppeteerCapturePage } from './createPuppeteerCapturePage.js';

const transitionNoise = Array.from(
  { length: 30 },
  (_, index) => `<div class="noise">noise ${index}</div>`,
).join('');
const longUrlPath = `/source/${'a'.repeat(300)}?asset=${'b'.repeat(300)}`;

const fixtureBody = (url: string | undefined): string =>
  url === '/dynamic'
    ? `<style>
      body{margin:0}.noise{height:8px;transition:color 80ms linear}.spacer{height:900px}.header-spacer{height:1200px}
      .track{width:200px;height:20px;margin:16px 0}.rowgap{height:500px}.fill{width:0;height:20px;background:green;transition:width 80ms linear}.web{transform:scaleX(0);transition:transform 80ms linear}
      .pseudo::before{content:'';display:block;width:0;height:4px;background:blue;transition:width 80ms linear}.pseudo[data-state='done']::before{width:144px}
      .reveal{height:20px;opacity:0;transition:opacity 80ms linear}.hover-only:hover{opacity:.5}.stuck{animation:spin 2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    </style><header><div class="header-spacer"></div><div class="reveal" id="header-reveal">header reveal</div></header>${transitionNoise}<div class="spacer"></div>
    <div class="track" role="progressbar" aria-label="zero" aria-valuenow="0" value="0" id="zero"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="css" aria-valuemin="0" aria-valuemax="100" aria-valuenow="20" data-private-capture="never" id="css"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track pseudo web" role="progressbar" aria-label="web" aria-valuenow="40" id="web"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track progress bar" id="css-only"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="stuck" aria-valuenow="13" id="stuck"><div class="fill stuck"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="scroll-only" aria-valuenow="9" id="scroll-only"><span class="noise">unrelated mutation</span></div><div class="rowgap"></div>
    <div class="counter" data-count="0" id="counter">0</div><div class="rowgap"></div>
    <div class="reveal hover-only" id="hover-only">hover only</div>
    <div class="progress no-op" id="no-op">no op</div>
    <script>
      const activate=(entry)=>{if(!entry.isIntersecting)return;entry.target.dataset.seen='true';
        if(entry.target.id==='css'){entry.target.setAttribute('aria-valuenow','72');entry.target.setAttribute('aria-valuetext','72 percent');entry.target.firstElementChild.style.width='144px'}
        if(entry.target.id==='web'){entry.target.dataset.state='done';entry.target.style.transform='scaleX(1)'}
        if(entry.target.id==='css-only')entry.target.firstElementChild.style.width='144px'
        if(entry.target.id==='scroll-only')setTimeout(()=>entry.target.lastElementChild.textContent='changed but irrelevant',20)
        if(entry.target.id==='counter'){entry.target.dataset.count='72';entry.target.textContent='72'}
        if(entry.target.id==='header-reveal')entry.target.style.opacity='1';
      };
      const observer=new IntersectionObserver((entries)=>entries.forEach(activate));
      document.querySelectorAll('[role="progressbar"],.progress,.reveal,.counter').forEach((element)=>observer.observe(element));
    </script>`
    : url === '/about'
      ? '<title>About</title><main>About page</main>'
      : `<title>Fixture</title><nav><a href="/about">About</a><a href="${longUrlPath}">Long destination</a></nav><img src="${longUrlPath}" alt="Long asset"><section class="grid"><article>One <span style="color: red">red</span></article><article hidden>Hidden</article><article>Three</article></section>`;

const server = createServer((request, response) => {
  const body = fixtureBody(request.url);
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(
    `<!doctype html><html><head><style>.grid{display:grid;grid-template-columns:repeat(3,1fr)}[hidden]{display:none}</style></head><body>${body}</body></html>`,
  );
});

let origin = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture server');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(
  async () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

const captureFixtureAsync = async (
  path: string,
  viewport: { height: number; id: string; width: number },
  dynamicCapture?: DynamicCaptureOptions,
  timeoutMs = 10_000,
) => {
  const capture = await createPuppeteerCapturePage({
    allowPrivateHostsForTests: true,
    launchArguments: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-crash-reporter',
      '--single-process',
    ],
  });
  try {
    return await capture.capturePageAsync({
      ...(dynamicCapture ? { dynamicCapture } : {}),
      maxBytes: 100_000,
      timeoutMs,
      url: `${origin}${path}`,
      viewport,
    });
  } finally {
    await capture.closeAsync();
  }
};

/*** Assert the complete dynamic-state contract without relying on fixture DOM paths. */
const expectDynamicEvidence = (page: PageObservation): void => {
  const evidence = page.dynamicElements ?? [];
  const byLabel = (label: string) =>
    evidence.find((item) => item.initial.element.attributes['aria-label'] === label);

  expect(evidence.length).toBeGreaterThanOrEqual(6);
  expect(evidence.length).toBeLessThanOrEqual(24);
  expectProgressEvidence(byLabel);
  expectAuxiliaryDynamicEvidence(evidence, page);
};

/*** Assert progress evidence separately from other dynamic targets to keep fixture intent readable. */
const expectProgressEvidence = (
  byLabel: (label: string) => NonNullable<PageObservation['dynamicElements']>[number] | undefined,
): void => {
  expect(byLabel('zero')?.outcome).toBe('settled');
  expect(byLabel('css')?.initial.element.attributes['aria-valuenow']).toBe('20');
  expect(byLabel('css')?.settled?.element.attributes['aria-valuenow']).toBe('72');
  expect(byLabel('css')?.settled?.element.rect.width).toBe(200);
  expect(byLabel('web')?.outcome).toBe('settled');
  expectTransformAndPseudoEvidence(byLabel);
  expect(byLabel('stuck')?.outcome).toBe('incomplete');
  expect(byLabel('scroll-only')?.outcome).toBe('incomplete');
};

/*** Assert the transform and generated-element values retained beside a settled progress target. */
const expectTransformAndPseudoEvidence = (
  byLabel: (label: string) => NonNullable<PageObservation['dynamicElements']>[number] | undefined,
): void => {
  expect(byLabel('web')?.initial.animationEvidence.target.transform.value).toContain('0');
  expect(byLabel('web')?.settled?.animationEvidence.target.transform.value).toContain('1');
  expect(
    byLabel('web')?.settled?.animationEvidence.pseudoElements.find(
      (pseudo) => pseudo.pseudo === '::before',
    )?.boxSize.width.value,
  ).toBe('144px');
};

/*** Assert non-progress candidates and the captured pre-scroll baseline. */
const expectAuxiliaryDynamicEvidence = (
  evidence: readonly NonNullable<PageObservation['dynamicElements']>[number][],
  page: PageObservation,
): void => {
  expect(evidence.find((item) => item.initial.element.attributes.id === 'counter')?.outcome).toBe(
    'settled',
  );
  expect(evidence.find((item) => item.initial.element.attributes.id === 'css-only')?.outcome).toBe(
    'settled',
  );
  expect(
    evidence.find((item) => item.initial.element.attributes.id === 'header-reveal')?.outcome,
  ).toBe('settled');
  expect(
    evidence.find((item) => item.initial.element.attributes.id === 'hover-only')?.outcome,
  ).toBe('incomplete');
  expect(evidence.find((item) => item.initial.element.attributes.id === 'no-op')?.outcome).toBe(
    'incomplete',
  );
  expect(
    page.elements.find((element) => element.attributes.id === 'header-reveal')?.css.opacity,
  ).toBe('0');
};

/*** Assert canonical state-scoped semantic evidence without expanding the browser test callback. */
const expectCanonicalDynamicEvidence = (page: PageObservation): void => {
  const document = toWebsiteObservationDocument(`${origin}/dynamic`, [page]);
  const nodes = document.pages[0]?.nodes ?? [];
  const byLabel = (label: string) =>
    nodes.find((node) => node.dom.attributes['aria-label'] === label)?.observations;
  const state = (label: string, stateId: string) =>
    byLabel(label)?.find((observation) => observation.stateId === stateId);

  expect(state('css', 'initial')?.semanticAttributes).toEqual({
    'aria-label': 'css',
    'aria-valuemax': '100',
    'aria-valuemin': '0',
    'aria-valuenow': '20',
    role: 'progressbar',
  });
  expect(state('css', 'triggered')?.semanticAttributes?.['aria-valuenow']).toBe('72');
  expect(state('css', 'settled')?.semanticAttributes?.['aria-valuetext']).toBe('72 percent');
  expect(state('css', 'initial')?.semanticAttributes).not.toHaveProperty('aria-valuetext');
  expect(state('css', 'settled')?.semanticAttributes).not.toHaveProperty('data-private-capture');
  expect(state('zero', 'settled')?.semanticAttributes).toMatchObject({
    'aria-valuenow': '0',
    value: '0',
  });
  expect(state('scroll-only', 'incomplete')?.availability.status).toBe('missing');
  expect(state('scroll-only', 'incomplete')?.semanticAttributes).toEqual({});
  expect(state('scroll-only', 'incomplete')?.css).toBeNull();
  expect(state('scroll-only', 'incomplete')?.rect).toBeNull();
};

test('retains exact computed Grid tracks in raw responsive probes', async () => {
  const capture = await createPuppeteerCapturePage({
    allowPrivateHostsForTests: true,
    launchArguments: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-crash-reporter',
      '--single-process',
    ],
  });
  try {
    const probes = await capture.probeResponsiveAsync?.({
      conditions: [],
      maxBytes: 100_000,
      timeoutMs: 10_000,
      url: `${origin}/`,
      widths: [320, 1440],
    });
    const layouts = probes?.map((probe) =>
      probe.layout.find((layout) => layout.startsWith('SECTION:BODY:grid:')),
    );
    expect(layouts).toEqual([
      expect.stringMatching(/^SECTION:BODY:grid:[0-9.]+px [0-9.]+px [0-9.]+px:row:true$/u),
      expect.stringMatching(/^SECTION:BODY:grid:[0-9.]+px [0-9.]+px [0-9.]+px:row:true$/u),
    ]);
    expect(layouts?.[0]).not.toBe(layouts?.[1]);
  } finally {
    await capture.closeAsync();
  }
}, 15_000);

test('captures visible and hidden DOM state, computed CSS, and navigation', async () => {
  const page = await captureFixtureAsync('/', { height: 800, id: 'desktop', width: 1440 });
  const longUrl = `${origin}${longUrlPath}`;
  const document = toWebsiteObservationDocument(`${origin}/`, [page]);
  const [observedPage] = document.pages;

  expect(page.links).toEqual([`${origin}/about`, longUrl]);
  expect(page.elements.find((element) => element.text === 'red')?.css.color).toContain('255');
  expect(page.elements.find((element) => element.text === 'One ')?.tagName).toBe('article');
  expect(page.elements.find((element) => element.text === 'Hidden')?.visible).toBe(false);
  expect(page.elements.some((element) => element.css.display === 'grid')).toBe(true);
  expect(longUrl.length).toBeGreaterThan(256);
  expect(observedPage?.navigation.map((item) => item.url)).toContain(longUrl);
  expect(observedPage?.assets.map((asset) => asset.url)).toContain(longUrl);
  expect(observedPage?.nodes.flatMap((node) => node.media.map((media) => media.url))).toContain(
    longUrl,
  );
});

test.each([
  { height: 900, id: 'desktop', width: 1440 },
  { height: 700, id: 'tablet', width: 768 },
  { height: 400, id: 'narrow', width: 320 },
])(
  'captures prioritized dynamic evidence at $id viewport',
  async (viewport) => {
    const page = await captureFixtureAsync('/dynamic', viewport, {
      overallTimeoutMs: 2_500,
      perTargetTimeoutMs: 200,
      stabilityWindowMs: 20,
    });
    expectDynamicEvidence(page);

    expectCanonicalDynamicEvidence(page);
  },
  15_000,
);

test('rejects invalid capture limits and preserves the hard candidate cap', async () => {
  const invalidCaptureError = await captureFixtureAsync(
    '/dynamic',
    { height: 400, id: 'narrow', width: 320 },
    { maxCandidates: -1 },
  ).then(
    () => null,
    (error: unknown) => error,
  );
  expect(invalidCaptureError).toBeInstanceOf(RangeError);
  expect(invalidCaptureError).toHaveProperty(
    'message',
    'dynamicCapture.maxCandidates must be a positive finite integer.',
  );
  const page = await captureFixtureAsync(
    '/dynamic',
    { height: 400, id: 'narrow', width: 320 },
    {
      maxCandidates: 99,
      overallTimeoutMs: 1_000,
      perTargetTimeoutMs: 200,
      stabilityWindowMs: 20,
    },
  );
  expect(page.dynamicElements?.length).toBeLessThanOrEqual(24);
}, 10_000);
