(() => {
  const root = document.querySelector('[data-shell]');
  if (!root) return;
  initInstallWizard(root);
  syncPageMeta();
  syncNavigationState();
  applyPageLayout();
  initVerbosityToggle();
  initComposerTool();

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
    const next = isOpen ? 'collapsed' : 'open';
    panel.dataset.composeState = next;
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.textContent = isOpen ? 'Expand' : 'Collapse';
    if (isOpen) {
      const focused = panel.querySelector(':focus');
      if (focused && typeof focused.blur === 'function') {
        focused.blur();
      }
      return;
    }
    const firstField = panel.querySelector('textarea, input, select');
    if (firstField && typeof firstField.focus === 'function') {
      firstField.focus();
    }
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
      scrollToHash(url);
      triggerDeepLink();
    } catch (error) {
      console.error(error);
      form.submit();
    }
  });

  window.addEventListener('popstate', () => window.location.reload());
})();

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

function initComposerTool() {
  const tool = document.querySelector('[data-composer-tool]');
  if (!tool) return;
  const allowed =
    document.body?.dataset?.composerAllowed === 'true' || tool.dataset?.composerAllowed === 'true';
  if (!allowed) {
    tool.hidden = true;
    if (document.body) {
      document.body.dataset.composerMode = 'off';
    }
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
  const closeButton = tool.querySelector('[data-composer-close]');
  const selectionNote = tool.querySelector('[data-composer-selection]');
  const textInput = tool.querySelector('[data-composer-text-input]');
  const applyButton = tool.querySelector('[data-composer-apply]');
  const clearButton = tool.querySelector('[data-composer-clear]');
  const saveButton = tool.querySelector('[data-composer-save]');
  const statusLine = tool.querySelector('[data-composer-status]');
  const quickList = tool.querySelector('[data-composer-list="quick"]');
  const sideLists = tool.querySelector('[data-composer-side-lists]');
  const mainList = tool.querySelector('[data-composer-list="main"]');
  const asideList = tool.querySelector('[data-composer-list="aside"]');
  const asideBlock = tool.querySelector('[data-composer-aside-block]');
  const pageVerbositySelect = tool.querySelector('[data-composer-page-verbosity]');
  const pageVerbosityLabel = tool.querySelector('[data-composer-page-label]');
  const styleInputs = Array.from(tool.querySelectorAll('[data-composer-style]'));

  let state = readComposerSettings();
  let hasDirty = false;
  let selected = null;
  let dragInfo = null;
  const getPageKey = () => document.body?.dataset?.pageKey || 'default';

  const setStatus = (message, isError = false) => {
    if (!statusLine) return;
    statusLine.textContent = message;
    statusLine.style.color = isError ? '#ff9a9a' : '';
  };

  const isActive = () => body.dataset.composerMode === 'on';
  const setMode = (active) => {
    body.dataset.composerMode = active ? 'on' : 'off';
    if (toggle) toggle.setAttribute('aria-expanded', String(active));
    if (!active) clearSelection();
  };

  const clearSelection = () => {
    if (!selected) return;
    selected.el.classList.remove('is-composer-selected');
    selected.el.removeAttribute('contenteditable');
    selected = null;
    if (textInput) textInput.value = '';
    if (selectionNote) selectionNote.textContent = 'Select a label or heading to edit.';
    styleInputs.forEach((input) => {
      input.value = '';
    });
  };

  const applyStyleOverrides = (el, overrides) => {
    if (!el) return;
    el.style.color = overrides?.color || '';
    el.style.background = overrides?.background || '';
    el.style.fontSize = overrides?.fontSize || '';
    el.style.padding = overrides?.padding || '';
  };

  const selectElement = (el) => {
    const key = el.dataset.composerKey || '';
    if (!key) return;
    if (selected?.el && selected.el !== el) {
      selected.el.classList.remove('is-composer-selected');
      selected.el.removeAttribute('contenteditable');
    }
    const defaultText = el.dataset.composerDefault || el.textContent.trim();
    selected = { el, key, defaultText };
    el.classList.add('is-composer-selected');
    el.setAttribute('contenteditable', 'true');
    if (textInput) textInput.value = el.textContent.trim();
    if (selectionNote) selectionNote.textContent = `Editing ${key}`;
    const styleOverrides = state.styleOverrides?.[key] || {};
    applyStyleOverrides(el, styleOverrides);
    styleInputs.forEach((input) => {
      const prop = input.dataset.composerStyle;
      input.value = styleOverrides[prop] || '';
    });
    el.focus({ preventScroll: true });
  };

  const noteDirty = () => {
    hasDirty = true;
    setStatus('Changes staged. Save to persist.');
  };

  const updateSelectionText = (value) => {
    if (!selected) return;
    selected.el.textContent = value;
  };

  toggle?.addEventListener('click', () => {
    setMode(!isActive());
  });

  closeButton?.addEventListener('click', () => setMode(false));

  document.addEventListener(
    'click',
    (event) => {
      if (!isActive()) return;
      if (tool.contains(event.target)) return;
      const target = event.target.closest('[data-composer-key]');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
    },
    true,
  );

  document.addEventListener('keydown', (event) => {
    if (!isActive()) return;
    if (event.key === 'Escape') {
      setMode(false);
    }
  });

  document.addEventListener('input', (event) => {
    if (!isActive() || !selected) return;
    if (event.target !== selected.el) return;
    if (textInput) textInput.value = selected.el.textContent.trim();
    state.textOverrides = state.textOverrides || {};
    state.textOverrides[selected.key] = selected.el.textContent.trim();
    noteDirty();
  });

  textInput?.addEventListener('input', () => {
    if (!selected) return;
    updateSelectionText(textInput.value);
    state.textOverrides = state.textOverrides || {};
    state.textOverrides[selected.key] = textInput.value.trim();
    noteDirty();
  });

  applyButton?.addEventListener('click', () => {
    if (!selected) {
      setStatus('Select something to edit first.', true);
      return;
    }
    const next = textInput ? textInput.value.trim() : '';
    if (!next) {
      setStatus('Text cannot be empty.', true);
      return;
    }
    state.textOverrides = state.textOverrides || {};
    state.textOverrides[selected.key] = next;
    updateSelectionText(next);
    noteDirty();
  });

  clearButton?.addEventListener('click', () => {
    if (!selected) return;
    if (state.textOverrides) {
      delete state.textOverrides[selected.key];
    }
    const fallback = selected.defaultText || '';
    if (textInput) textInput.value = fallback;
    updateSelectionText(fallback);
    noteDirty();
  });

  styleInputs.forEach((input) => {
    input.addEventListener('input', () => {
      if (!selected) return;
      const prop = input.dataset.composerStyle;
      if (!prop) return;
      state.styleOverrides = state.styleOverrides || {};
      state.styleOverrides[selected.key] = state.styleOverrides[selected.key] || {};
      if (!input.value.trim()) {
        delete state.styleOverrides[selected.key][prop];
      } else {
        state.styleOverrides[selected.key][prop] = input.value.trim();
      }
      applyStyleOverrides(selected.el, state.styleOverrides[selected.key]);
      noteDirty();
    });
  });

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
    const payload = new URLSearchParams();
    payload.set('intent', 'composer');
    payload.set('composerQuickActionsOrder', (state.quickActionsOrder || []).join(', '));
    payload.set('composerSideNavOrder', (state.sideNavOrder || []).join(', '));
    payload.set('composerThemeCss', state.themeCss || '');
    payload.set('composerAsideWidth', state.pageAsideWidth ? String(state.pageAsideWidth) : '');
    payload.set('composerTextOverrides', JSON.stringify(state.textOverrides || {}));
    payload.set('composerStyleOverrides', JSON.stringify(state.styleOverrides || {}));
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
    } catch (error) {
      console.error(error);
      setStatus('Failed to save composer settings.', true);
    }
  };

  saveButton?.addEventListener('click', saveComposer);

  const readSettingsWithDefaults = () => ({
    themeCss: state.themeCss || '',
    quickActionsOrder: Array.isArray(state.quickActionsOrder) ? state.quickActionsOrder : [],
    sideNavOrder: Array.isArray(state.sideNavOrder) ? state.sideNavOrder : [],
    pageAsideWidth: Number.isFinite(state.pageAsideWidth) ? state.pageAsideWidth : null,
    pageVerbosity: state.pageVerbosity && typeof state.pageVerbosity === 'object' ? state.pageVerbosity : {},
    pageLayouts: state.pageLayouts && typeof state.pageLayouts === 'object' ? state.pageLayouts : {},
    textOverrides: state.textOverrides && typeof state.textOverrides === 'object' ? state.textOverrides : {},
    styleOverrides: state.styleOverrides && typeof state.styleOverrides === 'object' ? state.styleOverrides : {},
  });

  const refresh = () => {
    if (!hasDirty) {
      state = { ...state, ...readComposerSettings() };
    }
    state = readSettingsWithDefaults();
    buildNavLists();
    buildPanelLists();
    if (pageVerbositySelect) {
      const pageKey = getPageKey();
      const preset = state.pageVerbosity?.[pageKey] || '';
      pageVerbositySelect.value = preset;
      if (pageVerbosityLabel) {
        pageVerbosityLabel.textContent = `Verbosity preset for ${pageKey}`;
      }
    }
  };

  return { refresh };
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
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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
  applyPageLayoutFromSettings(readComposerSettings());
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
