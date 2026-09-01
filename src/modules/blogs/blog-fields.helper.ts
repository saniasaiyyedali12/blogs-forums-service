import { BlogStatus } from './enums/blog.enum';

export const BLOG_STATUSES = [
  BlogStatus.DRAFT,
  BlogStatus.PENDING_REVIEW,
] as const;

export function requiresCompleteBlogFields(status?: BlogStatus) {
  return (
    status === BlogStatus.PENDING_REVIEW || status === BlogStatus.DRAFT
  );
}

export function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
