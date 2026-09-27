# Production daemon

On Windows, the production daemon runs **detached** `next start` (web) and the job worker process so the Short Control desk stays up without an open terminal. It is optional: local UI work can use `npm run dev` + `npm run workers` instead.

## When to use it

| Mode | Command | Use when |
|------|---------|----------|
| Production daemon | `npm run daemon:start` | Day-to-day operator runtime on the Windows host |
| System tray | `npm run daemon:tray` | Keep a light tray icon; start/stop the app only when needed |
| Dev split | `npm run dev` + `npm run workers` | UI iteration; keep workers in a second terminal |

The daemon builds the production bundle when needed, starts web + workers, writes PIDs under `data/daemon/`, and exits. You can close the shell afterward.

```bash
npm run daemon:status   # PIDs + HTTP check
npm run daemon:logs     # Tail data/daemon/*.log
npm run daemon:stop
npm run daemon:restart  # Stop, rebuild if needed, start again
npm run daemon:start
npm run daemon:tray     # System-tray controller (does not start the app by itself)
```

### Selective start (recommended)

Prefer **tray at logon** instead of always-on daemon:

```bash
npm run daemon:install-autostart   # Scheduled Task: tray at Windows logon
npm run daemon:uninstall-autostart # Remove tray + any legacy daemon-at-logon task
```

After logon you get a tray icon (grey = stopped, green = running). Right-click:

| Menu | Effect |
|------|--------|
| Open desk | Opens `http://127.0.0.1:3000/` |
| Start app | Runs `daemon:start` (with `-SkipBuild` when started from tray) |
| Stop app | Runs `daemon:stop` |
| Restart app | Runs `daemon:restart` |
| Show status | Balloon with web/workers/HTTP |
| Open logs folder | `data/daemon/` |
| Exit tray (keep app) | Leaves the daemon running if it was started |

`install-autostart` registers a **Scheduled Task** when permitted; otherwise it creates a **Startup folder** shortcut. If an older `yt-short-creator-daemon` task still exists (always-on daemon), delete it once with elevated PowerShell:

```bash
schtasks /Delete /TN "yt-short-creator-daemon" /F
```

Logs: `data/daemon/tray.log` and `data/daemon/tray-action-*.log`.

`daemon:restart` rebuilds when the production bundle is stale, then brings web + workers back. Prefer an explicit status check first unless you already know the daemon should be running.

## Agent policy (end of a development)

After a development that the running production process would pick up, **reload the daemon only if it is already running on this PC**.

| Status | Action |
|--------|--------|
| `npm run daemon:status` shows `web` / `workers` **RUNNING** | `npm run daemon:restart`, then confirm status (HTTP `http://127.0.0.1:3000` OK) |
| Status shows **STOPPED**, stale pid files, or no daemon | **Do nothing.** Do not start or restart. |

A stopped daemon is intentional. The operator may be in dev mode, may have stopped it, or this machine may not be the runtime host. Never start a daemon that was not already running.

Skip the check for docs-only or comment-only changes that cannot affect the running process.
