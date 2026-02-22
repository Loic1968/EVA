# Project EVA – Personal AI Digital Twin

**EVA** is a Personal AI Digital Twin for Loic Hennocq, Founder & CEO of HaliSoft L.L.C-FZ (Dubai, UAE). It mirrors, learns from, and ultimately represents its creator in digital and professional interactions.

This repo contains the **web application**: backend API + frontend command center. The Python RAG pipeline (LangChain, Qdrant, embeddings) and Flutter mobile app are separate projects.

## Architecture

| Layer     | Halisoft Platform | EVA (this app)        |
|----------|-------------------|-----------------------|
| Database | PostgreSQL (RLS)  | Same PostgreSQL, schema `eva` |
| Backend  | Node.js + Express (5001) | Node.js + Express (5002) |
| Frontend | React (CRA)       | React + Vite + Tailwind (3001) |
| AI       | —                  | Claude (Anthropic SDK) |

## Features

- **Chat with EVA** — AI-powered conversation with persistent history, behavioral context, and feedback loop
- **Conversation persistence** — All chats saved to PostgreSQL, resumable across sessions
- **Drafts queue** — Approve-before-send workflow for emails, WhatsApp, LinkedIn (Phase 2-3)
- **Document upload** — Drag & drop files for Memory Vault ingestion
- **Audit log** — Every EVA action logged with full explainability
- **Kill switch** — Instantly pause all autonomous operations
- **Data sources** — Register and track ingestion from Gmail, WhatsApp, Drive, etc.
- **Dashboard** — Real-time stats, phase progress, recent activity
- **Feedback system** — Thumbs up/down and corrections to train EVA's behavioral model

## Quick start

### 1. Database migration

Run the EVA schema on the **same** PostgreSQL instance as Halisoft:

```bash
psql "$DATABASE_URL" -f migrations/001_create_eva_schema.sql
```

### 2. Backend

```bash
cp .env.example .env
# Set DATABASE_URL and ANTHROPIC_API_KEY
npm install
npm run server
```

API runs at **http://localhost:5002**. Health: `GET /health`.

### 3. Web portal

```bash
cd web
npm install
npm run dev
```

Portal runs at **http://localhost:3001** (proxies `/api` to backend).

### 4. Run both

```bash
npm run dev
```

## Environment variables

| Variable           | Description |
|-------------------|-------------|
| `DATABASE_URL`    | PostgreSQL connection string (same as Halisoft) |
| `ANTHROPIC_API_KEY` | Claude API key for EVA chat |
| `EVA_PORT` / `PORT` | API port (default 5002) |
| `EVA_API_KEY`     | Optional API key for production |
| `EVA_OWNER_EMAIL` | Default owner (default `loic@halisoft.biz`) |
| `VITE_EVA_API_URL` | Build-time: external API URL for frontend |

## API endpoints

### Chat & Conversations
- `POST /api/chat` — Send a message (with optional `conversation_id`)
- `GET /api/conversations` — List conversations
- `POST /api/conversations` — Create a conversation
- `GET /api/conversations/:id/messages` — Get messages
- `DELETE /api/conversations/:id` — Delete a conversation

### Drafts
- `GET /api/drafts` — List drafts
- `POST /api/drafts` — Create a draft
- `PATCH /api/drafts/:id` — Update draft status

### Documents & Data
- `GET /api/documents` — List uploaded documents
- `POST /api/documents/upload` — Upload a file (raw body + X-Filename header)
- `GET /api/data-sources` — List registered data sources
- `POST /api/data-sources` — Register a new source

### Monitoring
- `GET /api/audit-logs` — Audit trail
- `GET /api/settings` — Read settings
- `PUT /api/settings/:key` — Update a setting
- `GET /api/confidence-summary` — Confidence scores by category
- `GET /api/stats` — Dashboard statistics
- `POST /api/feedback` — Submit behavioral feedback

## Project layout

```
eva/
├── migrations/
│   └── 001_create_eva_schema.sql
├── server/
│   ├── index.js          # Express app (port 5002, serves web/dist in prod)
│   ├── db.js             # PostgreSQL client (eva schema)
│   ├── evaChat.js        # Claude AI agent with behavioral prompt
│   └── routes/
│       └── eva.js        # All API routes
├── web/
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── App.jsx
│       ├── api.js        # API client
│       ├── components/
│       │   └── Layout.jsx
│       └── pages/
│           ├── Dashboard.jsx
│           ├── Chat.jsx
│           ├── Drafts.jsx
│           ├── Documents.jsx
│           ├── AuditLog.jsx
│           ├── Settings.jsx
│           └── DataSources.jsx
├── uploads/              # Document uploads (gitignored)
├── package.json
├── render.yaml
└── .env.example
```

## Deployment (Render)

One Render Web Service serves both API and frontend at **https://eva.halisoft.biz**.

```bash
npm install && npm run build   # Build
npm start                       # Start
```

Set env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `EVA_API_KEY`, `NODE_ENV=production`.

## EVA Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | Archive & Memory Vault | Building |
| 2 | Voice + Shadow Mode | Building |
| 3 | Limited Proxy (approve-before-send) | Planned |
| 4 | Fine-Tuned Model | Planned |
| 5 | Autonomous Proxy | Planned |

## Security

- `EVA_API_KEY` required in production
- Kill switch pauses all autonomous operations
- All data in isolated `eva` schema
- Full audit trail for every action
- AES-256 encryption recommended for production VPS

---

HaliSoft L.L.C-FZ | Dubai, UAE | 2026
