# Repository Guidelines

## Project Structure & Module Organization
- `index.js` boots Express from `src/app.js`, starts the optional crawler scheduler, and binds to `PORT` (default 3000).
- `src/routes/` holds feature routers (`health`, `notices`, `keywords`, `sites`, `subscription`, `users`); mount new endpoints in `src/app.js`.
- `src/data/store.js` centralizes MySQL/Redis access with in-memory fallbacks; extend data helpers here rather than scattering queries.
- `src/crawler/` contains crawling logic (`crawlerService.js`) and cron orchestration (`scheduler.js`).
- `src/middlewares/error-handler.js` is the place for shared middleware; keep responses JSON and localized where possible.
- Root assets include `index.html`, `Dockerfile`, and deployment configs such as `container.config.json`.

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm start` — launch the API server.
- `npm run dev` — start with `nodemon` for auto-reload during development.
- Set `ENABLE_CRAWLER=true` (and optionally `CRAWL_CRON=*/30 * * * *`) to run scheduled crawls.

## Coding Style & Naming Conventions
- JavaScript (CommonJS) with 2-space indentation, single quotes, and no semicolons to match existing files.
- Prefer async/await; surface errors with `next(err)` and centralized handlers.
- Use camelCase for functions/variables; keep route files lowercase with hyphens.
- Centralize configuration and environment reads in shared helpers instead of per-route duplication.
- All API responses, error messages, logs, and documentation comments must be written in Chinese. Please answer in Chinese by default.

## Testing Guidelines
- No automated suite yet; add integration tests under `tests/` using Jest + supertest when expanding APIs.
- Name files `*.test.js` and group by endpoint or data helper.
- For manual checks, hit `GET /health` and sample `/api/*` routes with realistic query params; verify DB/Redis env vars when present.

## Security & Configuration Tips
- Persistence env vars: `DB_URL` (or `MYSQL_URL`) and optional `REDIS_URL`; without them the app uses demo in-memory data.
- Use `ENABLE_CRAWLER=true` only when outbound network access is allowed; tune `CRAWL_CRON` for frequency.
- `helmet` and `cors` are enabled by default—tighten allowed origins/headers when deploying.

## Commit & Pull Request Guidelines
- Keep commit messages short and imperative (e.g., “Add notices pagination”); include issue IDs when applicable.
- PRs should summarize scope, endpoints touched, config/env changes, and test evidence (commands run or manual steps).
- Provide screenshots or sample responses when adjusting API payloads or crawler outputs.
