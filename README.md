# YT Short Creator

Local S.Marcato 42 Racing tool: analyze your YouTube channel, propose branded Shorts (clip + generate), approve in a localhost dashboard, and auto-upload.

See [design spec](docs/superpowers/specs/2026-08-11-yt-short-creator-design.md) and [implementation plan](docs/superpowers/plans/2026-08-11-yt-short-creator.md).

## Prerequisites

- **Node.js** 20+ and npm
- **FFmpeg** on your `PATH` (video download, analysis, and render)
- **yt-dlp** on your `PATH` (YouTube media download)
- Sibling brand repo at `BRAND_ROOT` (default: `../smarcato42-racing`) with brand tokens and assets

## Local setup

1. Copy environment template and adjust paths:

   ```bash
   cp .env.example .env.local
   ```

2. Set `BRAND_ROOT` to the absolute path of your `smarcato42-racing` checkout (see `.env.example`).

3. Install dependencies, then run the **production daemon** (recommended on Windows):

   ```bash
   npm install
   npm run daemon:start
   ```

   This builds (if needed), starts `next start` + workers as **detached** processes,
   then exits — you can close the shell. Monitor anytime with:

   ```bash
   npm run daemon:status
   npm run daemon:logs
   npm run daemon:stop
   ```

   Optional: auto-start at Windows logon → `npm run daemon:install-autostart`

   For local UI development instead (two terminals):

   ```bash
   npm run dev        # Terminal A — localhost UI only
   npm run workers    # Terminal B — FFmpeg / YouTube / analysis jobs
   ```

   Open [http://localhost:3000](http://localhost:3000).

   Jobs are enqueued by the UI and executed by the worker process so Next stays
   responsive on large OBS masters. Do not embed workers in Next — that freezes
   the UI under heavy jobs.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `BRAND_ROOT` | Path to S.Marcato 42 Racing brand assets |
| `YOUTUBE_*` | OAuth credentials for YouTube Data API v3 |
| `LLM_*` / `TTS_*` | OpenAI-compatible LLM and TTS endpoints |
| `DATABASE_PATH` | SQLite database file (default `./data/app.db`) |
| `MEDIA_ROOT` | Local media storage (default `./media`) |

## YouTube OAuth

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3**.
3. Create OAuth 2.0 credentials (Web application).
4. Add authorized redirect URI: `http://localhost:3000/api/auth/youtube/callback`
5. Copy **Client ID** and **Client secret** into `.env.local` as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.

## Acceptance

Run this checklist against a test channel before accepting a release:

- [ ] Configure real OAuth credentials, start the app, and connect the intended YouTube channel.
- [ ] In **Settings**, set **Default privacy** to **Unlisted** and save.
- [ ] Generate or clip one disposable candidate, review its metadata, and approve it.
- [ ] Confirm the render and publish jobs both finish successfully with no retries or logged secrets.
- [ ] Open the returned video in YouTube Studio and confirm it is **Unlisted**, vertical, playable, and contains `#Shorts`.
- [ ] Confirm subscribers were not notified, then delete the disposable upload if it is no longer needed.
- [ ] (Optional) On **Replays**, use **Director capture** for highlight shots (or **Auto-record** for a continuous take), then approve a `REPLAY` candidate. iRacing must allow video capture.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run daemon:start` | Production daemon (detached web + workers) |
| `npm run daemon:status` | Check daemon PIDs + HTTP without the start shell |
| `npm run daemon:logs` | Tail `data/daemon/*.log` |
| `npm run daemon:stop` | Stop daemon processes |
| `npm run daemon:restart` | Stop + start |
| `npm run daemon:install-autostart` | Windows Scheduled Task at logon |
| `npm run dev` | Start Next.js UI only (dev; does **not** run heavy job workers) |
| `npm run workers` | Dedicated worker process (dev companion to `npm run dev`) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Run Vitest |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply Drizzle migrations |
