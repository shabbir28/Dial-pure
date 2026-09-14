'use strict';

function parsePagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const sortAllow = new Set([
    'created_at',
    'updated_at',
    'name',
    'email',
    'status',
    'job_number',
    'total_rows',
    'downloaded_at',
    'action',
  ]);
  const sort = sortAllow.has(query.sort) ? query.sort : 'created_at';
  const order = String(query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { page, pageSize, sort, order, offset: (page - 1) * pageSize };
}

function paginated(items, total, pagination) {
  return {
    items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize) || 1,
    },
  };
}

function sqlLimit(pagination) {
  const limit = Math.max(1, Number(pagination?.pageSize) || 25);
  const offset = Math.max(0, Number(pagination?.offset) || 0);
  return `LIMIT ${limit} OFFSET ${offset}`;
}

module.exports = { parsePagination, paginated, sqlLimit };
