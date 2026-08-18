/**
 * KV slugs join owner and repo with a hyphen (`microsoft-playwright`), and both halves
 * may themselves contain hyphens (`astral-sh-uv` is `astral-sh/uv`, not `astral/sh-uv`).
 * The split point is therefore unrecoverable from the slug alone — always prefer the
 * `project` name the API carries alongside it, and treat this as a last-resort fallback
 * for the rare slug we have no scored issue or project entry for.
 */
export function repoNameFromSlug(slug: string): string {
  return slug.replace('-', '/')
}

/** Resolve a slug to its display name via a slug → project-name lookup. */
export function repoNameFor(slug: string, names: ReadonlyMap<string, string>): string {
  return names.get(slug) ?? repoNameFromSlug(slug)
}
