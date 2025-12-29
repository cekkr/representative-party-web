(() => {
  const root = document.querySelector('[data-shell]');
  if (!root) return;

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
      window.scrollTo({ top: 0, behavior: 'smooth' });
      triggerDeepLink();
    } catch (error) {
      console.error(error);
      window.location.href = url;
    }
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
        options.body = new URLSearchParams(formData);
      }
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 401) {
          try {
            const payload = await response.json();
            alert(payload.message || payload.error || 'Not allowed for this role.');
          } catch (_error) {
            alert('Not allowed for this role.');
          }
          return;
        }
        throw new Error('Submit failed');
      }
      const html = await response.text();
      root.innerHTML = html;
      window.history.pushState({}, '', url);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
