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
    try {
      const formData = new FormData(form);
      const response = await fetch(form.action, {
        method: form.method || 'POST',
        headers: { 'X-Requested-With': 'partial' },
        body: new URLSearchParams(formData),
      });
      if (!response.ok) {
        if (response.status === 401) {
          alert('Verification required before posting. Complete the wallet flow.');
          return;
        }
        throw new Error('Submit failed');
      }
      const html = await response.text();
      root.innerHTML = html;
      window.history.pushState({}, '', form.action);
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
