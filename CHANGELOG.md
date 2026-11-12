# @ankhorage/scraper

## 0.2.0

### Minor Changes

- 4892a01: Discover CSS viewport breakpoints automatically before collecting website observations when no explicit viewport override is supplied.
- bd6302c: Expose the bounded website crawler through the Ankh CLI provider.
- 579bdbc: Deduplicate browser captures that resolve to the same final canonical URL while exposing redirect and conflicting-capture diagnostics.
- 0b0eddb: Add bounded, SSRF-protected browser observations for public websites.
