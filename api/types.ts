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
  SCRAPER_API_KEY?: string
}
