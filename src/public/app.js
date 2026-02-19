function triggerDeepLink() {
  const target = document.querySelector('[data-deep-link]');
  if (!target) return;
  const href = target.dataset.deepLink;
  const fallback = document.querySelector('[data-deep-link-fallback]');
  if (fallback) fallback.textContent = href;
  setTimeout(() => {
    window.location.href = href;
  }, 250);
}

triggerDeepLink();

function scrollToHash(url) {
  const targetUrl = new URL(url, window.location.origin);
  const hash = targetUrl.hash;
  if (hash) {
    const target = document.querySelector(hash);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitExtensionsForm(form) {
  const checkboxes = Array.from(form.querySelectorAll('input[name="extensions"]'));
  const enabled = checkboxes.filter((box) => box.checked).map((box) => box.value);
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensions: enabled }),
    });
    if (!response.ok) throw new Error('Extensions update failed');
    alert('Extensions updated. Reloading to apply.');
    window.location.reload();
  } catch (error) {
    console.error(error);
    alert('Failed to update extensions.');
  }
}

async function submitDelegationChoice(form) {
  const formData = new FormData(form);
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: formData.get('topic'), delegateHash: formData.get('delegateHash') }),
    });
    if (!response.ok) throw new Error('Delegation choice failed');
    alert('Delegation updated. It will be used for auto votes.');
  } catch (error) {
    console.error(error);
    alert('Failed to update delegation choice.');
  }
}

let composerToolState = null;
let composerToolRoot = null;
let composerOverlay = null;
const COMPOSER_STYLE_PROPS = [
  'width',
  'height',
  'color',
  'background',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'textDecoration',
  'lineHeight',
  'letterSpacing',
  'borderRadius',
  'padding',
  'margin',
  'border',
  'boxShadow',
  'gap',
  'gridTemplateColumns',
  'gridAutoFlow',
  'alignItems',
  'justifyContent',
  'display',
  'position',
  'zIndex',
  'left',
  'top',
];

function readComposerTextValue(node) {
  if (!node) return '';
  if (node.matches && node.matches('input, textarea')) {
    return (node.value || node.placeholder || '').trim();
  }
  return (node.textContent || '').trim();
}

function normalizeOverrideMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function buildOverrideBundle(raw = {}) {
  const bucket = normalizeOverrideMap(raw);
  return {
    textOverrides: normalizeOverrideMap(bucket.textOverrides),
    styleOverrides: normalizeOverrideMap(bucket.styleOverrides),
    domOrders: normalizeOverrideMap(bucket.domOrders),
  };
}

function hydrateComposerTextTargets(container, baseKey) {
  if (!container || !baseKey) return;
  const children = Array.from(container.children || []);
  const eyebrows = children.filter((child) => child.classList && child.classList.contains('eyebrow'));
  const headings = children.filter((child) => child.matches && child.matches('h1, h2, h3, h4'));
  const assignGroup = (nodes, suffix) => {
    nodes.forEach((node, index) => {
      if (!node.dataset.composerKey) {
        const key = nodes.length > 1 ? `${baseKey}.${suffix}.${index + 1}` : `${baseKey}.${suffix}`;
        node.dataset.composerKey = key;
      }
      if (node.dataset.composerDefault === undefined) {
        const text = readComposerTextValue(node);
        if (text) node.dataset.composerDefault = text;
      }
    });
  };
  assignGroup(eyebrows, 'eyebrow');
  assignGroup(headings, 'heading');
}

function applyComposerOverridesToNode(node, overrides = {}) {
  if (!node) return;
  COMPOSER_STYLE_PROPS.forEach((prop) => {
    node.style[prop] = overrides?.[prop] || '';
  });
}

function hydrateComposerTargets() {
  const { root, mainColumn, asideColumn, allPanels } = getPanelColumns();
  const targets = [
    { selector: 'header.topbar', key: 'layout.topbar', role: 'container' },
    { selector: '.topbar__brand', key: 'layout.topbarBrand', role: 'container' },
    { selector: '.topbar__actions', key: 'layout.topbarActions', role: 'container' },
    { selector: '.quick-nav', key: 'layout.quickNav', role: 'container' },
    { selector: '.shell', key: 'layout.shell', role: 'container' },
    { selector: '.side-nav', key: 'layout.sideNav', role: 'container' },
    { selector: 'main[data-shell]', key: 'layout.main', role: 'container' },
    { selector: '.page-main', key: 'layout.pageMain', role: 'container' },
    { selector: '.page-aside', key: 'layout.pageAside', role: 'container' },
    { selector: '.footer', key: 'layout.footer', role: 'container' },
  ];
  targets.forEach(({ selector, key, role }) => {
    const node = document.querySelector(selector);
    if (!node) return;
    if (!node.dataset.composerKey) node.dataset.composerKey = key;
    if (role && !node.dataset.composerRole) node.dataset.composerRole = role;
  });
  allPanels.forEach((panel) => {
    if (!panel.dataset.composerSection) return;
    if (!panel.dataset.composerKey) {
      panel.dataset.composerKey = `panel.${panel.dataset.composerSection}`;
    }
    panel.dataset.composerRole = panel.dataset.composerRole || 'panel';
    panel.dataset.composerDraggable = 'true';
    hydrateComposerTextTargets(panel, `panel.${panel.dataset.composerSection}`);
  });
  const dropZones = [mainColumn || root, asideColumn].filter(Boolean);
  dropZones.forEach((zone) => {
    zone.dataset.composerDroppable = 'true';
  });
  const quickNav = document.querySelector('.quick-nav');
  if (quickNav) {
    quickNav.dataset.composerNavZone = 'quick';
  }
  document.querySelectorAll('.side-nav__group').forEach((group) => {
    group.dataset.composerNavZone = 'side';
  });
  document.querySelectorAll('.quick-nav .quick-link').forEach((link) => {
    link.dataset.composerNavItem = 'true';
  });
  document.querySelectorAll('.side-nav__item').forEach((item) => {
    item.dataset.composerNavItem = 'true';
  });
  const grids = Array.from(document.querySelectorAll('.grid:not(.form-grid)'));
  grids.forEach((grid, index) => {
    if (!grid.dataset.composerKey) {
      const parentKey = grid.closest('[data-composer-key]')?.dataset.composerKey;
      grid.dataset.composerKey = parentKey ? `${parentKey}.grid.${index + 1}` : `grid.${index + 1}`;
    }
    grid.dataset.composerRole = grid.dataset.composerRole || 'grid';
    grid.dataset.composerGrid = 'true';
    Array.from(grid.children || []).forEach((child, childIndex) => {
      if (!child.dataset.composerKey) {
        child.dataset.composerKey = `${grid.dataset.composerKey}.item.${childIndex + 1}`;
      }
      child.dataset.composerRole = child.dataset.composerRole || 'grid-item';
      child.dataset.composerDraggable = 'true';
      hydrateComposerTextTargets(child, child.dataset.composerKey);
    });
  });
}

function applyComposerStyleOverridesToPage(settings = readComposerSettings()) {
  if (!document.body) return;
  hydrateComposerTargets();
  const overrides = settings?.styleOverrides || {};
  document.querySelectorAll('[data-composer-key]').forEach((node) => {
    const key = node.dataset.composerKey || '';
    if (!key) return;
    applyComposerOverridesToNode(node, overrides[key] || {});
  });
}

function escapeComposerSelector(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/"/g, '\\"');
}

function applyComposerTextOverridesToPage(settings = readComposerSettings()) {
  if (!document.body) return;
  hydrateComposerTargets();
  const overrides = settings?.textOverrides || {};
  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    const selector = `[data-composer-key="${escapeComposerSelector(key)}"]`;
    document.querySelectorAll(selector).forEach((node) => {
      if (node.matches('input, textarea')) {
        node.value = value;
        return;
      }
      if (node.dataset.composerText !== 'true' && node.dataset.composerDefault === undefined) {
        return;
      }
      node.textContent = value;
    });
  });
}

function applyComposerDomOrdersToPage(settings = readComposerSettings()) {
  if (!document.body) return;
  hydrateComposerTargets();
  const domOrders = settings?.domOrders;
  if (!domOrders || typeof domOrders !== 'object') return;
  Object.entries(domOrders).forEach(([parentKey, order]) => {
    if (!Array.isArray(order) || !order.length) return;
    const selector = `[data-composer-key="${escapeComposerSelector(parentKey)}"]`;
    const parent = document.querySelector(selector);
    if (!parent) return;
    const children = Array.from(parent.children || []).filter((child) => child.dataset?.composerKey);
    if (!children.length) return;
    const byKey = new Map(children.map((child) => [child.dataset.composerKey, child]));
    const currentOrder = children.map((child) => child.dataset.composerKey).filter(Boolean);
    const merged = mergeOrders(order, currentOrder);
    merged.forEach((key) => {
      const child = byKey.get(key);
      if (child) parent.appendChild(child);
    });
  });
}

function initComposerTool() {
  const tool = document.querySelector('[data-composer-tool]');
  applyComposerDomOrdersToPage();
  applyComposerStyleOverridesToPage();
  applyComposerTextOverridesToPage();
  if (!tool) return;
  const bodyAllowed = document.body?.dataset?.composerAllowed;
  const allowed = bodyAllowed !== undefined ? bodyAllowed === 'true' : tool.dataset?.composerAllowed === 'true';
  if (!allowed) {
    tool.hidden = true;
    if (document.body) {
      document.body.dataset.composerMode = 'off';
    }
    if (composerOverlay) {
      composerOverlay.style.display = 'none';
    }
    applyComposerStyleOverridesToPage();
    return;
  }
  tool.hidden = false;
  if (!composerToolState || composerToolRoot !== tool) {
    composerToolState = createComposerTool(tool);
    composerToolRoot = tool;
  }
  composerToolState.refresh();
}

function createComposerTool(tool) {
  const body = document.body;
  const toggle = tool.querySelector('[data-composer-toggle]');
  const collapseButton = tool.querySelector('[data-composer-collapse]');
  const closeButton = tool.querySelector('[data-composer-close]');
  const dragHandles = Array.from(tool.querySelectorAll('[data-composer-drag]'));
  const selectionNote = tool.querySelector('[data-composer-selection]');
  const textInput = tool.querySelector('[data-composer-text-input]');
  const applyButton = tool.querySelector('[data-composer-apply]');
  const clearButton = tool.querySelector('[data-composer-clear]');
  const saveButtons = Array.from(tool.querySelectorAll('[data-composer-save]'));
  const cancelButtons = Array.from(tool.querySelectorAll('[data-composer-cancel]'));
  const statusLine = tool.querySelector('[data-composer-status]');
  const quickList = tool.querySelector('[data-composer-list="quick"]');
  const sideLists = tool.querySelector('[data-composer-side-lists]');
  const mainList = tool.querySelector('[data-composer-list="main"]');
  const asideList = tool.querySelector('[data-composer-list="aside"]');
  const asideBlock = tool.querySelector('[data-composer-aside-block]');
  const pageVerbositySelect = tool.querySelector('[data-composer-page-verbosity]');
  const pageVerbosityLabel = tool.querySelector('[data-composer-page-label]');
  const styleInputs = Array.from(tool.querySelectorAll('[data-composer-style]'));
  const inspectorNote = tool.querySelector('[data-composer-inspector-note]');
  const rawCssInput = tool.querySelector('[data-composer-raw]');
  const rawApplyButton = tool.querySelector('[data-composer-raw-apply]');
  const rawSyncButton = tool.querySelector('[data-composer-raw-sync]');
  const styleClearButton = tool.querySelector('[data-composer-style-clear]');
  const toolbarToggles = Array.from(tool.querySelectorAll('[data-composer-toggle-style]'));
  const toolbarSetters = Array.from(tool.querySelectorAll('[data-composer-style-set]'));
  const gridControls = tool.querySelector('[data-composer-grid-controls]');
  const moveUpButton = tool.querySelector('[data-composer-move-up]');
  const moveDownButton = tool.querySelector('[data-composer-move-down]');
  const treeRoot = tool.querySelector('[data-composer-tree]');
  const overlay = ensureComposerOverlay();
  const overlayBar = overlay?.querySelector('[data-composer-overlay-bar]');
  const overlayHandles = Array.from(overlay?.querySelectorAll('[data-composer-handle]') || []);
  const overlayLabel = overlay?.querySelector('[data-composer-overlay-label]');
  const overlayClear = overlay?.querySelector('[data-composer-overlay-clear]');
  const overlayExit = overlay?.querySelector('[data-composer-overlay-exit]');
  const dropLine = ensureComposerDropLine();

  let state = readComposerSettings();
  let hasDirty = false;
  let selected = null;
  let dragInfo = null;
  let overlayFrame = null;
  let overlayBound = false;
  let moving = false;
  let resizing = false;
  let resizeHandle = null;
  let moveStart = null;
  let activeDrag = null;
  let dragBound = false;
  let panelDrag = null;
  let dropTarget = null;
  const getPageKey = () => document.body?.dataset?.pageKey || 'default';

  const toolUiStorageKey = 'composer-tool-ui';

  const readToolUi = () => {
    try {
      const raw = window.localStorage?.getItem(toolUiStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const writeToolUi = (next) => {
    try {
      window.localStorage?.setItem(toolUiStorageKey, JSON.stringify(next));
    } catch (_error) {
      // Ignore persistence errors for private mode/etc.
    }
  };

  const applyToolUi = (ui) => {
    if (!tool) return;
    if (ui && typeof ui === 'object') {
      if (Number.isFinite(ui.left) && Number.isFinite(ui.top)) {
        tool.style.left = `${ui.left}px`;
        tool.style.top = `${ui.top}px`;
        tool.style.right = 'auto';
        tool.style.bottom = 'auto';
      }
      if (ui.collapsed) {
        tool.dataset.composerCollapsed = 'true';
      } else {
        tool.dataset.composerCollapsed = 'false';
      }
      if (collapseButton) {
        const isCollapsed = tool.dataset.composerCollapsed === 'true';
        collapseButton.textContent = isCollapsed ? 'Expand' : 'Collapse';
        collapseButton.setAttribute('aria-expanded', String(!isCollapsed));
      }
    }
  };

  const clampToolPosition = () => {
    const rect = tool.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    const nextLeft = Math.min(Math.max(8, rect.left), maxLeft);
    const nextTop = Math.min(Math.max(8, rect.top), maxTop);
    tool.style.left = `${nextLeft}px`;
    tool.style.top = `${nextTop}px`;
    tool.style.right = 'auto';
    tool.style.bottom = 'auto';
    return { left: nextLeft, top: nextTop };
  };

  const setCollapsed = (collapsed) => {
    tool.dataset.composerCollapsed = collapsed ? 'true' : 'false';
    if (collapseButton) {
      collapseButton.textContent = collapsed ? 'Expand' : 'Collapse';
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
    }
    const ui = readToolUi();
    writeToolUi({ ...ui, collapsed });
  };
  const setStatus = (message, isError = false) => {
    if (!statusLine) return;
    statusLine.textContent = message;
    statusLine.style.color = isError ? '#ff9a9a' : '';
  };

  applyToolUi(readToolUi());

  const isActive = () => body.dataset.composerMode === 'on';

  const isGlobalComposerKey = (key) => {
    if (!key) return false;
    return key.startsWith('layout.') || key.startsWith('nav.');
  };

  const resolveOverrideScope = (key) => (isGlobalComposerKey(key) ? 'global' : 'page');

  const getOverrideBucket = (scope, type) => {
    if (scope === 'global') {
      if (type === 'text') return state.globalTextOverrides;
      if (type === 'style') return state.globalStyleOverrides;
      if (type === 'dom') return state.globalDomOrders;
    }
    if (type === 'text') return state.pageTextOverrides;
    if (type === 'style') return state.pageStyleOverrides;
    if (type === 'dom') return state.pageDomOrders;
    return null;
  };

  const isGridOrFlexParent = (el) => {
    const parent = el?.parentElement;
    if (!parent) return false;
    const display = window.getComputedStyle(parent).display;
    return display === 'grid' || display === 'flex';
  };

  const canFreeMove = (el) => {
    if (!el) return false;
    if (el.dataset.composerFree === 'true') return true;
    return !isGridOrFlexParent(el);
  };

  const updateToggleLabel = (active) => {
    if (!toggle) return;
    toggle.textContent = active ? 'Exit Composer' : 'Enter Composer';
  };

  const getEditableText = (el) => {
    return readComposerTextValue(el);
  };

  const setEditableText = (el, value) => {
    if (!el) return;
    if (el.matches('input, textarea')) {
      el.value = value;
      return;
    }
    el.textContent = value;
  };

  const isTextEditableElement = (el) => {
    if (!el) return false;
    if (el.matches('input, textarea')) return true;
    if (el.dataset.composerText === 'true') return true;
    return el.dataset.composerDefault !== undefined;
  };

  const getComposerRole = (el) => {
    if (!el) return '';
    if (el.dataset.composerRole) return el.dataset.composerRole;
    if (el.dataset.composerSection) return 'panel';
    return '';
  };

  const setInspectorDisabled = (disabled) => {
    styleInputs.forEach((input) => {
      input.disabled = disabled;
    });
    if (rawCssInput) rawCssInput.disabled = disabled;
    if (rawApplyButton) rawApplyButton.disabled = disabled;
    if (rawSyncButton) rawSyncButton.disabled = disabled;
    if (styleClearButton) styleClearButton.disabled = disabled;
    if (moveUpButton) moveUpButton.disabled = disabled;
    if (moveDownButton) moveDownButton.disabled = disabled;
  };

  const describeSelection = (entry) => {
    if (!entry?.el) return 'No selection';
    const tag = entry.el.tagName ? entry.el.tagName.toLowerCase() : 'element';
    const text = getEditableText(entry.el).replace(/\s+/g, ' ');
    const clipped = text ? `${text.slice(0, 36)}${text.length > 36 ? '...' : ''}` : '';
    const key = entry.key || tag;
    return clipped ? `${key} (${tag}) "${clipped}"` : `${key} (${tag})`;
  };

  const updateOverlay = () => {
    if (!overlay) return;
    if (!isActive() || !selected?.el) {
      overlay.style.display = 'none';
      return;
    }
    const rect = selected.el.getBoundingClientRect();
    const inView =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    if (!inView) {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'block';
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.dataset.composerMove = canFreeMove(selected.el) ? 'enabled' : 'disabled';
    if (overlayLabel) {
      overlayLabel.textContent = describeSelection(selected);
    }
  };

  const scheduleOverlayUpdate = () => {
    if (!overlay || !selected || !isActive()) return;
    if (overlayFrame) return;
    overlayFrame = window.requestAnimationFrame(() => {
      overlayFrame = null;
      updateOverlay();
    });
  };

  const bindOverlayEvents = () => {
    if (overlayBound) return;
    overlayBound = true;
    window.addEventListener('resize', scheduleOverlayUpdate);
    window.addEventListener('scroll', scheduleOverlayUpdate, true);
  };

  const unbindOverlayEvents = () => {
    if (!overlayBound) return;
    overlayBound = false;
    window.removeEventListener('resize', scheduleOverlayUpdate);
    window.removeEventListener('scroll', scheduleOverlayUpdate, true);
  };

  const setMode = (active) => {
    body.dataset.composerMode = active ? 'on' : 'off';
    if (toggle) toggle.setAttribute('aria-expanded', String(active));
    updateToggleLabel(active);
    if (!active) {
      if (moving || resizing) {
        stopMoveResize();
      }
      clearSelection();
      unbindOverlayEvents();
      setDraggableState(false);
      hideDropLine();
    } else {
      setStatus('Composer mode active.');
      hydrateComposerTargets();
      applyComposerStyleOverridesToPage(state);
      applyComposerTextOverridesToPage(state);
      setDraggableState(true);
      bindOverlayEvents();
      scheduleOverlayUpdate();
    }
    updateActionButtons();
  };

  const clearSelection = () => {
    if (!selected) return;
    selected.el.classList.remove('is-composer-selected');
    selected.el.removeAttribute('contenteditable');
    selected = null;
    if (textInput) {
      textInput.value = '';
      textInput.disabled = true;
    }
    if (selectionNote) selectionNote.textContent = 'Select a label or heading to edit.';
    styleInputs.forEach((input) => {
      input.value = '';
    });
    if (rawCssInput) rawCssInput.value = '';
    setInspectorDisabled(true);
    updateSelectionNotes();
    syncListSelection();
    syncToolbarState();
    if (overlay) overlay.style.display = 'none';
  };

  const resetComposerTextToDefault = (settings) => {
    const overrides = settings?.textOverrides || {};
    document.querySelectorAll('[data-composer-key]').forEach((node) => {
      const key = node.dataset.composerKey || '';
      if (!key) return;
      if (overrides[key] !== undefined) return;
      if (node.dataset.composerDefault === undefined) return;
      if (node.matches('input, textarea')) {
        node.value = node.dataset.composerDefault;
        return;
      }
      if (node.dataset.composerText !== 'true' && node.dataset.composerDefault === undefined) {
        return;
      }
      node.textContent = node.dataset.composerDefault;
    });
  };

  const discardChanges = () => {
    if (!hasDirty) {
      setStatus('No changes to discard.');
      return;
    }
    hasDirty = false;
    clearSelection();
    state = { ...state, ...readComposerSettings() };
    state = readSettingsWithDefaults();
    syncEffectiveOverrides();
    hydrateComposerTargets();
    resetComposerTextToDefault(state);
    applyComposerDomOrdersToPage(state);
    applyComposerStyleOverridesToPage(state);
    applyComposerTextOverridesToPage(state);
    buildNavLists();
    buildPanelLists();
    buildHierarchyTree();
    syncToolbarState();
    updateActionButtons();
    setStatus('Composer changes discarded.');
  };

  const applyStyleOverrides = (el, overrides) => {
    applyComposerOverridesToNode(el, overrides);
  };

  const normalizeStyleProp = (prop) => {
    if (!prop) return '';
    if (COMPOSER_STYLE_PROPS.includes(prop)) return prop;
    const camel = prop.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return COMPOSER_STYLE_PROPS.includes(camel) ? camel : '';
  };

  const toCssProp = (prop) => prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

  const getStyleValue = (prop) => {
    if (!selected?.el) return '';
    const overrides = state.styleOverrides?.[selected.key];
    if (overrides && overrides[prop] !== undefined) return overrides[prop];
    return selected.el.style[prop] || '';
  };

  const syncStyleInputs = () => {
    styleInputs.forEach((input) => {
      const prop = normalizeStyleProp(input.dataset.composerStyle || '');
      if (!prop) return;
      input.value = getStyleValue(prop);
    });
    syncToolbarState();
  };

  const styleToRawDeclarations = (el) => {
    if (!el) return '';
    const lines = [];
    COMPOSER_STYLE_PROPS.forEach((prop) => {
      const value = el.style[prop];
      if (!value) return;
      lines.push(`${toCssProp(prop)}: ${value};`);
    });
    return lines.join('\n');
  };

  const syncRawCss = () => {
    if (!rawCssInput || !selected?.el) return;
    rawCssInput.value = styleToRawDeclarations(selected.el);
  };

  const syncToolbarState = () => {
    const hasSelection = Boolean(selected?.el);
    toolbarToggles.forEach((button) => {
      const prop = normalizeStyleProp(button.dataset.composerToggleStyle || '');
      const value = button.dataset.composerValue || '';
      if (!prop || !hasSelection) {
        button.classList.remove('is-active');
        button.disabled = !hasSelection;
        return;
      }
      const current = getStyleValue(prop);
      button.classList.toggle('is-active', current === value);
      button.disabled = false;
    });
    toolbarSetters.forEach((button) => {
      const prop = normalizeStyleProp(button.dataset.composerStyleSet || '');
      const value = button.dataset.composerValue || '';
      if (!prop || !hasSelection) {
        button.classList.remove('is-active');
        button.disabled = !hasSelection;
        return;
      }
      const current = getStyleValue(prop);
      button.classList.toggle('is-active', current === value);
      button.disabled = false;
    });
    if (gridControls) {
      if (!hasSelection) {
        gridControls.hidden = true;
      } else {
        const display = window.getComputedStyle(selected.el).display;
        gridControls.hidden = !(display === 'grid' || display === 'flex' || selected.el.dataset.composerGrid === 'true');
      }
    }
  };

  const setStyleOverride = (prop, value) => {
    if (!selected?.el || !selected?.key) return;
    const normalized = normalizeStyleProp(prop);
    if (!normalized) return;
    const trimmed = String(value || '').trim();
    const scope = resolveOverrideScope(selected.key);
    const styleBucket = getOverrideBucket(scope, 'style');
    if (!styleBucket) return;
    const bucket = styleBucket[selected.key] || {};
    if (!trimmed) {
      delete bucket[normalized];
    } else {
      bucket[normalized] = trimmed;
    }
    if (Object.keys(bucket).length) {
      styleBucket[selected.key] = bucket;
    } else {
      delete styleBucket[selected.key];
    }
    syncEffectiveOverrides();
    applyStyleOverrides(selected.el, state.styleOverrides[selected.key] || {});
  };

  const commitStyleOverridesFromElement = () => {
    if (!selected?.el || !selected?.key) return;
    const scope = resolveOverrideScope(selected.key);
    const styleBucket = getOverrideBucket(scope, 'style');
    if (!styleBucket) return;
    const next = {};
    COMPOSER_STYLE_PROPS.forEach((prop) => {
      const value = selected.el.style[prop];
      if (value) next[prop] = value;
    });
    if (Object.keys(next).length) {
      styleBucket[selected.key] = next;
    } else {
      delete styleBucket[selected.key];
    }
    syncEffectiveOverrides();
    syncStyleInputs();
    syncRawCss();
  };

  const updateSelectionNotes = () => {
    if (selectionNote) {
      selectionNote.textContent = selected?.textEditable
        ? `Editing ${selected.key}`
        : selected
          ? `Selected ${selected.key}. Style-only selection.`
          : 'Select a label or heading to edit.';
    }
    if (inspectorNote) {
      inspectorNote.textContent = selected ? `Selected ${selected.key}` : 'Select a panel or label to edit.';
    }
  };

  const syncListSelection = () => {
    const selectedKey = selected?.key || '';
    const panelKey = selectedKey.startsWith('panel.') ? selectedKey.slice('panel.'.length) : '';
    const navKey = selectedKey.startsWith('nav.item.') ? selectedKey.slice('nav.item.'.length) : '';
    const markList = (listEl, matchKey) => {
      Array.from(listEl?.querySelectorAll('[data-composer-item]') || []).forEach((item) => {
        const isMatch = matchKey && item.dataset.composerItem === matchKey;
        item.classList.toggle('is-selected', isMatch);
      });
    };
    markList(mainList, panelKey);
    markList(asideList, panelKey);
    markList(quickList, navKey);
    if (sideLists) {
      sideLists.querySelectorAll('.composer-tool__list').forEach((listEl) => markList(listEl, navKey));
    }
    if (treeRoot) {
      treeRoot.querySelectorAll('[data-composer-tree-key]').forEach((button) => {
        const isMatch = selectedKey && button.dataset.composerTreeKey === selectedKey;
        button.classList.toggle('is-selected', isMatch);
      });
    }
  };

  const composerTreeNodes = (rootEl) => {
    const nodes = [];
    Array.from(rootEl.children || []).forEach((child) => {
      if (child.closest('[data-composer-tool], [data-composer-overlay], [data-composer-drop-line]')) return;
      const childNodes = composerTreeNodes(child);
      if (child.dataset?.composerKey) {
        nodes.push({ el: child, key: child.dataset.composerKey, children: childNodes });
        return;
      }
      if (childNodes.length) {
        nodes.push(...childNodes);
      }
    });
    return nodes;
  };

  const composerTreeLabel = (el) => {
    const key = el.dataset?.composerKey || 'element';
    const tag = el.tagName ? el.tagName.toLowerCase() : 'node';
    const text = readComposerTextValue(el).replace(/\s+/g, ' ');
    const snippet = text ? `${text.slice(0, 28)}${text.length > 28 ? '...' : ''}` : '';
    return snippet ? `${key} (${tag}) ${snippet}` : `${key} (${tag})`;
  };

  const buildHierarchyTree = () => {
    if (!treeRoot) return;
    treeRoot.innerHTML = '';
    const nodes = composerTreeNodes(document.body);
    const list = document.createElement('ul');
    list.className = 'composer-tree__list';
    const renderNode = (node) => {
      const li = document.createElement('li');
      li.className = 'composer-tree__item';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'composer-tree__button';
      button.dataset.composerTreeKey = node.key;
      button.textContent = composerTreeLabel(node.el);
      button.title = node.key;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectElement(node.el);
      });
      li.appendChild(button);
      if (node.children && node.children.length) {
        const childList = document.createElement('ul');
        childList.className = 'composer-tree__list';
        node.children.forEach((child) => childList.appendChild(renderNode(child)));
        li.appendChild(childList);
      }
      return li;
    };
    nodes.forEach((node) => list.appendChild(renderNode(node)));
    treeRoot.appendChild(list);
    syncListSelection();
  };

  const setDraggableState = (active) => {
    document.querySelectorAll('[data-composer-draggable="true"]').forEach((node) => {
      const isForm = node.matches('input, textarea, select, button');
      node.draggable = active && !isForm;
    });
    document.querySelectorAll('[data-composer-nav-item="true"]').forEach((node) => {
      node.draggable = active;
    });
  };

  const resolveComposerTarget = (target) => {
    if (!target) return null;
    const keyTarget = target.closest('[data-composer-key]');
    if (keyTarget && !['panel', 'container'].includes(keyTarget.dataset.composerRole || '')) {
      return keyTarget;
    }
    const panelTarget = target.closest('[data-composer-role="panel"], [data-composer-role="container"]');
    return panelTarget || keyTarget;
  };

  const selectElement = (el) => {
    const key = el.dataset.composerKey || '';
    if (!key) return;
    if (selected?.el && selected.el !== el) {
      selected.el.classList.remove('is-composer-selected');
      selected.el.removeAttribute('contenteditable');
    }
    const defaultText = el.dataset.composerDefault || getEditableText(el);
    if (el.dataset.composerDefault === undefined) {
      el.dataset.composerDefault = defaultText;
    }
    const textEditable = isTextEditableElement(el);
    const role = getComposerRole(el);
    selected = { el, key, defaultText, textEditable, role };
    el.classList.add('is-composer-selected');
    if (textInput) {
      textInput.value = textEditable ? getEditableText(el) : '';
      textInput.disabled = !textEditable;
    }
    const styleOverrides = state.styleOverrides?.[key] || {};
    applyStyleOverrides(el, styleOverrides);
    syncStyleInputs();
    syncRawCss();
    setInspectorDisabled(false);
    updateSelectionNotes();
    syncListSelection();
    syncToolbarState();
    updateOverlay();
  };

  const startInlineEditing = (el) => {
    const key = el?.dataset?.composerKey || '';
    if (!key) return;
    if (el.matches('input, textarea, select')) {
      selectElement(el);
      el.focus({ preventScroll: true });
      return;
    }
    selectElement(el);
    if (!isTextEditableElement(el)) return;
    if (el.getAttribute('contenteditable') === 'true') return;
    el.setAttribute('contenteditable', 'true');
    el.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const onKey = (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        el.blur();
      }
    };
  const stop = () => {
    el.removeAttribute('contenteditable');
    el.removeEventListener('keydown', onKey);
    scheduleOverlayUpdate();
  };
  el.addEventListener('blur', stop, { once: true });
  el.addEventListener('keydown', onKey);
  };

  const updateActionButtons = () => {
    const enabled = hasDirty;
    saveButtons.forEach((button) => {
      button.disabled = !enabled;
    });
    cancelButtons.forEach((button) => {
      button.disabled = !enabled;
    });
  };

  const noteDirty = () => {
    hasDirty = true;
    setStatus('Changes staged. Save to persist.');
    updateActionButtons();
  };

  const updateSelectionText = (value) => {
    if (!selected || !selected.textEditable) return;
    setEditableText(selected.el, value);
    updateOverlay();
  };

  const pointerInfo = (event) => {
    const rect = selected?.el?.getBoundingClientRect();
    return {
      x: event.clientX,
      y: event.clientY,
      left: parseFloat(selected?.el?.style?.left || '0'),
      top: parseFloat(selected?.el?.style?.top || '0'),
      width: rect?.width || 0,
      height: rect?.height || 0,
    };
  };

  const onPanelDragMove = (event) => {
    if (!panelDrag) return;
    const dx = event.clientX - panelDrag.x;
    const dy = event.clientY - panelDrag.y;
    const nextLeft = panelDrag.left + dx;
    const nextTop = panelDrag.top + dy;
    tool.style.left = `${nextLeft}px`;
    tool.style.top = `${nextTop}px`;
    tool.style.right = 'auto';
    tool.style.bottom = 'auto';
  };

  const stopPanelDrag = () => {
    if (!panelDrag) return;
    panelDrag = null;
    tool.classList.remove('is-composer-panel-dragging');
    window.removeEventListener('mousemove', onPanelDragMove);
    const clamped = clampToolPosition();
    const ui = readToolUi();
    writeToolUi({ ...ui, left: clamped.left, top: clamped.top });
  };

  const makeAbsoluteIfNeeded = (el, { allowAbsolute = true } = {}) => {
    if (!allowAbsolute) return;
    if (!el) return;
    const parent = el.offsetParent || el.parentElement;
    if (!parent) return;
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.position === 'static') {
      parent.style.position = 'relative';
      const parentKey = parent.dataset.composerKey || '';
      if (parentKey) {
        const scope = resolveOverrideScope(parentKey);
        const styleBucket = getOverrideBucket(scope, 'style');
        if (styleBucket) {
          const bucket = styleBucket[parentKey] || {};
          bucket.position = 'relative';
          styleBucket[parentKey] = bucket;
          syncEffectiveOverrides();
        }
        noteDirty();
      }
    }
    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const currentPos = window.getComputedStyle(el).position;
    if (currentPos !== 'absolute' && currentPos !== 'fixed') {
      el.style.position = 'absolute';
      el.style.left = `${rect.left - parentRect.left + parent.scrollLeft}px`;
      el.style.top = `${rect.top - parentRect.top + parent.scrollTop}px`;
      el.style.width = `${rect.width}px`;
    }
  };

  const onMoveDrag = (event) => {
    if (!moving || !selected?.el || !moveStart) return;
    const dx = event.clientX - moveStart.x;
    const dy = event.clientY - moveStart.y;
    const nextLeft = moveStart.left + dx;
    const nextTop = moveStart.top + dy;
    selected.el.style.left = `${nextLeft}px`;
    selected.el.style.top = `${nextTop}px`;
    updateOverlay();
  };

  const onResizeDrag = (event) => {
    if (!resizing || !selected?.el || !moveStart || !resizeHandle) return;
    const dx = event.clientX - moveStart.x;
    const dy = event.clientY - moveStart.y;
    const allowAbsolute = canFreeMove(selected.el);
    let nextWidth = moveStart.width;
    let nextHeight = moveStart.height;
    if (resizeHandle.includes('e')) nextWidth = moveStart.width + dx;
    if (resizeHandle.includes('s')) nextHeight = moveStart.height + dy;
    if (resizeHandle.includes('w')) nextWidth = moveStart.width - dx;
    if (resizeHandle.includes('n')) nextHeight = moveStart.height - dy;
    nextWidth = Math.max(40, nextWidth);
    nextHeight = Math.max(40, nextHeight);
    if (allowAbsolute && (resizeHandle.includes('w') || resizeHandle.includes('n'))) {
      makeAbsoluteIfNeeded(selected.el, { allowAbsolute });
    }
    if (allowAbsolute && resizeHandle.includes('w')) {
      const nextLeft = moveStart.left + (moveStart.width - nextWidth);
      selected.el.style.left = `${nextLeft}px`;
    }
    if (allowAbsolute && resizeHandle.includes('n')) {
      const nextTop = moveStart.top + (moveStart.height - nextHeight);
      selected.el.style.top = `${nextTop}px`;
    }
    selected.el.style.width = `${nextWidth}px`;
    selected.el.style.height = `${nextHeight}px`;
    updateOverlay();
  };

  const stopMoveResize = () => {
    moving = false;
    resizing = false;
    resizeHandle = null;
    moveStart = null;
    window.removeEventListener('mousemove', onMoveDrag);
    window.removeEventListener('mousemove', onResizeDrag);
    commitStyleOverridesFromElement();
    noteDirty();
    updateOverlay();
  };

  const applyRawCss = (text) => {
    if (!selected) return;
    const lines = String(text || '').split('\n');
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const match = trimmed.match(/^([a-zA-Z-]+)\s*:\s*(.+?);?$/);
      if (!match) return;
      const prop = normalizeStyleProp(match[1]);
      if (!prop) return;
      setStyleOverride(prop, match[2].trim());
    });
    noteDirty();
    syncStyleInputs();
    syncRawCss();
  };

  const updateLayoutFromDom = () => {
    const pageKey = getPageKey();
    const { mainColumn, asideColumn } = getPanelColumns();
    if (!mainColumn) return;
    const next = getPageLayoutState(pageKey);
    next.main = Array.from(mainColumn.querySelectorAll('.panel'))
      .map((panel) => panel.dataset.composerSection)
      .filter(Boolean);
    if (asideColumn) {
      next.aside = Array.from(asideColumn.querySelectorAll('.panel'))
        .map((panel) => panel.dataset.composerSection)
        .filter(Boolean);
    } else {
      next.aside = [];
    }
    state.pageLayouts = state.pageLayouts || {};
    state.pageLayouts[pageKey] = next;
    applyPageLayoutFromSettings(state);
    buildHierarchyTree();
    noteDirty();
  };

  const updateNavOrdersFromDom = () => {
    const quick = document.querySelector('.quick-nav');
    if (quick) {
      const quickOrder = Array.from(quick.querySelectorAll('.quick-link:not(.quick-link--context)'))
        .map((link) => link.dataset.navKey)
        .filter(Boolean);
      state.quickActionsOrder = mergeOrders(quickOrder, state.quickActionsOrder);
    }
    const groups = Array.from(document.querySelectorAll('.side-nav__group'));
    if (groups.length) {
      const sideOrder = groups
        .flatMap((group) => Array.from(group.querySelectorAll('.side-nav__item')))
        .map((item) => item.dataset.navSection)
        .filter(Boolean);
      state.sideNavOrder = mergeOrders(sideOrder, state.sideNavOrder);
    }
    buildHierarchyTree();
    noteDirty();
  };

  const updateDomOrderFromElement = (el) => {
    if (!el) return;
    if (el.classList?.contains('panel') || el.dataset?.composerRole === 'panel') return;
    if (el.closest('.quick-nav') || el.closest('.side-nav')) return;
    const parent = el.parentElement;
    if (!parent) return;
    const parentKey = parent.dataset?.composerKey || '';
    if (!parentKey) return;
    const childKeys = Array.from(parent.children || [])
      .map((child) => child.dataset?.composerKey || '')
      .filter(Boolean);
    if (!childKeys.length) return;
    const scope = resolveOverrideScope(parentKey);
    const domBucket = getOverrideBucket(scope, 'dom');
    if (domBucket) {
      domBucket[parentKey] = mergeOrders(childKeys, domBucket[parentKey]);
      syncEffectiveOverrides();
    }
    buildHierarchyTree();
    noteDirty();
  };

  const moveSibling = (direction) => {
    if (!selected?.el) return;
    const el = selected.el;
    const parent = el.parentElement;
    if (!parent) return;
    if (direction < 0) {
      const prev = el.previousElementSibling;
      if (prev) parent.insertBefore(el, prev);
    } else {
      const next = el.nextElementSibling;
      if (next) parent.insertBefore(next, el);
    }
    updateOverlay();
    if (el.classList.contains('panel')) {
      updateLayoutFromDom();
    } else if (el.closest('.quick-nav') || el.closest('.side-nav__group')) {
      updateNavOrdersFromDom();
    } else {
      updateDomOrderFromElement(el);
    }
  };

  const markDropTarget = (target) => {
    if (dropTarget && dropTarget !== target) {
      dropTarget.classList.remove('is-composer-drop-target');
    }
    dropTarget = target;
    if (dropTarget) {
      dropTarget.classList.add('is-composer-drop-target');
    }
  };

  const showDropLine = (rect, axis, before) => {
    if (!dropLine || !rect) return;
    dropLine.style.display = 'block';
    if (axis === 'x') {
      dropLine.style.width = '3px';
      dropLine.style.height = `${rect.height}px`;
      dropLine.style.left = `${before ? rect.left - 2 : rect.right - 2}px`;
      dropLine.style.top = `${rect.top}px`;
      return;
    }
    dropLine.style.height = '3px';
    dropLine.style.width = `${rect.width}px`;
    dropLine.style.left = `${rect.left}px`;
    dropLine.style.top = `${before ? rect.top - 2 : rect.bottom - 2}px`;
  };

  const hideDropLine = () => {
    if (dropLine) dropLine.style.display = 'none';
    if (dropTarget) {
      dropTarget.classList.remove('is-composer-drop-target');
      dropTarget = null;
    }
  };

  const findPanelInsertTarget = (zone, clientY) => {
    const panels = Array.from(zone.querySelectorAll('.panel'));
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return panel;
      }
    }
    return null;
  };

  const findNavInsertTarget = (zone, clientY) => {
    const items = Array.from(
      zone.dataset.composerNavZone === 'quick'
        ? zone.querySelectorAll('.quick-link:not(.quick-link--context)')
        : zone.querySelectorAll('.side-nav__item'),
    );
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return item;
      }
    }
    return null;
  };

  const resolveDragAxis = (zone) => {
    if (!zone) return 'y';
    const style = window.getComputedStyle(zone);
    if (style.display === 'flex') {
      return style.flexDirection.startsWith('row') ? 'x' : 'y';
    }
    if (style.display === 'grid') {
      const items = Array.from(zone.children || []).filter((child) => child.dataset?.composerKey);
      if (items.length > 1) {
        const first = items[0].getBoundingClientRect();
        for (let i = 1; i < items.length; i += 1) {
          const rect = items[i].getBoundingClientRect();
          if (Math.abs(rect.top - first.top) < 8) {
            return 'x';
          }
        }
      }
    }
    return 'y';
  };

  const findGridInsertTarget = (zone, target, event) => {
    if (!zone || !target || target === activeDrag?.el) return null;
    const rect = target.getBoundingClientRect();
    const axis = resolveDragAxis(zone);
    const midpoint = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const before = axis === 'x' ? event.clientX < midpoint : event.clientY < midpoint;
    return { target, rect, axis, before };
  };

  const bindDragHandlers = () => {
    if (dragBound) return;
    dragBound = true;

    document.addEventListener('dragstart', (event) => {
      if (!isActive()) return;
      const panel = event.target.closest('[data-composer-draggable="true"]');
      if (panel && panel.classList.contains('panel')) {
        activeDrag = { type: 'panel', el: panel, zone: null, before: null };
        panel.classList.add('is-composer-dragging');
        event.dataTransfer.effectAllowed = 'move';
        return;
      }
      const navItem = event.target.closest('[data-composer-nav-item="true"]');
      if (navItem) {
        const zone = navItem.closest('[data-composer-nav-zone]');
        activeDrag = { type: 'nav', el: navItem, zone, before: null, zoneType: zone?.dataset?.composerNavZone || '' };
        navItem.classList.add('is-composer-dragging');
        event.dataTransfer.effectAllowed = 'move';
        return;
      }
      const component = event.target.closest('[data-composer-draggable="true"]');
      if (component && !component.classList.contains('panel') && !component.dataset.composerNavItem) {
        const zone = component.closest('[data-composer-grid="true"]');
        if (!zone) return;
        activeDrag = { type: 'grid', el: component, zone, before: null };
        component.classList.add('is-composer-dragging');
        event.dataTransfer.effectAllowed = 'move';
      }
    });

    document.addEventListener('dragover', (event) => {
      if (!isActive() || !activeDrag) return;
      const zoneSelector =
        activeDrag.type === 'panel'
          ? '[data-composer-droppable="true"]'
          : activeDrag.type === 'nav'
            ? '[data-composer-nav-zone]'
            : '[data-composer-grid="true"]';
      const zone = event.target.closest(zoneSelector);
      if (!zone) return;
      if (activeDrag.type === 'nav' && zone.dataset.composerNavZone !== activeDrag.zoneType) return;
      if (activeDrag.type === 'grid' && zone !== activeDrag.zone) return;
      event.preventDefault();
      if (activeDrag.type === 'grid') {
        const target = event.target.closest('[data-composer-draggable="true"]');
        const info = findGridInsertTarget(zone, target, event);
        activeDrag.zone = zone;
        if (info) {
          activeDrag.before = info.before ? info.target : info.target.nextElementSibling;
          showDropLine(info.rect, info.axis, info.before);
          markDropTarget(info.target);
        } else {
          const rect = zone.getBoundingClientRect();
          const axis = resolveDragAxis(zone);
          showDropLine(rect, axis, false);
          markDropTarget(null);
          activeDrag.before = null;
        }
        return;
      }
      const before =
        activeDrag.type === 'panel' ? findPanelInsertTarget(zone, event.clientY) : findNavInsertTarget(zone, event.clientY);
      activeDrag.zone = zone;
      activeDrag.before = before;
      if (before) {
        const rect = before.getBoundingClientRect();
        showDropLine(rect, 'y', true);
        markDropTarget(before);
      } else {
        const rect = zone.getBoundingClientRect();
        showDropLine(rect, 'y', false);
        markDropTarget(null);
      }
    });

    document.addEventListener('drop', (event) => {
      if (!isActive() || !activeDrag) return;
      const { el, zone, before, type } = activeDrag;
      hideDropLine();
      if (!zone || !el) {
        activeDrag = null;
        return;
      }
      event.preventDefault();
      if (before) {
        zone.insertBefore(el, before);
      } else {
        zone.appendChild(el);
      }
      if (type === 'panel') {
        updateLayoutFromDom();
      } else if (type === 'nav') {
        updateNavOrdersFromDom();
      } else if (type === 'grid') {
        updateDomOrderFromElement(el);
      }
      updateOverlay();
      activeDrag = null;
    });

    document.addEventListener('dragend', () => {
      if (!activeDrag) return;
      activeDrag.el?.classList?.remove('is-composer-dragging');
      activeDrag = null;
      hideDropLine();
    });
  };

  const clearSelectedOverrides = ({ clearStyles = false } = {}) => {
    if (!selected) return;
    const scope = resolveOverrideScope(selected.key);
    if (selected.textEditable) {
      const textBucket = getOverrideBucket(scope, 'text');
      if (textBucket) delete textBucket[selected.key];
      syncEffectiveOverrides();
    }
    if (clearStyles) {
      const styleBucket = getOverrideBucket(scope, 'style');
      if (styleBucket) delete styleBucket[selected.key];
      syncEffectiveOverrides();
      applyStyleOverrides(selected.el, {});
      syncStyleInputs();
      syncRawCss();
    }
    if (selected.textEditable) {
      const fallback = selected.defaultText || '';
      if (textInput) textInput.value = fallback;
      updateSelectionText(fallback);
    }
    noteDirty();
    scheduleOverlayUpdate();
  };

  toggle?.addEventListener('click', () => {
    setMode(!isActive());
  });

  collapseButton?.addEventListener('click', () => {
    const collapsed = tool.dataset.composerCollapsed === 'true';
    setCollapsed(!collapsed);
  });

  closeButton?.addEventListener('click', () => setMode(false));

  dragHandles.forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = tool.getBoundingClientRect();
      panelDrag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      tool.classList.add('is-composer-panel-dragging');
      window.addEventListener('mousemove', onPanelDragMove);
      window.addEventListener('mouseup', stopPanelDrag, { once: true });
    });
  });

  overlayClear?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearSelectedOverrides({ clearStyles: true });
  });

  overlayExit?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMode(false);
  });

  overlayBar?.addEventListener('mousedown', (event) => {
    if (!isActive() || !selected?.el) return;
    if (!canFreeMove(selected.el)) {
      setStatus('Use drag-and-drop to reorder grid or flex items.', true);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moving = true;
    moveStart = pointerInfo(event);
    makeAbsoluteIfNeeded(selected.el, { allowAbsolute: canFreeMove(selected.el) });
    window.addEventListener('mousemove', onMoveDrag);
    window.addEventListener('mouseup', stopMoveResize, { once: true });
  });

  overlayHandles.forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      if (!isActive() || !selected?.el) return;
      event.preventDefault();
      event.stopPropagation();
      resizing = true;
      resizeHandle = handle.dataset.composerHandle || '';
      moveStart = pointerInfo(event);
      window.addEventListener('mousemove', onResizeDrag);
      window.addEventListener('mouseup', stopMoveResize, { once: true });
    });
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!isActive()) return;
      if (tool.contains(event.target)) return;
      if (overlay && overlay.contains(event.target)) return;
      if (event.target.closest('[contenteditable="true"]')) return;
      const target = event.altKey
        ? event.target.closest('[data-composer-role="panel"], [data-composer-role="container"], [data-composer-role="grid"]') ||
          resolveComposerTarget(event.target)
        : resolveComposerTarget(event.target);
      event.preventDefault();
      event.stopPropagation();
      if (!target) {
        clearSelection();
        return;
      }
      selectElement(target);
    },
    true,
  );

  document.addEventListener(
    'dblclick',
    (event) => {
      if (!isActive()) return;
      if (tool.contains(event.target)) return;
      if (overlay && overlay.contains(event.target)) return;
      const target = resolveComposerTarget(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      startInlineEditing(target);
    },
    true,
  );

  document.addEventListener('keydown', (event) => {
    if (!isActive()) return;
    if (event.key === 'Escape') {
      if (moving || resizing) {
        stopMoveResize();
        return;
      }
      if (selected?.el?.getAttribute('contenteditable') === 'true') {
        selected.el.blur();
        return;
      }
      if (selected) {
        clearSelection();
        return;
      }
      setMode(false);
    }
  });

  document.addEventListener('input', (event) => {
    if (!isActive() || !selected) return;
    if (!selected.textEditable) return;
    if (event.target !== selected.el) return;
    const value = getEditableText(selected.el);
    if (textInput) textInput.value = value;
    const scope = resolveOverrideScope(selected.key);
    const textBucket = getOverrideBucket(scope, 'text');
    if (textBucket) {
      textBucket[selected.key] = value.trim();
      syncEffectiveOverrides();
    }
    noteDirty();
    updateOverlay();
  });

  textInput?.addEventListener('input', () => {
    if (!selected || !selected.textEditable) return;
    updateSelectionText(textInput.value);
    const scope = resolveOverrideScope(selected.key);
    const textBucket = getOverrideBucket(scope, 'text');
    if (textBucket) {
      textBucket[selected.key] = textInput.value.trim();
      syncEffectiveOverrides();
    }
    noteDirty();
    scheduleOverlayUpdate();
  });

  applyButton?.addEventListener('click', () => {
    if (!selected || !selected.textEditable) {
      setStatus('Select something to edit first.', true);
      return;
    }
    const next = textInput ? textInput.value.trim() : '';
    if (!next) {
      setStatus('Text cannot be empty.', true);
      return;
    }
    const scope = resolveOverrideScope(selected.key);
    const textBucket = getOverrideBucket(scope, 'text');
    if (textBucket) {
      textBucket[selected.key] = next;
      syncEffectiveOverrides();
    }
    updateSelectionText(next);
    noteDirty();
    scheduleOverlayUpdate();
  });

  clearButton?.addEventListener('click', () => {
    if (!selected || !selected.textEditable) {
      setStatus('Select a text label to clear.', true);
      return;
    }
    clearSelectedOverrides();
  });

  styleInputs.forEach((input) => {
    const onChange = () => {
      if (!selected) return;
      const prop = normalizeStyleProp(input.dataset.composerStyle || '');
      if (!prop) return;
      setStyleOverride(prop, input.value);
      noteDirty();
      syncRawCss();
      syncToolbarState();
      scheduleOverlayUpdate();
    };
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange);
  });

  toolbarToggles.forEach((button) => {
    button.addEventListener('click', () => {
      if (!selected) {
        setStatus('Select an element to format.', true);
        return;
      }
      const prop = normalizeStyleProp(button.dataset.composerToggleStyle || '');
      if (!prop) return;
      const value = button.dataset.composerValue || '';
      const current = getStyleValue(prop);
      const next = current === value ? '' : value;
      setStyleOverride(prop, next);
      noteDirty();
      syncStyleInputs();
      syncRawCss();
      syncToolbarState();
      scheduleOverlayUpdate();
    });
  });

  toolbarSetters.forEach((button) => {
    button.addEventListener('click', () => {
      if (!selected) {
        setStatus('Select an element to format.', true);
        return;
      }
      const prop = normalizeStyleProp(button.dataset.composerStyleSet || '');
      if (!prop) return;
      const value = button.dataset.composerValue || '';
      setStyleOverride(prop, value);
      noteDirty();
      syncStyleInputs();
      syncRawCss();
      syncToolbarState();
      scheduleOverlayUpdate();
    });
  });

  rawApplyButton?.addEventListener('click', () => {
    if (!selected) {
      setStatus('Select an element to apply CSS.', true);
      return;
    }
    applyRawCss(rawCssInput?.value || '');
    scheduleOverlayUpdate();
  });

  rawSyncButton?.addEventListener('click', () => {
    if (!selected) {
      setStatus('Select an element to sync.', true);
      return;
    }
    syncStyleInputs();
    syncRawCss();
  });

  styleClearButton?.addEventListener('click', () => {
    if (!selected) {
      setStatus('Select an element to clear styles.', true);
      return;
    }
    clearSelectedOverrides({ clearStyles: true });
  });

  moveUpButton?.addEventListener('click', () => moveSibling(-1));
  moveDownButton?.addEventListener('click', () => moveSibling(1));

  pageVerbositySelect?.addEventListener('change', () => {
    const pageKey = getPageKey();
    const value = pageVerbositySelect.value || '';
    state.pageVerbosity = state.pageVerbosity || {};
    if (value) {
      state.pageVerbosity[pageKey] = value;
    } else {
      delete state.pageVerbosity[pageKey];
    }
    if (document.body) {
      document.body.dataset.verbosityPagePreset = value;
      if (!document.body.dataset.verbosityOverride) {
        document.body.dataset.verbosity = value || document.body.dataset.verbosityDefault || 'full';
      }
    }
    updateVerbosityToggleUI();
    noteDirty();
  });

  const listOrderKeys = (listEl) =>
    Array.from(listEl?.querySelectorAll('[data-composer-item]') || []).map((item) => item.dataset.composerItem);

  const bindSortableList = (listEl, onReorder, { allowCross = false } = {}) => {
    if (!listEl) return;
    listEl.dataset.composerCross = allowCross ? 'true' : 'false';
    if (listEl.dataset.composerBound === 'true') return;
    listEl.dataset.composerBound = 'true';
    listEl.addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-composer-item]');
      if (!item) return;
      dragInfo = { item, listEl };
      item.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', item.dataset.composerItem || '');
      event.dataTransfer?.setDragImage(item, 10, 10);
    });
    listEl.addEventListener('dragover', (event) => {
      if (!dragInfo) return;
      if (listEl.dataset.composerCross !== 'true' && dragInfo.listEl !== listEl) return;
      event.preventDefault();
      const target = event.target.closest('[data-composer-item]');
      if (!target) {
        listEl.appendChild(dragInfo.item);
        return;
      }
      if (target === dragInfo.item) return;
      const rect = target.getBoundingClientRect();
      const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;
      listEl.insertBefore(dragInfo.item, shouldInsertAfter ? target.nextSibling : target);
    });
    listEl.addEventListener('drop', (event) => {
      if (!dragInfo) return;
      if (listEl.dataset.composerCross !== 'true' && dragInfo.listEl !== listEl) return;
      event.preventDefault();
      dragInfo.item.classList.remove('is-dragging');
      dragInfo = null;
      onReorder();
    });
    listEl.addEventListener('dragend', () => {
      if (!dragInfo) return;
      if (listEl.dataset.composerCross !== 'true' && dragInfo.listEl !== listEl) return;
      dragInfo.item.classList.remove('is-dragging');
      dragInfo = null;
      onReorder();
    });
  };

  const buildList = (listEl, items) => {
    if (!listEl) return;
    listEl.innerHTML = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'composer-tool__item';
      li.dataset.composerItem = item.key;
      li.draggable = true;
      li.innerHTML = `<span class="composer-tool__drag" aria-hidden="true"></span><span>${item.label}</span>`;
      li.addEventListener('click', (event) => {
        if (dragInfo) return;
        event.preventDefault();
        event.stopPropagation();
        const navTarget = document.querySelector(`[data-nav-key="${item.key}"]`);
        if (navTarget) selectElement(navTarget);
      });
      listEl.appendChild(li);
    });
  };

  const getNavItems = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .map((link) => ({
        key: link.dataset.navKey || '',
        label: link.textContent.trim() || link.dataset.navKey || 'Untitled',
      }))
      .filter((entry) => entry.key);

  const buildNavLists = () => {
    buildList(quickList, getNavItems('.quick-nav .quick-link:not(.quick-link--context)'));
    if (sideLists) {
      sideLists.innerHTML = '';
      const groups = Array.from(document.querySelectorAll('.side-nav__group'));
      groups.forEach((group) => {
        const label = group.querySelector('.eyebrow')?.textContent.trim() || 'Section';
        const items = Array.from(group.querySelectorAll('.side-nav__link'))
          .map((link) => ({
            key: link.dataset.navKey || '',
            label: link.textContent.trim() || link.dataset.navKey || 'Untitled',
          }))
          .filter((entry) => entry.key);
        const wrapper = document.createElement('div');
        wrapper.className = 'composer-tool__list-block';
        const title = document.createElement('p');
        title.className = 'muted small';
        title.textContent = label;
        const list = document.createElement('ol');
        list.className = 'composer-tool__list';
        list.dataset.composerList = `side:${label}`;
        wrapper.appendChild(title);
        wrapper.appendChild(list);
        sideLists.appendChild(wrapper);
        buildList(list, items);
        bindSortableList(list, () => {
          state.sideNavOrder = mergeOrders(listOrderKeysFromSide(), state.sideNavOrder);
          reorderSideNav(state.sideNavOrder);
          noteDirty();
        });
      });
    }
    bindSortableList(quickList, () => {
      state.quickActionsOrder = mergeOrders(listOrderKeys(quickList), state.quickActionsOrder);
      reorderQuickNav(state.quickActionsOrder);
      noteDirty();
    });
  };

  const listOrderKeysFromSide = () => {
    if (!sideLists) return [];
    const lists = Array.from(sideLists.querySelectorAll('.composer-tool__list'));
    return lists.flatMap((list) => listOrderKeys(list));
  };

  const reorderQuickNav = (order) => {
    const container = document.querySelector('.quick-nav');
    if (!container) return;
    const links = Array.from(container.querySelectorAll('.quick-link:not(.quick-link--context)'));
    const byKey = new Map(links.map((link) => [link.dataset.navKey, link]));
    order.forEach((key) => {
      const link = byKey.get(key);
      if (link) container.appendChild(link);
    });
  };

  const reorderSideNav = (order) => {
    const groups = Array.from(document.querySelectorAll('.side-nav__group'));
    groups.forEach((group) => {
      const items = Array.from(group.querySelectorAll('.side-nav__item'));
      const byKey = new Map(items.map((item) => [item.dataset.navSection, item]));
      order.forEach((key) => {
        const item = byKey.get(key);
        if (item) group.appendChild(item);
      });
    });
  };

  const resolvePanelTitle = (panel, fallback) =>
    panel.querySelector('h2')?.textContent?.trim() ||
    panel.querySelector('h3')?.textContent?.trim() ||
    panel.querySelector('.eyebrow')?.textContent?.trim() ||
    fallback;

  const getPageLayoutState = (pageKey) => {
    const current = state.pageLayouts?.[pageKey] || {};
    return {
      main: Array.isArray(current.main) ? current.main.slice() : [],
      aside: Array.isArray(current.aside) ? current.aside.slice() : [],
      hidden: Array.isArray(current.hidden) ? current.hidden.slice() : [],
    };
  };

  const updatePanelLayoutFromLists = () => {
    const pageKey = getPageKey();
    const next = getPageLayoutState(pageKey);
    next.main = listOrderKeys(mainList);
    next.aside = listOrderKeys(asideList);
    state.pageLayouts = state.pageLayouts || {};
    state.pageLayouts[pageKey] = next;
    applyPageLayoutFromSettings(state);
    buildHierarchyTree();
    noteDirty();
  };

  const togglePanelHidden = (key, listItem, button) => {
    const pageKey = getPageKey();
    const next = getPageLayoutState(pageKey);
    const hidden = new Set(next.hidden || []);
    const wasHidden = hidden.has(key);
    if (wasHidden) {
      hidden.delete(key);
    } else {
      hidden.add(key);
    }
    next.hidden = Array.from(hidden);
    state.pageLayouts = state.pageLayouts || {};
    state.pageLayouts[pageKey] = next;
    applyPageLayoutFromSettings(state);
    if (listItem) {
      listItem.classList.toggle('is-hidden', !wasHidden);
    }
    if (button) {
      button.textContent = wasHidden ? 'Hide' : 'Show';
    }
    noteDirty();
  };

  const buildPanelList = (listEl, panels, hiddenSet) => {
    if (!listEl) return;
    listEl.innerHTML = '';
    panels.forEach((panel, index) => {
      const key = panel.dataset.composerSection || panel.id || `panel-${index + 1}`;
      panel.dataset.composerSection = key;
      if (!panel.dataset.composerKey) {
        panel.dataset.composerKey = `panel.${key}`;
      }
      const li = document.createElement('li');
      li.className = 'composer-tool__item';
      if (hiddenSet.has(key)) {
        li.classList.add('is-hidden');
      }
      li.dataset.composerItem = key;
      li.draggable = true;
      const label = resolvePanelTitle(panel, key);
      li.innerHTML = `<span class="composer-tool__drag" aria-hidden="true"></span><span>${label}</span>`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ghost composer-tool__toggle';
      toggle.textContent = hiddenSet.has(key) ? 'Show' : 'Hide';
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePanelHidden(key, li, toggle);
      });
      li.addEventListener('click', (event) => {
        if (dragInfo) return;
        event.preventDefault();
        event.stopPropagation();
        selectElement(panel);
      });
      li.appendChild(toggle);
      listEl.appendChild(li);
    });
  };

  const buildPanelLists = () => {
    applyPageLayoutFromSettings(state);
    const { mainColumn, asideColumn, mainPanels, asidePanels } = getPanelColumns();
    if (asideBlock) {
      asideBlock.hidden = !asideColumn;
    }
    const pageKey = getPageKey();
    const layout = getPageLayoutState(pageKey);
    const hiddenSet = new Set(layout.hidden || []);
    buildPanelList(mainList, mainPanels, hiddenSet);
    if (asideColumn) {
      buildPanelList(asideList, asidePanels, hiddenSet);
    } else if (asideList) {
      asideList.innerHTML = '';
    }
    bindSortableList(mainList, updatePanelLayoutFromLists, { allowCross: Boolean(asideColumn) });
    if (asideColumn) {
      bindSortableList(asideList, updatePanelLayoutFromLists, { allowCross: true });
    }
  };

  const saveComposer = async () => {
    syncEffectiveOverrides();
    const payload = new URLSearchParams();
    payload.set('intent', 'composer');
    payload.set('composerQuickActionsOrder', (state.quickActionsOrder || []).join(', '));
    payload.set('composerSideNavOrder', (state.sideNavOrder || []).join(', '));
    payload.set('composerThemeCss', state.themeCss || '');
    payload.set('composerAsideWidth', state.pageAsideWidth ? String(state.pageAsideWidth) : '');
    payload.set('composerTextOverrides', JSON.stringify(state.globalTextOverrides || {}));
    payload.set('composerStyleOverrides', JSON.stringify(state.globalStyleOverrides || {}));
    payload.set('composerDomOrders', JSON.stringify(state.globalDomOrders || {}));
    payload.set('composerPageKey', getPageKey());
    payload.set(
      'composerPageOverrides',
      JSON.stringify({
        textOverrides: state.pageTextOverrides || {},
        styleOverrides: state.pageStyleOverrides || {},
        domOrders: state.pageDomOrders || {},
      }),
    );
    payload.set('composerPageVerbosity', JSON.stringify(state.pageVerbosity || {}));
    payload.set('composerPageLayouts', JSON.stringify(state.pageLayouts || {}));
    try {
      const response = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'partial' },
        body: payload,
      });
      if (!response.ok) {
        throw new Error('Save failed');
      }
      hasDirty = false;
      body.dataset.composerSettings = JSON.stringify(state);
      setStatus('Composer settings saved.');
      updateActionButtons();
    } catch (error) {
      console.error(error);
      setStatus('Failed to save composer settings.', true);
    }
  };

  saveButtons.forEach((button) => {
    button.addEventListener('click', saveComposer);
  });
  cancelButtons.forEach((button) => {
    button.addEventListener('click', discardChanges);
  });

  const readSettingsWithDefaults = () => {
    const globalOverrides = buildOverrideBundle(state.globalOverrides || {});
    const pageOverrides = buildOverrideBundle(state.pageOverrides || {});
    return {
      themeCss: state.themeCss || '',
      quickActionsOrder: Array.isArray(state.quickActionsOrder) ? state.quickActionsOrder : [],
      sideNavOrder: Array.isArray(state.sideNavOrder) ? state.sideNavOrder : [],
      pageAsideWidth: Number.isFinite(state.pageAsideWidth) ? state.pageAsideWidth : null,
      pageVerbosity: state.pageVerbosity && typeof state.pageVerbosity === 'object' ? state.pageVerbosity : {},
      pageLayouts: state.pageLayouts && typeof state.pageLayouts === 'object' ? state.pageLayouts : {},
      globalOverrides,
      pageOverrides,
      globalTextOverrides: normalizeOverrideMap(globalOverrides.textOverrides),
      globalStyleOverrides: normalizeOverrideMap(globalOverrides.styleOverrides),
      globalDomOrders: normalizeOverrideMap(globalOverrides.domOrders),
      pageTextOverrides: normalizeOverrideMap(pageOverrides.textOverrides),
      pageStyleOverrides: normalizeOverrideMap(pageOverrides.styleOverrides),
      pageDomOrders: normalizeOverrideMap(pageOverrides.domOrders),
      textOverrides: normalizeOverrideMap(state.textOverrides),
      styleOverrides: normalizeOverrideMap(state.styleOverrides),
      domOrders: normalizeOverrideMap(state.domOrders),
    };
  };

  const syncEffectiveOverrides = () => {
    state.globalTextOverrides = normalizeOverrideMap(state.globalTextOverrides);
    state.globalStyleOverrides = normalizeOverrideMap(state.globalStyleOverrides);
    state.globalDomOrders = normalizeOverrideMap(state.globalDomOrders);
    state.pageTextOverrides = normalizeOverrideMap(state.pageTextOverrides);
    state.pageStyleOverrides = normalizeOverrideMap(state.pageStyleOverrides);
    state.pageDomOrders = normalizeOverrideMap(state.pageDomOrders);
    state.textOverrides = { ...state.globalTextOverrides, ...state.pageTextOverrides };
    state.styleOverrides = { ...state.globalStyleOverrides, ...state.pageStyleOverrides };
    state.domOrders = { ...state.globalDomOrders, ...state.pageDomOrders };
    state.globalOverrides = buildOverrideBundle({
      textOverrides: state.globalTextOverrides,
      styleOverrides: state.globalStyleOverrides,
      domOrders: state.globalDomOrders,
    });
    state.pageOverrides = buildOverrideBundle({
      textOverrides: state.pageTextOverrides,
      styleOverrides: state.pageStyleOverrides,
      domOrders: state.pageDomOrders,
    });
  };

  const refresh = () => {
    if (!hasDirty) {
      state = { ...state, ...readComposerSettings() };
    }
    state = readSettingsWithDefaults();
    syncEffectiveOverrides();
    hydrateComposerTargets();
    applyComposerDomOrdersToPage(state);
    applyComposerStyleOverridesToPage(state);
    applyComposerTextOverridesToPage(state);
    setDraggableState(isActive());
    bindDragHandlers();
    buildNavLists();
    buildPanelLists();
    buildHierarchyTree();
    if (pageVerbositySelect) {
      const pageKey = getPageKey();
      const preset = state.pageVerbosity?.[pageKey] || '';
      pageVerbositySelect.value = preset;
      if (pageVerbosityLabel) {
        pageVerbosityLabel.textContent = `Verbosity preset for ${pageKey}`;
      }
    }
    if (!selected) {
      setInspectorDisabled(true);
      if (textInput) textInput.disabled = true;
    }
    syncListSelection();
    syncToolbarState();
    updateActionButtons();
  };

  updateToggleLabel(isActive());
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(isActive()));
  }
  if (isActive()) {
    bindOverlayEvents();
    scheduleOverlayUpdate();
  } else if (overlay) {
    overlay.style.display = 'none';
  }

  return { refresh };
}

function ensureComposerOverlay() {
  if (composerOverlay && document.body?.contains(composerOverlay)) {
    return composerOverlay;
  }
  if (!document.body) return null;
  const overlay = document.createElement('div');
  overlay.className = 'composer-overlay';
  overlay.dataset.composerOverlay = 'true';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="composer-overlay__bar" data-composer-overlay-bar>
      <span class="composer-overlay__label" data-composer-overlay-label>Selection</span>
      <div class="composer-overlay__tools">
        <button class="ghost composer-overlay__action" type="button" data-composer-overlay-clear>Clear</button>
        <button class="ghost composer-overlay__action" type="button" data-composer-overlay-exit>Exit</button>
      </div>
    </div>
    <div class="composer-overlay__handle composer-overlay__handle--nw" data-composer-handle="nw"></div>
    <div class="composer-overlay__handle composer-overlay__handle--ne" data-composer-handle="ne"></div>
    <div class="composer-overlay__handle composer-overlay__handle--sw" data-composer-handle="sw"></div>
    <div class="composer-overlay__handle composer-overlay__handle--se" data-composer-handle="se"></div>
  `;
  document.body.appendChild(overlay);
  composerOverlay = overlay;
  return composerOverlay;
}

function ensureComposerDropLine() {
  const existing = document.querySelector('[data-composer-drop-line]');
  if (existing) return existing;
  if (!document.body) return null;
  const line = document.createElement('div');
  line.className = 'composer-drop-line';
  line.dataset.composerDropLine = 'true';
  line.style.display = 'none';
  document.body.appendChild(line);
  return line;
}

function readComposerSettings() {
  const raw = document.body?.dataset?.composerSettings || '';
  if (!raw) {
    return {
      themeCss: '',
      quickActionsOrder: [],
      sideNavOrder: [],
      pageAsideWidth: null,
      pageVerbosity: {},
      pageLayouts: {},
      textOverrides: {},
      styleOverrides: {},
      domOrders: {},
      globalOverrides: { textOverrides: {}, styleOverrides: {}, domOrders: {} },
      pageOverrides: { textOverrides: {}, styleOverrides: {}, domOrders: {} },
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const globalOverrides = buildOverrideBundle(parsed.globalOverrides || parsed);
    const pageOverrides = buildOverrideBundle(parsed.pageOverrides || {});
    const textOverrides = { ...globalOverrides.textOverrides, ...pageOverrides.textOverrides };
    const styleOverrides = { ...globalOverrides.styleOverrides, ...pageOverrides.styleOverrides };
    const domOrders = { ...globalOverrides.domOrders, ...pageOverrides.domOrders };
    return {
      ...parsed,
      globalOverrides,
      pageOverrides,
      textOverrides,
      styleOverrides,
      domOrders,
    };
  } catch (_error) {
    return {};
  }
}

function mergeOrders(listKeys = [], existing = []) {
  const trimmed = (listKeys || []).filter(Boolean);
  const seen = new Set(trimmed);
  const extras = (existing || []).filter((key) => key && !seen.has(key));
  return [...trimmed, ...extras];
}

function syncPageMeta() {
  const meta = document.querySelector('[data-page-meta]');
  if (!meta || !document.body) return;
  const body = document.body;
  if (meta.dataset.pageKey !== undefined) body.dataset.pageKey = meta.dataset.pageKey;
  if (meta.dataset.verbosity !== undefined) body.dataset.verbosity = meta.dataset.verbosity;
  if (meta.dataset.verbosityDefault !== undefined) body.dataset.verbosityDefault = meta.dataset.verbosityDefault;
  if (meta.dataset.verbosityOverride !== undefined) body.dataset.verbosityOverride = meta.dataset.verbosityOverride;
  if (meta.dataset.verbosityPagePreset !== undefined) body.dataset.verbosityPagePreset = meta.dataset.verbosityPagePreset;
  if (meta.dataset.verbosityCanSave !== undefined) body.dataset.verbosityCanSave = meta.dataset.verbosityCanSave;
  if (meta.dataset.composerSettings !== undefined) body.dataset.composerSettings = meta.dataset.composerSettings;
  if (meta.dataset.composerAllowed !== undefined) body.dataset.composerAllowed = meta.dataset.composerAllowed;
  meta.remove();
}

function updateVerbosityToggleUI() {
  const button = document.querySelector('[data-verbosity-toggle]');
  if (!button || !document.body) return;
  const body = document.body;
  const baseMode = body.dataset.verbosityPagePreset || body.dataset.verbosityDefault || 'full';
  const override = body.dataset.verbosityOverride || '';
  const effective = override || baseMode || 'full';
  const label = effective === 'compact' ? 'Compact' : 'Full';
  const source = override ? 'Session override' : body.dataset.verbosityPagePreset ? 'Page preset' : 'Circle default';
  button.textContent = `Verbosity: ${label}`;
  button.title = `Verbosity: ${source}`;
}

function initVerbosityToggle() {
  const button = document.querySelector('[data-verbosity-toggle]');
  if (!button || !document.body) return;
  updateVerbosityToggleUI();
  if (button.dataset.verbosityBound === 'true') return;
  button.dataset.verbosityBound = 'true';
  button.addEventListener('click', async () => {
    const body = document.body;
    const baseMode = body.dataset.verbosityPagePreset || body.dataset.verbosityDefault || 'full';
    const override = body.dataset.verbosityOverride || '';
    const effective = override || baseMode || 'full';
    const nextMode = effective === 'compact' ? 'full' : 'compact';
    const nextOverride = nextMode === baseMode ? '' : nextMode;
    body.dataset.verbosityOverride = nextOverride;
    body.dataset.verbosity = nextOverride || baseMode || 'full';
    updateVerbosityToggleUI();
    if (body.dataset.verbosityCanSave === 'true') {
      try {
        const payload = new URLSearchParams();
        payload.set('intent', 'ui-preferences');
        payload.set('uiVerbosity', nextOverride);
        const response = await fetch('/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'partial' },
          body: payload,
        });
        if (!response.ok) throw new Error('Save failed');
      } catch (error) {
        console.error(error);
      }
    }
  });
}

function applyPageLayout() {
  const settings = readComposerSettings();
  applyPageLayoutFromSettings(settings);
  applyComposerDomOrdersToPage(settings);
}

function applyPageLayoutFromSettings(settings = {}) {
  const body = document.body;
  if (!body) return;
  const pageKey = body.dataset.pageKey || '';
  if (!pageKey) return;
  const layouts = settings.pageLayouts;
  if (!layouts || typeof layouts !== 'object') return;
  const layout = layouts[pageKey];
  if (!layout || typeof layout !== 'object') return;
  const { mainColumn, asideColumn, mainPanels, asidePanels, allPanels } = getPanelColumns();
  if (!mainColumn) return;
  const panelMap = new Map(allPanels.map((panel) => [panel.dataset.composerSection, panel]));
  const layoutMain = Array.isArray(layout.main) ? layout.main.filter(Boolean) : [];
  const layoutAside = Array.isArray(layout.aside) ? layout.aside.filter(Boolean) : [];
  const mainSet = new Set(layoutMain);
  const asideOrderBase = layoutAside.filter((key) => key && !mainSet.has(key));
  const asideSet = new Set(asideOrderBase);
  const currentMainOrder = mainPanels
    .map((panel) => panel.dataset.composerSection)
    .filter((key) => key && !asideSet.has(key));
  const currentAsideOrder = asidePanels
    .map((panel) => panel.dataset.composerSection)
    .filter((key) => key && !mainSet.has(key));
  const mainOrder = mergeOrders(layoutMain, currentMainOrder);
  const asideOrder = mergeOrders(asideOrderBase, currentAsideOrder);
  const applyOrder = (column, order) => {
    if (!column) return;
    order.forEach((key) => {
      const panel = panelMap.get(key);
      if (panel) column.appendChild(panel);
    });
  };
  applyOrder(mainColumn, mainOrder);
  if (asideColumn) {
    applyOrder(asideColumn, asideOrder);
  }
  const hiddenSet = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
  allPanels.forEach((panel) => {
    const key = panel.dataset.composerSection;
    panel.hidden = hiddenSet.has(key);
  });
}

function getPanelColumns() {
  const root = document.querySelector('[data-shell]') || document.querySelector('main');
  if (!root) {
    return { root: null, mainColumn: null, asideColumn: null, mainPanels: [], asidePanels: [], allPanels: [] };
  }
  const mainColumn = root.querySelector('.page-main') || root;
  const asideColumn = root.querySelector('.page-aside');
  const allPanels = Array.from(root.querySelectorAll('.panel'));
  allPanels.forEach((panel, index) => {
    if (panel.dataset.composerSection) return;
    const key = panel.id || `panel-${index + 1}`;
    panel.dataset.composerSection = key;
  });
  const mainPanels =
    mainColumn === root
      ? allPanels.filter((panel) => !panel.closest('.page-aside'))
      : Array.from(mainColumn.querySelectorAll('.panel'));
  const asidePanels = asideColumn ? Array.from(asideColumn.querySelectorAll('.panel')) : [];
  return { root, mainColumn, asideColumn, mainPanels, asidePanels, allPanels };
}

function initInstallWizard(root) {
  const form = root.querySelector('form[data-install-wizard]');
  if (!form) return;
  if (form.dataset.installMode !== 'wizard') return;
  const steps = Array.from(form.querySelectorAll('[data-wizard-step]'));
  if (!steps.length) return;
  const indicators = Array.from(form.querySelectorAll('[data-wizard-indicator]'));
  const status = form.querySelector('[data-wizard-status]');
  const bar = form.querySelector('[data-wizard-bar]');
  const prevButton = form.querySelector('[data-wizard-prev]');
  const nextButton = form.querySelector('[data-wizard-next]');
  const submitButton = form.querySelector('[data-wizard-submit]');
  let currentIndex = 0;

  const update = (nextIndex) => {
    const clamped = Math.min(Math.max(nextIndex, 0), steps.length - 1);
    currentIndex = clamped;
    steps.forEach((step, index) => {
      step.hidden = index !== currentIndex;
    });
    indicators.forEach((indicator, index) => {
      indicator.classList.toggle('is-active', index === currentIndex);
      indicator.classList.toggle('is-complete', index < currentIndex);
    });
    if (status) {
      status.textContent = `Step ${currentIndex + 1} of ${steps.length}`;
    }
    if (bar) {
      bar.style.width = `${Math.round(((currentIndex + 1) / steps.length) * 100)}%`;
    }
    if (prevButton) {
      prevButton.disabled = currentIndex === 0;
    }
    if (nextButton) {
      nextButton.hidden = currentIndex >= steps.length - 1;
    }
    if (submitButton) {
      submitButton.hidden = currentIndex < steps.length - 1;
    }
  };

  form.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-wizard-next], [data-wizard-prev], [data-wizard-jump]');
    if (!trigger) return;
    event.preventDefault();
    if (trigger.dataset.wizardJump !== undefined) {
      const jumpIndex = Number(trigger.dataset.wizardJump);
      if (Number.isFinite(jumpIndex)) {
        update(jumpIndex);
      }
      return;
    }
    if (trigger.hasAttribute('data-wizard-next')) {
      update(currentIndex + 1);
      return;
    }
    if (trigger.hasAttribute('data-wizard-prev')) {
      update(currentIndex - 1);
    }
  });

  const syncFromHash = () => {
    const match = window.location.hash.match(/wizard-step-(\d+)/);
    if (!match) return;
    const targetIndex = Number(match[1]);
    if (!Number.isFinite(targetIndex)) return;
    update(targetIndex);
    const target = document.getElementById(`wizard-step-${targetIndex}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (window.__wizardHashHandler) {
    window.removeEventListener('hashchange', window.__wizardHashHandler);
  }
  window.__wizardHashHandler = syncFromHash;
  window.addEventListener('hashchange', window.__wizardHashHandler);

  update(0);
  syncFromHash();
}

function syncNavigationState() {
  const items = Array.from(document.querySelectorAll('[data-nav-section]'));
  if (!items.length) return;
  const path = window.location.pathname;
  let activeKey = '';
  let bestLength = -1;

  for (const item of items) {
    const key = item.dataset.navSection || '';
    const exact = item.dataset.navExact === 'true';
    const matchPath = item.dataset.navPath || '';
    const prefix = item.dataset.navPrefix || '';
    if (exact && matchPath && path === matchPath) {
      activeKey = key;
      bestLength = matchPath.length;
      break;
    }
    if (!exact && prefix && path.startsWith(prefix) && prefix.length > bestLength) {
      activeKey = key;
      bestLength = prefix.length;
    }
  }

  if (activeKey) {
    document.body.dataset.section = activeKey;
  } else {
    delete document.body.dataset.section;
  }

  items.forEach((item) => {
    const isActive = item.dataset.navSection === activeKey;
    item.classList.toggle('is-active', isActive);
    const link = item.querySelector('[data-nav-link]');
    if (!link) return;
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  const childBlocks = Array.from(document.querySelectorAll('[data-nav-children]'));
  childBlocks.forEach((block) => {
    block.hidden = block.dataset.navChildren !== activeKey;
  });

  const contextLinks = Array.from(document.querySelectorAll('[data-quick-section]'));
  contextLinks.forEach((link) => {
    link.hidden = link.dataset.quickSection !== activeKey;
  });
}

function setComposePanelState(panel, { open, focus = false } = {}) {
  if (!panel) return;
  const toggle = panel.querySelector('[data-compose-toggle]');
  const isOpen = Boolean(open);
  panel.dataset.composeState = isOpen ? 'open' : 'collapsed';
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.textContent = isOpen ? 'Collapse' : 'Expand';
  }
  if (isOpen) {
    if (focus) {
      const firstField = panel.querySelector('textarea, input, select');
      if (firstField && typeof firstField.focus === 'function') {
        firstField.focus();
      }
    }
    return;
  }
  const focused = panel.querySelector(':focus');
  if (focused && typeof focused.blur === 'function') {
    focused.blur();
  }
}

function initStickyComposerAutoCollapse() {
  if (typeof window.__composeAutoCleanup === 'function') {
    window.__composeAutoCleanup();
    window.__composeAutoCleanup = null;
  }
  const panel = document.getElementById('social-compose');
  if (!panel) return;
  const toggle = panel.querySelector('[data-compose-toggle]');
  if (!toggle) return;
  let lastY = window.scrollY || window.pageYOffset || 0;
  let lastTick = 0;
  const onScroll = () => {
    if (window.location.pathname !== '/social/feed') return;
    const now = Date.now();
    if (now - lastTick < 120) return;
    lastTick = now;
    const currentY = window.scrollY || window.pageYOffset || 0;
    const delta = currentY - lastY;
    lastY = currentY;
    if (panel.dataset.composeState !== 'open') return;
    if (panel.matches(':focus-within')) return;
    if (currentY < 140) return;
    if (delta < 56) return;
    setComposePanelState(panel, { open: false, focus: false });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.__composeAutoCleanup = () => window.removeEventListener('scroll', onScroll);
}

(() => {
  const root = document.querySelector('[data-shell]');
  if (!root) return;
  initInstallWizard(root);
  syncPageMeta();
  syncNavigationState();
  applyPageLayout();
  initVerbosityToggle();
  initComposerTool();
  initStickyComposerAutoCollapse();

  document.addEventListener('click', async (event) => {
    const anchor = event.target.closest('a[data-partial]');
    if (!anchor) return;
    const url = anchor.href;
    if (!url.startsWith(window.location.origin)) return;
    event.preventDefault();
    try {
      const response = await fetch(url, { headers: { 'X-Requested-With': 'partial' } });
      if (!response.ok) throw new Error('Navigation failed');
      const html = await response.text();
      root.innerHTML = html;
      window.history.pushState({}, '', url);
      initInstallWizard(root);
      syncPageMeta();
      syncNavigationState();
      applyPageLayout();
      initVerbosityToggle();
      initComposerTool();
      initStickyComposerAutoCollapse();
      scrollToHash(url);
      triggerDeepLink();
    } catch (error) {
      console.error(error);
      window.location.href = url;
    }
  });

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-compose-toggle]');
    if (!toggle) return;
    event.preventDefault();
    const panel = toggle.closest('[data-compose-state]');
    if (!panel) return;
    const current = panel.dataset.composeState || 'collapsed';
    const isOpen = current === 'open';
    setComposePanelState(panel, { open: !isOpen, focus: !isOpen });
  });

  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'file' || !input.hasAttribute('data-media-toggle')) return;
    const form = input.closest('form');
    const textarea = form?.querySelector('textarea[data-media-required]');
    if (!textarea) return;
    textarea.required = !(input.files && input.files.length > 0);
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-enhance]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.enhance === 'extensions') {
      await submitExtensionsForm(form);
      return;
    }
    if (form.dataset.enhance === 'delegation-conflict') {
      await submitDelegationChoice(form);
      return;
    }
    try {
      const formData = new FormData(form);
      const hasFiles = Array.from(formData.values()).some((value) => value instanceof File && value.size > 0);
      const isMultipart = String(form.enctype || '').toLowerCase().includes('multipart/form-data');
      const method = (form.method || 'POST').toUpperCase();
      const headers = { 'X-Requested-With': 'partial' };
      let url = form.action;
      const options = { method, headers };
      if (method === 'GET') {
        const params = new URLSearchParams(formData);
        const target = new URL(form.action, window.location.origin);
        target.search = params.toString();
        url = target.toString();
      } else {
        options.body = hasFiles || isMultipart ? formData : new URLSearchParams(formData);
      }
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 429) {
          try {
            const payload = await response.json();
            alert(payload.message || payload.error || 'Not allowed for this role.');
          } catch (_error) {
            alert('Action blocked.');
          }
          return;
        }
        throw new Error('Submit failed');
      }
      const html = await response.text();
      root.innerHTML = html;
      window.history.pushState({}, '', url);
      initInstallWizard(root);
      syncPageMeta();
      syncNavigationState();
      applyPageLayout();
      initVerbosityToggle();
      initComposerTool();
      initStickyComposerAutoCollapse();
      scrollToHash(url);
      triggerDeepLink();
    } catch (error) {
      console.error(error);
      form.submit();
    }
  });

  window.addEventListener('popstate', () => window.location.reload());
})();
