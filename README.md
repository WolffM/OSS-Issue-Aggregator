# OSS Issue Aggregator

> A dashboard to discover beginner-friendly issues across popular open source projects

Find your first open source contribution! This dashboard aggregates beginner-friendly issues from popular open source projects, making it easy to discover opportunities to contribute.

**Live at:** [hadoku.me/aggregator](https://hadoku.me/aggregator)

## Features

- **Multi-Project View**: Browse issues from 9+ major open source projects
- **Project Selection**: Choose which projects to display with multi-select checkboxes
- **Difficulty Indicators**: Issues tagged as beginner, intermediate, or unknown
- **Multi-Platform**: GitHub, GitLab, Gitea, and Phabricator projects
- **Beautiful Themes**: 16 light/dark theme options
- **Responsive Design**: Works on desktop and mobile
- **Smart Caching**: Fast loading with 4-minute client-side cache

## Supported Projects

| Project                       | Platform          | Category |
| ----------------------------- | ----------------- | -------- |
| MediaWiki                     | Phabricator       | Web Dev  |
| Blender                       | Gitea             | Creative |
| Node.js                       | GitHub            | Web Dev  |
| PyTorch                       | GitHub            | ML/AI    |
| React                         | GitHub            | Web Dev  |
| Hugging Face Transformers     | GitHub            | ML/AI    |
| Internet Archive Open Library | GitHub            | Web Dev  |
| Krita                         | GitLab (KDE)      | Creative |
| VLC Media Player              | GitLab (VideoLAN) | Media    |

## How It Works

The aggregator fetches "good first issue" labeled tickets from each project's issue tracker and displays them in a unified interface. Issues are refreshed periodically by the backend API.

Each project card shows the 5 most recently updated issues, along with:

- Issue title (links to original)
- Difficulty level
- Last update time
- Link to project's contributing guide

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Cloudflare Workers (API at `hadoku.me/oss/api`)
- **Styling**: CSS custom properties with `@wolffm/themes`
- **Hosting**: Cloudflare Pages

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

```

## API

The backend API provides:

- `GET /projects` - List all projects and categories
- `GET /issues?pool={pool}` - Get issues filtered by category
- `GET /issues/{slug}` - Get issues for a specific project
- `GET /health` - Health check

## License

MIT
