import { createServer } from 'node:http';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import type { DynamicCaptureOptions, PageObservation } from '../../../../types/public.js';
import { toWebsiteObservationDocument } from '../../application/toWebsiteObservationDocument.js';
import { createPuppeteerCapturePage } from './createPuppeteerCapturePage.js';

const transitionNoise = Array.from(
  { length: 30 },
  (_, index) => `<div class="noise">noise ${index}</div>`,
).join('');

const fixtureBody = (url: string | undefined): string =>
  url === '/dynamic'
    ? `<style>
      body{margin:0}.noise{height:8px;transition:color 80ms linear}.spacer{height:900px}
      .track{width:200px;height:20px;margin:16px 0}.rowgap{height:500px}.fill{width:0;height:20px;background:green;transition:width 80ms linear}
      .reveal{height:20px;opacity:0;transition:opacity 80ms linear}.stuck{animation:spin 2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    </style>${transitionNoise}<div class="spacer"></div>
    <div class="track" role="progressbar" aria-label="zero" aria-valuenow="0" value="0" id="zero"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="css" aria-valuemin="0" aria-valuemax="100" aria-valuenow="20" data-private-capture="never" id="css"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="web" aria-valuenow="40" id="web"><div class="fill"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="stuck" aria-valuenow="13" id="stuck"><div class="fill stuck"></div></div><div class="rowgap"></div>
    <div class="track" role="progressbar" aria-label="false" aria-valuenow="9" id="false"><span class="noise">unchanged target</span></div><div class="rowgap"></div>
    <div class="reveal" id="reveal">reveal</div>
    <script>
      const activate=(entry)=>{if(!entry.isIntersecting)return;entry.target.dataset.seen='true';
        if(entry.target.id==='css'){entry.target.setAttribute('aria-valuenow','72');entry.target.setAttribute('aria-valuetext','72 percent');entry.target.firstElementChild.style.width='144px'}
        if(entry.target.id==='web'){entry.target.firstElementChild.animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:80,fill:'forwards'})}
        if(entry.target.id==='false')setTimeout(()=>entry.target.lastElementChild.textContent='unrelated mutation',20)
        if(entry.target.id==='reveal')entry.target.style.opacity='1';
      };
      const observer=new IntersectionObserver((entries)=>entries.forEach(activate));
      document.querySelectorAll('[role="progressbar"],.reveal').forEach((element)=>observer.observe(element));
    </script>`
    : url === '/about'
      ? '<title>About</title><main>About page</main>'
      : `<title>Fixture</title><nav><a href="/about">About</a></nav><section class="grid"><article>One <span style="color: red">red</span></article><article hidden>Hidden</article><article>Three</article></section>`;

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
  expect(byLabel('zero')?.outcome).toBe('settled');
  expect(byLabel('css')?.initial.element.attributes['aria-valuenow']).toBe('20');
  expect(byLabel('css')?.settled?.element.attributes['aria-valuenow']).toBe('72');
  expect(byLabel('css')?.settled?.element.rect.width).toBe(200);
  expect(byLabel('web')?.outcome).toBe('settled');
  expect(byLabel('stuck')?.outcome).toBe('incomplete');
  expect(byLabel('false')?.outcome).toBe('incomplete');
  expect(
    evidence.some((item) => item.initial.element.text === 'reveal' && item.outcome === 'settled'),
  ).toBe(true);
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
  expect(state('false', 'incomplete')?.availability.status).toBe('missing');
  expect(state('false', 'incomplete')?.semanticAttributes).toEqual({});
  expect(state('false', 'incomplete')?.css).toBeNull();
  expect(state('false', 'incomplete')?.rect).toBeNull();
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
});

test('captures visible and hidden DOM state, computed CSS, and navigation', async () => {
  const page = await captureFixtureAsync('/', { height: 800, id: 'desktop', width: 1440 });

  expect(page.links).toEqual([`${origin}/about`]);
  expect(page.elements.find((element) => element.text === 'red')?.css.color).toContain('255');
  expect(page.elements.find((element) => element.text === 'One ')?.tagName).toBe('article');
  expect(page.elements.find((element) => element.text === 'Hidden')?.visible).toBe(false);
  expect(page.elements.some((element) => element.css.display === 'grid')).toBe(true);
});

test.each([
  { height: 900, id: 'desktop', width: 1440 },
  { height: 700, id: 'tablet', width: 768 },
  { height: 400, id: 'narrow', width: 320 },
])('captures prioritized dynamic evidence at $id viewport', async (viewport) => {
  const page = await captureFixtureAsync('/dynamic', viewport, {
    overallTimeoutMs: 1_000,
    perTargetTimeoutMs: 200,
    stabilityWindowMs: 20,
  });
  expectDynamicEvidence(page);

  expectCanonicalDynamicEvidence(page);
});

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
