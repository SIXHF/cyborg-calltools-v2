# CallTools V2

Modern rewrite of the CallTools real-time call monitoring platform for Magnus Billing / Asterisk.

**Stack**: Bun + TypeScript (backend) | React + Vite + Tailwind (frontend)

## Quick Start

```bash
bun install
bun run dev
```

Backend runs on `ws://localhost:8766`, frontend on `http://localhost:3000`.

## Features

- Real-time call monitoring via Asterisk AMI
- DTMF capture and display
- Live call transcription (Whisper GPU)
- CNAM and fraud score lookups
- Audio playback and approval workflow
- Role-based access (admin, user, SIP user)
- Admin dashboard with permissions management

## Architecture

```
packages/
  shared/    — TypeScript types + Zod message schemas
  backend/   �� Bun WebSocket server
  frontend/  — React + Vite app
```

See [CLAUDE.md](./CLAUDE.md) for full documentation.
