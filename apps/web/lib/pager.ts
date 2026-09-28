/** Page numbers to show: always the first, last and neighbours of the current page. */
export function pagerSlots(page: number, totalPages: number): Array<number | "gap"> {
  const keep = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((n) => keep.add(n));
  const pages = [...keep].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const slots: Array<number | "gap"> = [];
  pages.forEach((n, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined && n - prev > 1) slots.push(n - prev === 2 ? n - 1 : "gap");
    slots.push(n);
  });
  return slots;
}
