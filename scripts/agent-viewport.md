This is a small **Node.js library design + full implementation** you can drop into a project. It uses **Puppeteer** to extract a “what the user can see” snapshot of the current viewport and outputs:

1. **JSON**: list of visible UI elements with **absolute positions** (viewport coords), text, role/type, and suggested actions
2. **Plain text**: a deterministic “screen reader / wireframe” for LLMs
3. **Simplified HTML**: an “absolute-positioned overlay DOM” that contains only what’s visible (great for agent reasoning + debugging)

It also provides helpers to **click/type/select** by element id, plus locator-based helpers for unit tests and AI-assisted workflows.

---

## Library: `agent-viewport`

### Install

```bash
npm i puppeteer
# then add the files below in your project (or publish as a package)
```

## Example usage: `examples/run.js`

```js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { captureViewport, renderAsText, renderAsHtml, act } from '../index.js';

/**
 * This example demonstrates the intended agent loop:
 * 1) Navigate
 * 2) Capture what is visible
 * 3) Convert to a text “screen map”
 * 4) Let an LLM decide an action referencing element IDs
 * 5) Execute the action
 * 6) Repeat
 */
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Make viewport explicit so coordinates are stable.
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });

  await page.goto('https://example.com', { waitUntil: 'networkidle2' });

  // Capture snapshot (balanced mode is usually best for LLMs).
  const snap = await captureViewport(page, {
    mode: 'balanced',
    occlusionCheck: true,
    occlusionSamples: 3,
    maxElements: 150,
  });

  // Plain-text for LLM prompt
  const text = renderAsText(snap);
  console.log(text);

  // Optional: generate an overlay HTML for debugging
  const html = renderAsHtml(snap, { showBoxes: true, showLabels: true });
  fs.writeFileSync('snapshot.html', html, 'utf8');

  // Example “agent action”:
  // (In real usage, your LLM would output this.)
  // Here we click the first link-like element we find.
  const firstLink = snap.elements.find(e => e.kind === 'link' && e.actions.includes('click'));
  if (firstLink) {
    console.log('\nClicking:', firstLink.id, firstLink.name || firstLink.text);
    await act(page, snap, { type: 'click', target: firstLink.id });
    await page.waitForTimeout(500);

    // Capture again after action
    const snap2 = await captureViewport(page);
    console.log('\nAFTER CLICK:\n' + renderAsText(snap2));
  }

  await browser.close();
})();
```

---

## What the agent “sees” (sample output shape)

The text output looks like:

```
URL: https://example.com
VIEWPORT: 1200x800 @ dpr=1
- e1_9a12bc (40,120 500x40) {text} :: Example Domain
- e2_1f2a9d (40,220 600x60) {text} :: This domain is for use in illustrative examples…
- e3_c02d11 (40,340 120x18) {link, role=link} actions=[click] :: More information…
```

An LLM can now say:

* “Click `e3_c02d11`”
  and your code executes it reliably by coordinates.

---

## Notes / limitations (important for “events etc.”)

* **Real JS event listeners cannot be enumerated reliably** from normal page context. (Chrome DevTools can, but that’s not available in a standard `page.evaluate` environment.)
  So the library uses **heuristics**:

  * native interactive tags (`button`, `a[href]`, `input`, `select`, `textarea`)
  * `tabindex >= 0`
  * `cursor: pointer`
  * `onclick` attribute
  * `role=button/link`

* **Occlusion**: the library discards elements that are behind others by sampling `document.elementFromPoint()` at a few points inside the rect.

* **Coordinates are viewport-based**, so scrolling changes them. That’s intended: an agent is reasoning about the viewport “as seen”.

---

## How to use this with an LLM agent (recommended pattern)

1. Build a prompt with:

   * current URL
   * the `renderAsText(snapshot)` output
   * instructions: “Respond ONLY with JSON command: {type, target, text/value}”
2. Parse the JSON
3. Call `act(page, snapshot, command)`
4. Capture again

Example command schema:

```json
{ "type": "click", "target": "e3_c02d11" }
```

```json
{ "type": "type", "target": "e9_aa01ff", "text": "hello world" }
```

---

## Unit-test helpers (AI-friendly)

Use locator objects to find elements without hard-coding ids, then assert against the snapshot.

```js
import { captureViewport, act, assertSnapshot } from './agent-viewport.js';

const snap = await captureViewport(page);

assertSnapshot(snap, [
  { id: 'title', target: { text: 'Example Domain', kind: 'text' }, count: 1 },
  { id: 'cta', target: { role: 'link', label: 'More information' }, min: 1 },
]);

await act(page, snap, {
  type: 'click',
  target: { role: 'link', label: 'More information', nth: 1 },
});
```

You can also call `findElements(snapshot, locator)` to inspect all matches before asserting.

Locator fields (combine to narrow matches):

* `id`, `text`, `name`, `label` (text or name), `value`
* `role`, `kind`, `tag`
* `action` (single), `actions` (array)
* `selector`, `disabled`
* `within`: `{ x, y, width, height, mode: 'intersects' | 'contains' }`
* `index` (0-based), `nth` (1-based), `pick` ('first'|'last')
* `match`: `'contains' | 'exact' | 'prefix' | 'suffix' | 'regex'`
* `caseSensitive`: `true` or `false`

String matches also accept objects:

```json
{ "text": { "value": "Save", "match": "exact" } }
```

```json
{ "text": { "regex": "^Save", "flags": "i" } }
```

Assertions use `target` with the locator fields above and accept `count`, `min`, `max`, or `exists`. If none are set, the default expectation is "at least one match". `assertSnapshot` throws on failure by default; pass `{ throwOnFailure: false }` to get a report instead.

## Quick improvement knobs (if you extend it)

* Add `scrollIntoView` action: if element rect is partially outside viewport, scroll to it then recapture.
* Add “grouping”: cluster elements into rows/sections by y-coordinate gaps.
* Add a “grid map”: convert absolute coords into a coarse grid (e.g., 12 columns × 20 rows) to help LLM spatial reasoning.
* Add screenshot path (optional) and keep the overlay HTML for debugging.
