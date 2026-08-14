# Production daemon

The Windows production daemon runs detached `next start` (web) and job workers. It is optional: local UI work can use `npm run dev` + `npm run workers` instead.

## Agent policy (end of a development)

After you finish a development that the running production process would pick up, **reload the daemon only if it is already running on this PC**.

| Status | Action |
|--------|--------|
| `npm run daemon:status` shows `web` / `workers` **RUNNING** | `npm run daemon:restart`, then confirm status (HTTP `http://127.0.0.1:3000` OK) |
| Status shows **STOPPED**, stale pid files, or no daemon | **Do nothing.** Do not start or restart. |

A stopped daemon is intentional. The operator may be in dev mode, may have stopped it, or this machine may not be the runtime host. Never start a daemon that was not already running.

Skip the check for docs-only or comment-only changes that cannot affect the running process.

## Commands

```bash
npm run daemon:status
npm run daemon:restart
npm run daemon:logs
npm run daemon:stop
npm run daemon:start
```

`daemon:restart` stops, rebuilds the production bundle when needed, and starts web + workers again. Use it only after a status check that found a running daemon (or when a human explicitly asks to restart).
