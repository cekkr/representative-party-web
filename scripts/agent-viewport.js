/**
 * agent-viewport
 * -------------
 * Goal: give an AI agent a "visual-ish" simplified representation of what is
 * actually visible in the browser viewport, with absolute positions and
 * actionable hints.
 *
 * Philosophy:
 * - We DO NOT try to serialize the whole DOM.
 * - We DO try to serialize what a user can see and interact with.
 * - We ignore elements behind others (occluded).
 * - We provide stable-ish IDs so an agent can refer to elements reliably.
 *
 * Works with Puppeteer Page:
 *   const snap = await captureViewport(page)
 *   console.log(renderAsText(snap))
 *   await act(page, snap, { type: 'click', target: 'e12' })
 */

import crypto from 'node:crypto';

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

function sortByReadingOrder(a, b) {
  if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
  return a.rect.x - b.rect.x;
}

/**
 * Renders a simplified "absolute-position overlay HTML".
 * This is useful both for debugging and for giving the agent a clean DOM
 * that mirrors only what is visible.
 */
function renderAsHtml(snapshot, opts = {}) {
  const {
    title = 'agent-viewport snapshot',
    showBoxes = true,         // outlines boxes for debugging
    showLabels = true,        // labels each element with its id
    includeStyles = true,
  } = opts;

  const { viewport, url, elements } = snapshot;

  // Important: This HTML is standalone and intentionally does not include JS.
  // It is only a "visual map" of the viewport.
  const boxCss = showBoxes
    ? `outline: 1px dashed rgba(0,0,0,0.35); outline-offset: -1px;`
    : ``;

  const labelCss = showLabels
    ? `
      .av-label {
        position: absolute;
        top: -1.2em;
        left: 0;
        font: 12px/1.2 monospace;
        background: rgba(0,0,0,0.75);
        color: white;
        padding: 1px 4px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
      }`
    : ``;

  const baseCss = includeStyles
    ? `
      html, body { margin:0; padding:0; background:#fff; }
      .av-root {
        position: relative;
        width: ${Math.round(viewport.width)}px;
        height: ${Math.round(viewport.height)}px;
        overflow: hidden;
        background: #fff;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
      .av-el {
        position: absolute;
        box-sizing: border-box;
        overflow: hidden;
        ${boxCss}
      }
      ${labelCss}
      .av-text {
        font-size: 12px;
        padding: 2px 4px;
        white-space: pre-wrap;
        word-break: break-word;
      }
    `
    : '';

  const items = elements.map(el => {
    const x = Math.round(el.rect.x);
    const y = Math.round(el.rect.y);
    const w = Math.round(el.rect.width);
    const h = Math.round(el.rect.height);

    const safeText = escapeHtml(
      (el.text || el.name || '').slice(0, 500) // don’t bloat the overlay
    );

    // Minimal appearance: background + font (optional)
    const bg = el.style?.backgroundColor && el.style.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? `background:${el.style.backgroundColor};`
      : '';

    const color = el.style?.color ? `color:${el.style.color};` : '';
    const radius = el.style?.borderRadius ? `border-radius:${el.style.borderRadius};` : '';
    const cursor = el.style?.cursor ? `cursor:${el.style.cursor};` : '';

    const label = showLabels ? `<div class="av-label">${escapeHtml(el.id)} · ${escapeHtml(el.kind)}</div>` : '';

    return `
      <div class="av-el" data-id="${escapeHtml(el.id)}"
           style="left:${x}px; top:${y}px; width:${w}px; height:${h}px; ${bg}${color}${radius}${cursor}">
        ${label}
        <div class="av-text">${safeText}</div>
      </div>
    `;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${includeStyles ? `<style>${baseCss}</style>` : ''}
</head>
<body>
  <div class="av-root" aria-label="agent-viewport overlay" data-url="${escapeHtml(url)}">
    ${items}
  </div>
</body>
</html>`;
}

/**
 * Renders a plain-text description for LLMs.
 *
 * Why this format works well for agents:
 * - Deterministic ordering (top-to-bottom, left-to-right).
 * - Each element has an ID the agent can reference.
 * - It includes position + size, and "actions" the agent can take.
 */
function renderAsText(snapshot, opts = {}) {
  const {
    maxTextLen = 160,
    includeUrl = true,
    includeViewport = true,
    includeHints = true,
  } = opts;

  const lines = [];
  if (includeUrl) lines.push(`URL: ${snapshot.url}`);
  if (includeViewport) {
    const v = snapshot.viewport;
    lines.push(`VIEWPORT: ${Math.round(v.width)}x${Math.round(v.height)} @ dpr=${v.deviceScaleFactor}`);
  }

  // already sorted by the capture step, but re-sort to be safe
  const els = [...snapshot.elements].sort(sortByReadingOrder);

  for (const el of els) {
    const r = el.rect;
    const pos = `(${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)})`;

    const text = (el.text || el.name || '').replace(/\s+/g, ' ').trim();
    const clipped = text.length > maxTextLen ? text.slice(0, maxTextLen - 1) + '…' : text;

    const actions = includeHints && el.actions?.length
      ? ` actions=[${el.actions.join(', ')}]`
      : '';

    const metaBits = [];
    if (el.kind) metaBits.push(el.kind);
    if (el.role && el.role !== el.kind) metaBits.push(`role=${el.role}`);
    if (el.disabled) metaBits.push('disabled');
    if (el.value && !clipped) metaBits.push(`value="${safeInline(el.value, 60)}"`);

    const meta = metaBits.length ? ` {${metaBits.join(', ')}}` : '';

    lines.push(`- ${el.id} ${pos}${meta}${actions} :: ${safeInline(clipped, maxTextLen)}`);
  }

  return lines.join('\n');
}

/**
 * findElements(snapshot, locator)
 *
 * A small locator engine for unit tests and AI-assisted scripts.
 * You can match by text/name/role/kind/actions and return 0..N elements.
 */
function findElements(snapshot, locator = {}, opts = {}) {
  if (!snapshot || !Array.isArray(snapshot.elements)) return [];

  const query = typeof locator === 'string' ? { id: locator } : (locator || {});
  const matchDefaults = {
    match: query.match || opts.match || 'contains',
    caseSensitive: query.caseSensitive ?? opts.caseSensitive ?? false,
  };

  const idList = query.id || query.ids;
  const ids = idList ? (Array.isArray(idList) ? idList : [idList]) : null;

  const tag = typeof query.tag === 'string' ? query.tag.toLowerCase() : query.tag;
  const role = typeof query.role === 'string' ? query.role.toLowerCase() : query.role;
  const kind = typeof query.kind === 'string' ? query.kind.toLowerCase() : query.kind;

  const matches = snapshot.elements.filter(el => {
    if (ids && !ids.includes(el.id)) return false;
    if (tag && el.tag !== tag) return false;
    if (role && el.role !== role) return false;
    if (kind && el.kind !== kind) return false;

    if (query.disabled != null && Boolean(el.disabled) !== Boolean(query.disabled)) return false;

    if (query.action) {
      if (!el.actions || !el.actions.includes(query.action)) return false;
    }
    if (query.actions) {
      const required = Array.isArray(query.actions) ? query.actions : [query.actions];
      if (!required.every(action => el.actions?.includes(action))) return false;
    }

    if (query.text != null && !matchString(el.text, query.text, matchDefaults)) return false;
    if (query.name != null && !matchString(el.name, query.name, matchDefaults)) return false;
    if (query.label != null) {
      const labelMatch =
        matchString(el.text, query.label, matchDefaults) ||
        matchString(el.name, query.label, matchDefaults);
      if (!labelMatch) return false;
    }
    if (query.value != null && !matchString(el.value, query.value, matchDefaults)) return false;
    if (query.selector != null && !matchString(el.selector, query.selector, matchDefaults)) return false;

    if (query.within) {
      const area = normalizeRect(query.within);
      const rect = normalizeRect(el.rect);
      const mode = query.within.mode || 'intersects';
      const ok = mode === 'contains'
        ? rectContains(area, rect)
        : rectIntersects(area, rect);
      if (!ok) return false;
    }

    return true;
  });

  matches.sort(sortByReadingOrder);

  if (Number.isInteger(query.index)) {
    return matches[query.index] ? [matches[query.index]] : [];
  }
  if (Number.isInteger(query.nth)) {
    const idx = query.nth - 1;
    return idx >= 0 && matches[idx] ? [matches[idx]] : [];
  }
  if (query.pick === 'first') return matches.slice(0, 1);
  if (query.pick === 'last') return matches.slice(-1);

  return matches;
}

/**
 * assertSnapshot(snapshot, assertions)
 *
 * Asserts the viewport snapshot against locator-based expectations.
 * Returns a report and throws by default when assertions fail.
 */
function assertSnapshot(snapshot, assertions = [], opts = {}) {
  const items = Array.isArray(assertions) ? assertions : [assertions];
  const checks = [];
  const failures = [];

  const defaultMatch = opts.match || 'contains';
  const defaultCaseSensitive = opts.caseSensitive ?? false;

  for (let i = 0; i < items.length; i++) {
    const assertion = items[i] || {};
    const id = assertion.id || assertion.label || `assert-${i + 1}`;
    const target = assertion.target || assertion.query || assertion.locator;

    if (!target) {
      throw new Error(`assertSnapshot(): assertion missing target at index ${i}`);
    }

    const matchOpts = {
      match: assertion.match ?? defaultMatch,
      caseSensitive: assertion.caseSensitive ?? defaultCaseSensitive,
    };

    const matches = findElements(snapshot, target, matchOpts);
    const count = matches.length;

    const expected = resolveExpectedRange(assertion);
    const pass = count >= expected.min && count <= expected.max;

    const check = {
      id,
      target,
      expected,
      count,
      matchIds: matches.slice(0, 5).map(el => el.id),
      pass,
    };

    checks.push(check);
    if (!pass) failures.push(check);
  }

  const report = { ok: failures.length === 0, failures, checks };
  if (!report.ok && opts.throwOnFailure !== false) {
    throw new Error(formatAssertionReport(report));
  }
  return report;
}

/**
 * The core: captureViewport(page)
 *
 * This runs a function inside the page (page.evaluate) to extract:
 * - Visible elements within viewport
 * - Their bounding boxes (absolute within viewport)
 * - Whether they are occluded (behind another element)
 * - “kind/role” and suggested actions for agents
 */
async function captureViewport(page, options = {}) {
  const {
    // Reduce noise: capture only meaningful elements.
    // 'balanced' is usually best for LLM agents:
    // - interactive elements always included
    // - text elements included
    // - containers with no useful content are ignored
    mode = 'balanced', // 'balanced' | 'all' | 'interactive'

    // Minimum pixel area for an element to be included (filters tiny icons/noise)
    minArea = 10 * 10,

    // If true, tries to discard elements that are behind others using elementFromPoint checks
    occlusionCheck = true,

    // Extra sampling points for occlusion (more accurate but slower)
    occlusionSamples = 3, // 1..5 recommended

    // Max elements to return (avoid huge pages)
    maxElements = 250,

    // When true, we also merge Puppeteer accessibility snapshot info (role/name/value/state)
    // Note: this is helpful, but not required.
    includeAccessibility = true,
  } = options;

  const viewport = page.viewport() || {};
  const url = page.url();

  // Extract visible elements + geometry inside the browser context.
  const raw = await page.evaluate(
    ({ mode, minArea, occlusionCheck, occlusionSamples, maxElements }) => {
      // ---------- Helpers that run INSIDE the page ----------

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      const round2 = (n) => Math.round(n * 100) / 100;

      function isVisibleStyle(cs) {
        if (!cs) return false;
        if (cs.display === 'none') return false;
        if (cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity || '1') <= 0) return false;
        return true;
      }

      function rectIntersectsViewport(r) {
        // r is DOMRect-like with x,y,width,height relative to viewport
        if (r.width <= 0 || r.height <= 0) return false;
        if (r.right <= 0 || r.bottom <= 0) return false;
        if (r.left >= vw || r.top >= vh) return false;
        return true;
      }

      function areaOk(r, minArea) {
        return (r.width * r.height) >= minArea;
      }

      function getRole(el) {
        // Prefer explicit ARIA role if present
        const role = el.getAttribute('role');
        if (role) return role;

        // Infer basic roles
        const tag = el.tagName.toLowerCase();
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'input') {
          const t = (el.getAttribute('type') || 'text').toLowerCase();
          if (t === 'checkbox') return 'checkbox';
          if (t === 'radio') return 'radio';
          if (t === 'submit' || t === 'button') return 'button';
          return 'textbox';
        }
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        return 'generic';
      }

      function isNaturallyInteractive(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || tag === 'select' || tag === 'textarea') return true;
        if (tag === 'a' && el.hasAttribute('href')) return true;
        if (tag === 'input') return true;
        // contenteditable
        if (el.isContentEditable) return true;
        return false;
      }

      function looksInteractive(el, cs) {
        // We cannot read JS event listeners reliably from the page context.
        // So we use heuristics:
        // - natural interactive tags
        // - tabindex >= 0
        // - cursor: pointer
        // - onclick attribute
        // - role like button/link
        if (isNaturallyInteractive(el)) return true;
        const tabindex = el.getAttribute('tabindex');
        if (tabindex != null && parseInt(tabindex, 10) >= 0) return true;
        if (cs && cs.cursor === 'pointer') return true;
        if (el.getAttribute('onclick')) return true;
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link') return true;
        return false;
      }

      function getName(el) {
        // A human-facing label-ish name
        // (useful for LLM agents)
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const alt = el.getAttribute('alt');
        if (alt) return alt.trim();
        const title = el.getAttribute('title');
        if (title) return title.trim();
        const ph = el.getAttribute('placeholder');
        if (ph) return ph.trim();
        return '';
      }

      function getText(el) {
        // Prefer innerText (visible text), but it's more expensive.
        // We use it selectively for balanced mode.
        try {
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
          return t;
        } catch {
          return '';
        }
      }

      function cssPath(el) {
        // Best-effort stable selector path.
        // For agent actions we often click by coordinates anyway,
        // but selector helps debugging / fallback.
        if (!(el instanceof Element)) return '';
        const parts = [];
        while (el && el.nodeType === 1) {
          let part = el.nodeName.toLowerCase();
          if (el.id) {
            part += `#${CSS.escape(el.id)}`;
            parts.unshift(part);
            break;
          } else {
            const parent = el.parentElement;
            if (!parent) {
              parts.unshift(part);
              break;
            }
            const siblings = Array.from(parent.children).filter(c => c.nodeName === el.nodeName);
            if (siblings.length > 1) {
              const idx = siblings.indexOf(el) + 1;
              part += `:nth-of-type(${idx})`;
            }
            parts.unshift(part);
            el = parent;
          }
        }
        return parts.join(' > ');
      }

      function occluded(el, rect, samples) {
        // Check if el is on top at a few points inside its rect.
        // If another element is on top at ALL sampled points, treat as occluded.
        if (!rectIntersectsViewport(rect)) return true;

        const pts = [];
        const n = clamp(samples, 1, 5);

        // Always sample center
        pts.push([rect.left + rect.width / 2, rect.top + rect.height / 2]);

        // Add more points (corners-ish)
        if (n >= 2) pts.push([rect.left + 2, rect.top + 2]);
        if (n >= 3) pts.push([rect.right - 2, rect.top + 2]);
        if (n >= 4) pts.push([rect.left + 2, rect.bottom - 2]);
        if (n >= 5) pts.push([rect.right - 2, rect.bottom - 2]);

        let visibleCount = 0;

        for (const [x0, y0] of pts) {
          const x = clamp(x0, 0, vw - 1);
          const y = clamp(y0, 0, vh - 1);
          const top = document.elementFromPoint(x, y);
          if (!top) continue;

          // If "top" is the element itself OR a descendant, then el is visible at this point.
          if (top === el || el.contains(top)) {
            visibleCount++;
          }
        }

        // If at least one point is visible, we consider it "not fully occluded"
        return visibleCount === 0;
      }

      function kindFor(el, role, interactive) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'input') return 'input';
        if (tag === 'textarea') return 'textarea';
        if (tag === 'select') return 'select';
        if (tag === 'button') return 'button';
        if (tag === 'a') return 'link';
        if (role && role !== 'generic') return role;
        return interactive ? 'interactive' : 'text';
      }

      function actionsFor(el, role, interactive) {
        const tag = el.tagName.toLowerCase();
        const actions = [];
        if (!interactive) return actions;

        // Click-like
        actions.push('click');

        // Type-like
        if (tag === 'input' || tag === 'textarea' || el.isContentEditable || role === 'textbox') {
          actions.push('type');
          actions.push('clear');
        }

        // Select-like
        if (tag === 'select' || role === 'combobox') {
          actions.push('select');
        }

        return Array.from(new Set(actions));
      }

      // ---------- Main extraction ----------

      const all = Array.from(document.querySelectorAll('body *'));
      const out = [];

      // We do a quick pre-filter to avoid expensive calls for everything.
      for (const el of all) {
        const cs = window.getComputedStyle(el);
        if (!isVisibleStyle(cs)) continue;

        const r = el.getBoundingClientRect();
        if (!rectIntersectsViewport(r)) continue;
        if (!areaOk(r, minArea)) continue;

        const name = getName(el);

        // For balanced mode, we only compute innerText when needed.
        const interactive = looksInteractive(el, cs);
        const role = getRole(el);

        let text = '';
        if (mode === 'all') {
          text = getText(el);
        } else if (mode === 'interactive') {
          text = ''; // interactive-only mode tries to reduce noise
        } else {
          // balanced
          // If it looks interactive or has a short name, keep text minimal.
          // Otherwise, include text for readability.
          text = interactive ? '' : getText(el);
        }

        // In balanced mode, skip “empty containers” (no text/name, not interactive).
        if (mode === 'balanced' || mode === 'interactive') {
          if (!interactive && !name && !text) continue;
        }

        // Optional occlusion check
        if (occlusionCheck && occluded(el, r, occlusionSamples)) continue;

        const kind = kindFor(el, role, interactive);
        const actions = actionsFor(el, role, interactive);

        // Gather some minimal style hints.
        // Avoid dumping too much; just enough for agent reasoning.
        const style = {
          cursor: cs.cursor || '',
          color: cs.color || '',
          backgroundColor: cs.backgroundColor || '',
          borderRadius: cs.borderRadius || '',
          fontSize: cs.fontSize || '',
          fontWeight: cs.fontWeight || '',
        };

        const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');

        let value = '';
        if (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea') {
          value = (el.value || '').toString();
        } else if (el.isContentEditable) {
          value = (el.textContent || '').toString().trim();
        }

        const selector = cssPath(el);

        // Build a "node signature" for a stable-ish ID:
        // - selector
        // - rounded rect
        // - kind/role
        const rect = {
          x: round2(r.x),
          y: round2(r.y),
          width: round2(r.width),
          height: round2(r.height),
        };

        out.push({
          // id assigned later in Node for consistency
          selector,
          tag: el.tagName.toLowerCase(),
          kind,
          role,
          name,
          text,
          value,
          disabled,
          rect,
          style,
          actions,
        });

        if (out.length >= maxElements) break;
      }

      // Sort in reading order: y then x
      out.sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
      return { viewport: { width: vw, height: vh }, elements: out };
    },
    { mode, minArea, occlusionCheck, occlusionSamples, maxElements }
  );

  // Create stable-ish IDs in Node (avoids differences in browser engines).
  const elements = raw.elements.map((el, idx) => {
    const sig = `${el.selector}|${Math.round(el.rect.x)}|${Math.round(el.rect.y)}|${Math.round(el.rect.width)}|${Math.round(el.rect.height)}|${el.kind}|${el.role}|${el.name}`;
    const short = sha1(sig).slice(0, 6);
    return {
      id: `e${idx + 1}_${short}`, // e.g. e12_a1b2c3
      ...el,
    };
  });

  // Optionally merge accessibility info (role/name/value/state) from Puppeteer.
  // This can improve “what is this element?” for agents.
  let accessibility = null;
  if (includeAccessibility && page.accessibility && page.accessibility.snapshot) {
    try {
      accessibility = await page.accessibility.snapshot({ interestingOnly: true });
      // We do NOT attempt a perfect mapping from AX tree -> element boxes here,
      // because the AX snapshot doesn’t provide geometry.
      // Still useful for agent prompt context (e.g., page has dialogs, headings, etc.)
    } catch {
      accessibility = null;
    }
  }

  return {
    url,
    viewport: {
      width: viewport.width ?? raw.viewport.width,
      height: viewport.height ?? raw.viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    },
    elements,
    accessibility,
    createdAt: new Date().toISOString(),
  };
}

/**
 * act(page, snapshot, command)
 *
 * This is intentionally simple and agent-friendly.
 * Agents can do:
 * - click target by element id
 * - type into an input by element id
 * - select option by value/label (best-effort)
 *
 * IMPORTANT: For reliability, we click/type by coordinates inside the element rect.
 * Why coordinates?
 * - Selectors can change.
 * - Coordinates are exactly what the agent "saw" in the snapshot.
 */
async function act(page, snapshot, command) {
  const { type, target, text, value } = command || {};
  if (!type) throw new Error('act(): command.type is required');

  const el = resolveTarget(snapshot, target, {
    match: command?.match,
    caseSensitive: command?.caseSensitive,
  });

  const cx = Math.round(el.rect.x + el.rect.width / 2);
  const cy = Math.round(el.rect.y + el.rect.height / 2);

  // Make sure mouse events are within viewport
  const vw = snapshot.viewport.width;
  const vh = snapshot.viewport.height;
  const x = Math.max(0, Math.min(vw - 1, cx));
  const y = Math.max(0, Math.min(vh - 1, cy));

  if (type === 'click') {
    await page.mouse.click(x, y);
    return { ok: true };
  }

  if (type === 'type') {
    // click to focus then type
    await page.mouse.click(x, y);
    if (typeof text !== 'string') throw new Error('act(): command.text must be a string for type');
    await page.keyboard.type(text);
    return { ok: true };
  }

  if (type === 'clear') {
    await page.mouse.click(x, y);
    // "Select all" then backspace; works on most inputs
    const isMac = (process.platform === 'darwin');
    await page.keyboard.down(isMac ? 'Meta' : 'Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up(isMac ? 'Meta' : 'Control');
    await page.keyboard.press('Backspace');
    return { ok: true };
  }

  if (type === 'select') {
    // Best-effort:
    // - Try selecting by evaluating element at point and setting value if it's a SELECT
    // - Then dispatch change/input
    if (value == null) throw new Error('act(): command.value required for select');

    const result = await page.evaluate(({ x, y, value }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { ok: false, reason: 'no element at point' };

      // If the click point hits an option inside a custom UI, this won't work,
      // but it will work for native <select>.
      const select = el.tagName.toLowerCase() === 'select' ? el : el.closest('select');
      if (!select) return { ok: false, reason: 'not a native select' };

      const valStr = String(value);

      // match by option value OR label text
      let found = false;
      for (const opt of Array.from(select.options)) {
        if (opt.value === valStr || (opt.textContent || '').trim() === valStr) {
          select.value = opt.value;
          found = true;
          break;
        }
      }
      if (!found) return { ok: false, reason: 'option not found' };

      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }, { x, y, value });

    if (!result.ok) throw new Error(`act(): select failed: ${result.reason}`);
    return { ok: true };
  }

  throw new Error(`act(): unsupported command.type: ${type}`);
}

// --------- small helpers ---------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeInline(s, maxLen = 200) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + '…';
}

function resolveTarget(snapshot, target, opts = {}) {
  if (typeof target === 'string') {
    const direct = snapshot.elements.find(e => e.id === target);
    if (!direct) throw new Error(`act(): target not found in snapshot: ${target}`);
    return direct;
  }

  if (!target || typeof target !== 'object') {
    throw new Error('act(): command.target must be a string or locator object');
  }

  const matches = findElements(snapshot, target, opts);
  if (matches.length === 0) {
    throw new Error(`act(): target locator not found: ${formatLocator(target)}`);
  }

  if (matches.length > 1 && !Number.isInteger(target.index) && !Number.isInteger(target.nth) && !target.pick) {
    throw new Error(`act(): target locator matched multiple elements (${matches.length}). Add index/nth/pick or refine: ${formatLocator(target)}`);
  }

  if (target.pick === 'last') return matches[matches.length - 1];
  return matches[0];
}

function resolveExpectedRange(assertion) {
  if (assertion && Object.prototype.hasOwnProperty.call(assertion, 'count')) {
    return { min: assertion.count, max: assertion.count };
  }

  let min = assertion?.min;
  let max = assertion?.max;

  if (Object.prototype.hasOwnProperty.call(assertion || {}, 'exists')) {
    if (assertion.exists) {
      if (min == null) min = 1;
      if (max == null) max = Infinity;
    } else {
      min = 0;
      max = 0;
    }
  }

  if (min == null && max == null) {
    min = 1;
    max = Infinity;
  } else {
    if (min == null) min = 0;
    if (max == null) max = Infinity;
  }

  return { min, max };
}

function formatAssertionReport(report) {
  const lines = ['assertSnapshot failed:'];
  for (const failure of report.failures || []) {
    const expectedLabel = formatExpectedRange(failure.expected);
    const sample = failure.matchIds?.length
      ? ` matches=[${failure.matchIds.join(', ')}]`
      : '';
    lines.push(
      `- ${failure.id}: expected ${expectedLabel} match(es), got ${failure.count} for ${formatLocator(failure.target)}${sample}`
    );
  }
  return lines.join('\n');
}

function formatExpectedRange(expected) {
  if (!expected) return 'unknown';
  if (expected.min === expected.max) return String(expected.min);
  if (expected.max === Infinity) return `>= ${expected.min}`;
  return `${expected.min}..${expected.max}`;
}

function formatLocator(locator) {
  if (typeof locator === 'string') return locator;
  if (!locator || typeof locator !== 'object') return String(locator);

  const summary = {};
  const keys = [
    'id',
    'label',
    'text',
    'name',
    'value',
    'role',
    'kind',
    'tag',
    'selector',
    'action',
    'actions',
    'disabled',
    'within',
    'index',
    'nth',
    'pick',
    'match',
    'caseSensitive',
  ];

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(locator, key)) continue;
    const value = locator[key];
    if (typeof value === 'string') {
      summary[key] = value.length > 120 ? `${value.slice(0, 117)}...` : value;
    } else {
      summary[key] = value;
    }
  }

  return JSON.stringify(summary);
}

function matchString(actual, expected, defaults = {}) {
  if (expected == null) return true;

  if (expected instanceof RegExp) {
    return expected.test(String(actual || ''));
  }

  let match = defaults.match || 'contains';
  let caseSensitive = defaults.caseSensitive ?? false;
  let flags = '';
  let value = expected;

  if (expected && typeof expected === 'object') {
    if (expected.regex instanceof RegExp) {
      return expected.regex.test(String(actual || ''));
    }
    if (expected.regex != null) {
      match = 'regex';
      value = expected.regex;
      flags = expected.flags || '';
      if (expected.caseSensitive != null) caseSensitive = expected.caseSensitive;
    } else if (Object.prototype.hasOwnProperty.call(expected, 'value')) {
      value = expected.value;
      if (expected.match) match = expected.match;
      if (expected.caseSensitive != null) caseSensitive = expected.caseSensitive;
      if (expected.flags) flags = expected.flags;
    }
  }

  const actualStr = String(actual || '');
  const valueStr = String(value || '');

  if (match === 'regex') {
    let reFlags = flags;
    if (!caseSensitive && !reFlags.includes('i')) reFlags += 'i';
    const re = new RegExp(valueStr, reFlags);
    return re.test(actualStr);
  }

  if (valueStr === '') return actualStr === '';

  const a = caseSensitive ? actualStr : actualStr.toLowerCase();
  const b = caseSensitive ? valueStr : valueStr.toLowerCase();

  if (match === 'exact') return a === b;
  if (match === 'prefix') return a.startsWith(b);
  if (match === 'suffix') return a.endsWith(b);
  return a.includes(b);
}

function normalizeRect(rect) {
  const x = Number.isFinite(rect?.x) ? rect.x : (Number.isFinite(rect?.left) ? rect.left : 0);
  const y = Number.isFinite(rect?.y) ? rect.y : (Number.isFinite(rect?.top) ? rect.top : 0);
  const width = Number.isFinite(rect?.width)
    ? rect.width
    : (Number.isFinite(rect?.right) ? rect.right - x : 0);
  const height = Number.isFinite(rect?.height)
    ? rect.height
    : (Number.isFinite(rect?.bottom) ? rect.bottom - y : 0);

  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

function rectIntersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function rectContains(a, b) {
  return b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom;
}

export {
  captureViewport,
  renderAsText,
  renderAsHtml,
  act,
  findElements,
  assertSnapshot,
};
