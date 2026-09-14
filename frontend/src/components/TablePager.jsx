function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1]);
  const list = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const withGaps = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) withGaps.push('…');
    withGaps.push(n);
  });
  return withGaps;
}

export default function TablePager({
  pagination,
  pageSize,
  onPage,
  onPageSize,
  pageSizeOptions = [10, 25, 50, 100],
}) {
  const total = Number(pagination?.total || 0);
  const page = Number(pagination?.page || 1);
  const size = Number(pageSize || pagination?.pageSize || 10);
  const totalPages = Number(pagination?.totalPages || Math.ceil(total / size) || 1);
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <div className="table-pager">
      <label className="table-pager__entries">
        Show
        <select
          className="input"
          value={size}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        entries
      </label>
      <div className="table-pager__pages">
        <span className="table-pager__range">Showing {from} to {to} of {total}</span>
        <button type="button" className="table-pager__btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        {pageNumbers(page, totalPages).map((n, i) => (
          n === '…' ? (
            <span key={`gap-${i}`} className="table-pager__gap">…</span>
          ) : (
            <button
              key={n}
              type="button"
              className={`table-pager__btn ${n === page ? 'is-active' : ''}`}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          )
        ))}
        <button type="button" className="table-pager__btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
