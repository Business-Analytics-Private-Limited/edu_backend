/**
 * Cursor pagination (docs/08-api-conventions.md §8.5).
 *
 * Lists are sorted by id, newest first. Ids are UUIDv7, which start with their creation time,
 * so "the next page" is simply "ids smaller than the last one I saw". The cursor the client
 * receives is that last id, wrapped so clients treat it as an opaque value.
 *
 *   const { limit, afterId } = readPageParams(query);
 *   const rows = await repo.list({ limit: limit + 1, afterId });   // ask for one extra row
 *   return page(rows, limit, (row) => row.id);
 */
import { ProblemError } from '../errors/problem';
import { isUuid } from '../ids';

export interface PageInfo {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Page<T> {
  data: T[];
  page: PageInfo;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export function readPageParams(query: { limit?: unknown; cursor?: unknown }): {
  limit: number;
  afterId: string | undefined;
} {
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ProblemError(400, 'bad_request', 'Bad limit', `limit must be 1 to ${MAX_PAGE_SIZE}`);
  }
  let afterId: string | undefined;
  if (typeof query.cursor === 'string' && query.cursor) {
    try {
      afterId = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')).after;
    } catch {
      afterId = undefined;
    }
    if (!isUuid(afterId))
      throw new ProblemError(400, 'bad_request', 'Bad cursor', 'Invalid cursor');
  }
  return { limit, afterId };
}

/**
 * Builds the response from `limit + 1` rows: the extra row only tells us there is more.
 */
export function page<T>(rows: T[], limit: number, idOf: (row: T) => string): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    page: {
      limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify({ after: idOf(last) }), 'utf8').toString('base64url')
          : null,
    },
  };
}
