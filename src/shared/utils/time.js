let defaultFormatter;

export function formatTimestamp(value, fallback = '') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  if (!defaultFormatter) {
    // Fixed, unambiguous dd/mm/yyyy rather than the machine locale's format. This
    // keeps dates readable for the deployments the product targets (Italian civic
    // and organization scenarios use dd/mm/yyyy) and makes SSR output — and the
    // screenshots taken from it — deterministic regardless of the host's locale,
    // instead of silently rendering US m/d/yyyy on a US-locale machine.
    defaultFormatter = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  return defaultFormatter.format(date);
}
