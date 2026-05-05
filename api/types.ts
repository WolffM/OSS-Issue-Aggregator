export type Platform = 'github' | 'gitlab' | 'gitea' | 'phabricator' | 'bugzilla' | 'trac'
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'unknown'

export interface Issue {
  id: string
  platform: Platform
  project: string
  title: string
  url: string
  difficulty: Difficulty
  difficultyScore?: number // Raw score (0-100, lower = easier)
  difficultySignals?: string[] // Which heuristics matched
  labels: string[]
  createdAt: string
  updatedAt: string
  author: string
}

export interface OSSEnv {
  GITHUB_TOKEN?: string
  PHABRICATOR_TOKEN?: string
  CACHE_KV?: KVNamespace
  SCRAPER_API_URL?: string
  /**
   * Service-tier key for scraper outbound (X-User-Key, NOT Bearer — scraper
   * backend dropped Bearer support 2026-05-05). Pulled from vault key
   * OSS_SCRAPER_KEY via `python scripts/administration.py cloudflare-secrets
   * oss-issues-api`.
   */
  SCRAPER_USER_KEY?: string
}
