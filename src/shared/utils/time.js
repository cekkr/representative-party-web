let defaultFormatter;

export function formatTimestamp(value, fallback = '') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  if (!defaultFormatter) {
    defaultFormatter = new Intl.DateTimeFormat();
  }
  return defaultFormatter.format(date);
}
