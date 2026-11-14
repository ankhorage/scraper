# @ankhorage/scraper

## 0.4.0

### Minor Changes

- 32252a1: Capture verified scroll-triggered animation evidence with immutable default observations, computed transform/transition/animation values, and generated pseudo-element dimensions.

## 0.3.1

### Patch Changes

- 83d3e46: Prioritize representative mobile, tablet, and desktop responsive captures within bounded probe and capture budgets.

## 0.3.0

### Minor Changes

- fbf1736: Capture bounded initial, triggered, and settled evidence for viewport-activated dynamic elements.

## 0.2.0

### Minor Changes

- 4892a01: Discover CSS viewport breakpoints automatically before collecting website observations when no explicit viewport override is supplied.
- bd6302c: Expose the bounded website crawler through the Ankh CLI provider.
- 579bdbc: Deduplicate browser captures that resolve to the same final canonical URL while exposing redirect and conflicting-capture diagnostics.
- 0b0eddb: Add bounded, SSRF-protected browser observations for public websites.
