/**
 * Page-by-page lists: ?page=1&pageSize=20
 *
 *   list(@Query() query: PaginationQuery) {
 *     const { skip, take } = toSkipTake(query);
 *     ...findMany({ skip, take })
 *     return paginated(items, total, query);
 *   }
 */
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQuery {
  /** Page number, starting at 1. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Items per page (at most 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function toSkipTake(query: PaginationQuery) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function paginated<T>(items: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}
