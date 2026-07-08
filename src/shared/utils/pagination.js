export const DEFAULT_PAGE_SIZE = 20;

// Parse a 1-based page number from raw query input, clamped to a sane minimum.
export function parsePage(raw) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

// Window a list into a page. Returns the page slice plus metadata for rendering a pager.
// `page` is clamped into range so an out-of-bounds query lands on the last page.
export function paginate(items = [], { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const list = Array.isArray(items) ? items : [];
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE;
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return {
    items: list.slice(start, start + size),
    page: current,
    pageSize: size,
    total,
    pageCount,
    hasPrev: current > 1,
    hasNext: current < pageCount,
    startIndex: total === 0 ? 0 : start + 1,
    endIndex: Math.min(start + size, total),
  };
}
