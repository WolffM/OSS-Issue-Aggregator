/**
 * Zod schemas for OpenAPI spec generation
 */

import { z } from '@hono/zod-openapi'

export const PlatformSchema = z
  .enum(['github', 'gitlab', 'gitea', 'phabricator', 'bugzilla', 'trac'])
  .openapi('Platform')

export const DifficultySchema = z
  .enum(['beginner', 'intermediate', 'advanced', 'unknown'])
  .openapi('Difficulty')

export const IssueSchema = z
  .object({
    id: z.string().openapi({ example: 'github-react-12345' }),
    platform: PlatformSchema,
    project: z.string().openapi({ example: 'react' }),
    title: z.string().openapi({ example: 'Add TypeScript support for hooks' }),
    url: z.string().url().openapi({ example: 'https://github.com/facebook/react/issues/12345' }),
    difficulty: DifficultySchema,
    difficultyScore: z
      .number()
      .optional()
      .openapi({ example: 25, description: 'Raw difficulty score (0-100, lower = easier)' }),
    difficultySignals: z
      .array(z.string())
      .optional()
      .openapi({
        example: ['project-beginner-label', 'docs'],
        description: 'Which heuristics matched'
      }),
    labels: z.array(z.string()).openapi({ example: ['good first issue', 'help wanted'] }),
    createdAt: z.string().openapi({ example: '2024-01-15T10:30:00Z' }),
    updatedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' }),
    author: z.string().openapi({ example: 'contributor123' })
  })
  .openapi('Issue')

export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string()
  })
  .openapi('ErrorResponse')

export const HealthResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      status: z.literal('healthy'),
      service: z.literal('oss-issues-api'),
      timestamp: z.string()
    })
  })
  .openapi('HealthResponse')
