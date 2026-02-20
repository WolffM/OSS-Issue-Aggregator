/**
 * Watchlist Management
 *
 * Reads/writes the recon:watchlist KV key (array of hyphenated slugs).
 * Validates and normalizes slug format: owner/repo → owner-repo.
 */

const SLUG_REGEX = /^[a-zA-Z0-9_.-]+-[a-zA-Z0-9_.-]+$/

export function normalizeSlug(input: string): string {
  return input.replace(/\//g, '-')
}

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug)
}

export async function getWatchlist(kv: KVNamespace): Promise<string[]> {
  try {
    const data = await kv.get<string[]>('recon:watchlist', 'json')
    return data ?? []
  } catch {
    return []
  }
}

export async function addToWatchlist(
  kv: KVNamespace,
  rawSlug: string
): Promise<{ slug: string; added: boolean }> {
  const slug = normalizeSlug(rawSlug)
  if (!isValidSlug(slug)) {
    throw new Error(
      `Invalid slug format: '${rawSlug}'. Expected 'owner-repo' or 'owner/repo' format.`
    )
  }

  const current = await getWatchlist(kv)
  if (current.includes(slug)) {
    return { slug, added: false }
  }

  current.push(slug)
  await kv.put('recon:watchlist', JSON.stringify(current))
  return { slug, added: true }
}

export async function removeFromWatchlist(
  kv: KVNamespace,
  rawSlug: string
): Promise<{ slug: string; removed: boolean }> {
  const slug = normalizeSlug(rawSlug)
  const current = await getWatchlist(kv)
  const filtered = current.filter(s => s !== slug)

  if (filtered.length === current.length) {
    return { slug, removed: false }
  }

  await kv.put('recon:watchlist', JSON.stringify(filtered))
  return { slug, removed: true }
}
