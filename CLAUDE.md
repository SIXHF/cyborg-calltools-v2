# Cyborg CallTools V2 — Claude Code Project Config

Modern rewrite of the CallTools real-time call monitoring platform. Built with Bun + TypeScript (backend) and React + Vite (frontend). Runs in parallel with the legacy Python system as a beta.

## Architecture

### Monorepo Structure (Bun Workspaces)
- **`packages/shared`** — Shared TypeScript types and Zod message schemas
- **`packages/backend`** — Bun WebSocket server (port 8766)
- **`packages/frontend`** — React + Vite + Tailwind app

### Backend (`packages/backend`)
- **Entry**: `src/index.ts` — Bun.serve() WebSocket server with session management, connection tracking, channel broadcast
- **AMI**: `src/ami/client.ts` — Asterisk Management Interface TCP connection (read-only events + actions)
- **AMI Channels**: `src/ami/channels.ts` — Channel polling via `asterisk -rx 'core show channels concise'`, trunk detection, channel filtering by role
- **Auth**: `src/auth/session.ts` — Session create/resume/destroy with IP pinning and 5-min TTL
- **Auth**: `src/auth/verify.ts` — Password verification (bcrypt, SHA1, plaintext fallback for Magnus Billing)
- **Auth**: `src/auth/permissions.ts` — Permission loading from JSON file with 3-layer cascade
- **WebSocket Router**: `src/ws/router.ts` — Typed message routing with permission checks
- **Handlers**: `src/ws/handlers/` — Individual handler files:
  - `dtmf.ts` — DTMF monitoring via AMI DTMFEnd events, per-client dispatch with bridge resolution
  - `callerid.ts` — Caller ID set/clear with toll-free validation
  - `originate.ts` — Quick dial via AMI Originate action
  - `transfer.ts` — Blind (AMI Redirect) and attended (AMI Atxfer) call transfer
  - `cdr.ts` — CDR query from pkg_cdr + pkg_cdr_failed with role-based filtering
  - `billing.ts` — Balance from pkg_user.credit, refill history from pkg_refill
  - `payment.ts` — Heleket USDT payment gateway (loads creds from pkg_method_pay, md5+base64 signature)
  - `cnam.ts` — CNAM lookup via Telnyx API with generic name filtering
  - `admin.ts` — Stats dashboard, permissions CRUD, sessions, force logout, broadcast, users overview, audit log viewer, manual credit adjustment
- **Database**: `src/db/mysql.ts` — mysql2 with prepared statements (parameterized queries only)
- **Services**: `src/services/cnam.ts` — Telnyx Number Lookup API (caller name, carrier, portability)
- **Services**: `src/services/fraud.ts` — IPQualityScore API (exists but not yet wired into handlers)
- **Audit**: `src/audit/logger.ts` — Rolling log rotation (5 backups, 10MB max)

### Frontend (`packages/frontend`)
- **React 19** + TypeScript + Vite
- **Tailwind CSS** with V1-matching dark theme (glassmorphism panels, gradient accents, color-coded badges)
- **Zustand** for state management (auth, channels, transcripts, UI)
- **Components**: `src/components/` organized by feature:
  - `monitor/MonitorTab.tsx` — Live call list with agent badges, state tags, CNAM, actions
  - `tools/ToolsTab.tsx` — DTMF capture, live transcription, CNAM lookup, BIN lookup, quick dial
  - `history/HistoryTab.tsx` — CDR table with search, date filters, pagination
  - `settings/SettingsTab.tsx` — Caller ID management, notification preferences
  - `billing/BillingTab.tsx` — Balance, USDT recharge (Heleket), refill history
  - `admin/AdminTab.tsx` — 3 sub-pages: Dashboard (stats/users), Settings (access/permissions/sessions/credit/audit), Broadcast
  - `layout/` — Header (SIP selector, balance, status), TabNav, LoginForm (with signup), StatusBadge
  - `shared/` — Toast, EventLogDrawer
- **Hooks**: `useWebSocket` (connection + reconnect + message dispatch), `useAuth`, `useWsMessage` (reactive WS listener)

### Shared (`packages/shared`)
- **Types**: `src/types.ts` — Channel, AuthState, Permissions, CallRecord, etc.
- **Messages**: `src/messages.ts` — Zod schemas for 25+ client→server commands and typed server→client responses

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
- `ELEVENLABS_API_KEY` — ElevenLabs Scribe transcription
- `WS_ALLOWED_ORIGINS` — CORS whitelist (comma-separated)
- `PERMISSIONS_FILE` — Path to permissions JSON (default: `/opt/calltools-v2-permissions.json`)
- `AUDIT_LOG_FILE` — Path to audit log (default: `/opt/calltools-v2-audit.log`)

Frontend configuration via `packages/frontend/.env`:
- `VITE_WS_URL` — WebSocket server URL (default: `wss://sip.osetec.net/beta-ws/`)

## Deployment

### VPS Paths (CRITICAL — use these exact paths)
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
- **Asterisk CLI path**: Use `/usr/sbin/asterisk` (full path) in Bun.spawn — systemd PATH doesn't include `/usr/sbin`.
- **Handler directory**: Must `mkdir -p` handler directories on VPS before deploying new handler files.

## Architecture Decisions

### WebSocket Hook Design
The WebSocket hook uses `Zustand.getState()` instead of React hooks to avoid reconnect loops — **do not refactor this back to `useCallback` with store dependencies**. This is intentional.

### Password Handling
- SIP passwords in `pkg_sip` are **plaintext** in Magnus Billing DB
- `pkg_user` passwords are mixed: root is SHA1, others are mostly plaintext
- V2's `verifyPassword()` handles all formats: bcrypt → SHA1 → plaintext fallback
- New users should use bcrypt

### Session Management
- Sessions support 5-minute resume window after WebSocket disconnect
- Resume sends full `auth_ok` response (not minimal `resume_ok`) to restore all client state
- Sessions are IP-pinned — must reconnect from same IP
- Max 3 concurrent connections per user
- `disconnectSession()` must be called on WebSocket close to enable resume

### Channel Polling
- Uses `asterisk -rx 'core show channels concise'` via Bun.spawn subprocess (not AMI Command action — too unreliable across Asterisk versions)
- Polls every 3 seconds, broadcasts to all authenticated clients
- Channels filtered per-user by role: admin sees all (minus trunks), users/SIP see own only
- Admin channels enriched with trunk info from bridge partners

### DTMF Dispatch
- AMI DTMFEnd events dispatched to monitoring clients via bridge/channel matching
- Skips user's own SIP extension keypresses (remote/called-party DTMF only)
- Per-client monitor state tracked in Map, auto-cleaned on hangup
- Direction filter: only `Received`, duration >= 40ms (filters spurious)

### Permissions System
- File: `/opt/calltools-v2-permissions.json` (shared with V1 at `/opt/calltools-permissions.json`)
- Structure: `{tools, defaults, admin_restrictions, user_restrictions, user_account_restrictions, ip_restrictions, audio_approvals, allowed_accounts, rate_limit_whitelist}`
- 3-layer cascade: defaults → admin_restrictions[sip_user] → user_restrictions[user_id][sip_user]
- 11 permission flags: dtmf, transcript, audio_player, caller_id, moh, quick_dial, cdr, billing, allow_tollfree_callerid, cnam_lookup, call_cost
- Access control: `allowed_accounts` list gates who can log in (admins always allowed)
- Admin updates use `__access_control__` target for allowed_accounts changes

### Admin Broadcast
- Uses `broadcastToAll()` function wired from index.ts to router via `setBroadcastFunction()`
- Broadcasts reach all authenticated WebSocket clients

### Heleket Payment
- Credentials loaded from `pkg_method_pay` WHERE `payment_method = 'Heleket'`
- Signature: `md5(base64(json_body) + api_key)` — must match PHP's `md5(base64_encode($json) . $apiKey)`
- JSON body escapes forward slashes (`/` → `\/`) to match PHP's `json_encode`
- Callback URL: `https://sip.osetec.net/mbilling/index.php/heleket`

### External Services on VPS
- **Signup**: `/calltools-signup.php` — PHP endpoint for account creation (plans, captcha)
- **BIN Lookup**: `/bin-lookup.php` — PHP endpoint for card BIN database lookup
- Both are called directly from the frontend (not through V2 backend)

### Legacy System Ports
- V1 backend (dtmf-monitor.py) runs on port **9900**
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
- **MySQL**: `mbilling` database (read-only from V2, except pkg_user.credit and pkg_refill for billing)
- **Asterisk AMI**: Subscribe to events, send Originate/Redirect/Atxfer actions
- **Asterisk CLI**: `core show channels concise`, `sip show peers` (read-only)
- **Whisper GPU**: `localhost:8765` via SSH tunnel to Vast.ai
- **Heleket API**: `https://api.heleket.com/v1/payment` — USDT payment gateway
- **Telnyx API**: `https://api.telnyx.com/v2/number_lookup/` — CNAM/carrier lookup
- **IPQualityScore API**: Phone fraud scoring (key configured but not yet wired)

## Security Design
- All passwords verified via bcrypt/SHA1/plaintext cascade (no PHP subprocess)
- All SQL queries use prepared statements via mysql2 driver
- WebSocket messages validated with Zod schemas
- Per-user connection limit (max 3 concurrent)
- Token-bucket rate limiting on all commands
- All permission checks logged to audit trail
- WSS only via Apache proxy (no unencrypted WebSocket)
- Session resume with IP pinning and 5-minute TTL

## Feature Parity Status (V1 → V2)

### Implemented
- Login/auth (SIP + pkg_user, bcrypt/SHA1/plaintext)
- Signup (via /calltools-signup.php)
- Session resume with full state restoration
- Channel monitoring (live call list with 3s polling)
- DTMF monitoring (AMI DTMFEnd dispatch to clients)
- Caller ID management (set/clear with toll-free validation)
- Quick dial (AMI Originate)
- Transfer call (blind + attended)
- CNAM lookup (Telnyx API with name filtering)
- BIN lookup (via /bin-lookup.php)
- CDR query (search, date filter, pagination, merged pkg_cdr + pkg_cdr_failed)
- Billing (balance, USDT recharge via Heleket, refill history)
- Admin dashboard (stats cards, ASR by trunk, top numbers)
- Admin permissions manager (per-SIP 11-flag toggles)
- Admin access control (allowed_accounts add/remove)
- Admin sessions viewer (with force logout)
- Admin broadcast (to all connected users)
- Admin audit log viewer (with actor/action filters)
- Admin manual credit (add/deduct with note)
- Admin users overview (accounts with balance/SIP count)
- SIP user selector in header
- Balance display in header
- Event log drawer
- Desktop notifications (for admin broadcasts)
- Mobile responsive layout

### Not Yet Implemented
- **Per-call transcript display modal** — transcript backend works (ElevenLabs Scribe), but no frontend modal to show live transcript per-channel
- **Transcript history** — saved transcripts persistence
- **SIP Usage peak hours chart** and **top destinations table** — SIP usage summary exists but missing these V1 sub-sections
- **SIP Usage table column sorting** — V1 has clickable sortable headers

## GitHub
- **Repo**: `SIXHF/cyborg-calltools-v2`
- **Dev branch**: `claude/calltools-v2-continuation-cX6nc`
- **Legacy repo**: `SIXHF/cyborg-calltools` (not modified by V2)

## Development Workflow

### CRITICAL: V1 Is The Source of Truth — NEVER ASSUME
- **NEVER assume** any value, threshold, color, behavior, layout, or UX flow
- **ALWAYS read the actual V1 code** before implementing anything in V2
- Every hardcoded number, color hex, threshold, timeout, label, format, sort order, and UI element MUST come directly from V1
- If V1 uses `>= 200` for green trunk balance, use `>= 200` — do NOT guess `>= 50` or `>= 10`
- If V1 shows status as "ANSWERED" (uppercase), use "ANSWERED" — do NOT change to "answered" (lowercase)
- If V1 uses a dropdown, use a dropdown — do NOT substitute toggle buttons
- If V1 formats cost as `$X.XX`, use that format — do NOT use `$X.XXXX`
- When in doubt, READ THE V1 CODE. When not in doubt, STILL READ THE V1 CODE

### Before Implementing ANY Feature
1. Read the EXACT V1 implementation (both frontend HTML/JS and backend Python)
2. Note every value: colors, thresholds, formats, labels, layout, behavior
3. Implement in V2 using those EXACT values
4. Verify the implementation matches V1 line by line
5. Only THEN move to the next feature

### Multi-Agent Strategy
Always use multiple agents in parallel to divide workload:
- Launch 2-4 agents simultaneously for code reviews, audits, and research
- One agent per concern: frontend bugs, backend bugs, schema mismatches, V1 comparison
- Wait for ALL agents to complete before implementing fixes
- Fix everything in one batch, build once, deploy once
- Never do piecemeal patches — collect all issues first, then fix all at once

### Code Review Protocol
Before any deploy, run parallel review agents checking:
1. Frontend components: useEffect deps, stale closures, event dispatch
2. Backend handlers: SQL injection, permission checks, async/await issues
3. Message schema: Zod union completeness, router coverage, type mismatches
4. V1 parity: feature-by-feature comparison against legacy code — check EVERY value against V1

### What NOT To Do
- Do NOT assume thresholds, colors, or formats — READ V1
- Do NOT invent new UX patterns — COPY V1
- Do NOT change labels, button text, or error messages — USE V1's exact text
- Do NOT deploy piecemeal fixes — COLLECT all issues, fix ALL at once
- Do NOT skip reading V1 code because "I think I know what it does"
- Do NOT substitute UI components (e.g., toggle buttons instead of dropdown) without explicit user approval
