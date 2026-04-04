# Cyborg CallTools V2 — Claude Code Project Config

Modern rewrite of the CallTools real-time call monitoring platform. Built with Bun + TypeScript (backend) and React + Vite (frontend). Runs in parallel with the legacy Python system as a beta.

## Architecture

### Monorepo Structure (Bun Workspaces)
- **`packages/shared`** — Shared TypeScript types and Zod message schemas
- **`packages/backend`** — Bun WebSocket server (port 8766)
- **`packages/frontend`** — React + Vite + Tailwind app

### Backend (`packages/backend`)
- **Entry**: `src/index.ts` — Bun.serve() WebSocket server
- **AMI**: `src/ami/client.ts` — Asterisk Management Interface connection (read-only)
- **Auth**: `src/auth/` — bcrypt password verification, session management, permissions
- **WebSocket**: `src/ws/router.ts` + `src/ws/handlers/` — typed message routing
- **Database**: `src/db/mysql.ts` — mysql2 with prepared statements (parameterized queries only)
- **Services**: `src/services/` — CNAM (Telnyx), fraud detection (IPQualityScore)
- **Transcription**: `src/transcription/whisper.ts` — HTTP client to Python Whisper GPU server
- **Audit**: `src/audit/logger.ts` — Rolling log rotation (5 backups)

### Frontend (`packages/frontend`)
- **React 19** + TypeScript + Vite
- **Tailwind CSS** with custom dark theme matching legacy UI
- **Zustand** for state management (auth, channels, transcripts, UI)
- **Components**: `src/components/` organized by feature (monitor, tools, history, settings, billing, admin)
- **Hooks**: `useWebSocket` (connection + reconnect), `useAuth` (login/logout)

### Shared (`packages/shared`)
- **Types**: `src/types.ts` — Channel, AuthState, Permissions, CallRecord, etc.
- **Messages**: `src/messages.ts` — Zod schemas for all WebSocket messages (client→server and server→client)

## Key Commands

```bash
# Install all dependencies
bun install

# Development (backend + frontend)
bun run dev

# Backend only (with hot reload)
bun run dev:backend

# Frontend only (Vite dev server on port 3000)
bun run dev:frontend

# Build frontend for production
bun run build

# Type check all packages
bun run lint
```

## Environment Variables

Backend configuration via `packages/backend/.env` (see `.env.example`):
- `WS_PORT` — WebSocket server port (default: 8766)
- `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` — MySQL (Magnus Billing)
- `AMI_HOST`, `AMI_PORT`, `AMI_USER`, `AMI_PASS` — Asterisk AMI
- `WHISPER_GPU_URL`, `WHISPER_GPU_API_KEY` — Whisper transcription server
- `TELNYX_API_KEY` — CNAM lookups
- `IPQS_API_KEY` — Fraud detection
- `WS_ALLOWED_ORIGINS` — CORS whitelist (comma-separated)

Frontend configuration via `packages/frontend/.env`:
- `VITE_WS_URL` — WebSocket server URL (default: `wss://sip.osetec.net/beta-ws/`)

## Deployment

### VPS Paths (CRITICAL �� use these exact paths)
- **Backend** → `/opt/calltools-v2/` (systemd service: `calltools-v2`)
- **Frontend build** → `/var/www/html/beta/` (served by Apache at `sip.osetec.net/beta`)

### VPS Management API
- **URL**: `http://187.124.26.242/vps-api/` (use HTTP, not HTTPS — avoids SSL issues)
- **Auth**: `Authorization: Bearer cyborg-vps-mgmt-2026`
- **Timeout**: 30 seconds — for long commands (like `bun install`), run with `&` in background and check output file later
- **CRITICAL**: NEVER restart Apache — use `apachectl graceful` for config reloads. The VPS API runs through Apache, restarting it kills API access.

#### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/ping` | Health check |
| GET | `/status` | Service status |
| GET | `/file?path=...` | Read a file |
| POST | `/file` | Write a file: `{"path": "...", "content": "..."}` |
| POST | `/exec` | Run a command: `{"cmd": "..."}` |
| POST | `/restart` | Restart a service: `{"service": "..."}` |

### Deploy Workflow
1. Edit code locally
2. Deploy files via `POST /file`
3. Rebuild frontend: `POST /exec {"cmd": "export HOME=/root && export PATH=/root/.bun/bin:$PATH && cd /opt/calltools-v2/packages/frontend && bun run build && cp -r dist/* /var/www/html/beta/"}`
4. For backend changes: `POST /exec {"cmd": "systemctl restart calltools-v2"}`
5. Push to GitHub: `POST /exec` from `/opt/calltools-v2` with `git add/commit/push`

### Deployment Gotchas
- **WebSocket proxy**: Apache uses `proxy_wstunnel` — the proxy is at `/beta-ws/` → `ws://127.0.0.1:8766`. Don't try direct WSS on port 8766, it won't work without SSL.
- **Vite base path**: `base: '/beta/'` in vite.config.ts since the app is served from a subdirectory, not root.
- **Backend origin check**: Must allow empty origin (Apache proxy strips it) — this is already handled in `index.ts`.
- **NEVER restart Apache**: Use `apachectl graceful` only. The VPS API runs through Apache.
- **bun install on VPS**: Takes 30+ seconds and times out the VPS API — run it in background with `&`.

## Architecture Decisions

### WebSocket Hook Design
The WebSocket hook uses `Zustand.getState()` instead of React hooks to avoid reconnect loops — **do not refactor this back to `useCallback` with store dependencies**. This is intentional.

### SIP Password Handling
SIP passwords in `pkg_sip` are plaintext in V1's DB — V2's `verifyPassword()` handles this, but new SIP users should use bcrypt.

### Legacy System Ports
- V1 backend (dtmf-monitor.py) runs on port **9900** (not 8765)
- V2 backend runs on port **8766**
- Apache WebSocket proxy: `/dtmf-ws/` → V1, `/beta-ws/` → V2

## Safety Rules

**CRITICAL — DO NOT TOUCH:**
- `/etc/asterisk/` — Asterisk configuration
- `/var/www/html/mbilling/` — Magnus Billing web files
- Apache, Kamailio, RTPengine services
- MySQL schema (SELECT only, no ALTER/CREATE/DROP)
- Legacy system files (`/opt/dtmf-monitor.py`, `/var/www/html/calltools.html`)

**V2 only writes to:**
- `/opt/calltools-v2/` — Backend code
- `/var/www/html/beta/` — Frontend build
- `/opt/calltools-v2-permissions.json` — V2 permissions
- `/opt/calltools-v2-audit.log` — V2 audit log

## Shared Infrastructure (used by both V1 and V2)
- **MySQL**: `mbilling` database (read-only from V2)
- **Asterisk AMI**: Subscribe to events only
- **Whisper GPU**: `localhost:8765` via SSH tunnel to Vast.ai

## Security Design
- All passwords verified via bcrypt (no plaintext, no PHP subprocess)
- All SQL queries use prepared statements via mysql2 driver
- WebSocket messages validated with Zod schemas
- Per-user connection limit (max 3 concurrent)
- Token-bucket rate limiting on all commands
- All permission checks logged to audit trail
- WSS only (no unencrypted WebSocket)
- Session resume with IP pinning and 5-minute TTL

## GitHub
- **Repo**: `SIXHF/cyborg-calltools-v2`
- **Legacy repo**: `SIXHF/cyborg-calltools` (not modified by V2)
