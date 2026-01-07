(() => {
  const root = document.querySelector('[data-shell]');
  if (!root) return;
  initInstallWizard(root);

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
      scrollToHash(url);
      triggerDeepLink();
    } catch (error) {
      console.error(error);
      window.location.href = url;
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
