# Project EVA – Personal AI Digital Twin

Independent application using **the same database (PostgreSQL) and same stack (Node.js, Express, React)** as the Halisoft platform. EVA runs as a separate process and can share the same `DATABASE_URL`; its data lives in the `eva` schema.

## What is EVA?

EVA is a Personal AI Digital Twin: a behavioral proxy that mirrors, learns from, and can represent you in digital interactions. This repo contains:

- **Backend (Node + Express)** – API for drafts, audit logs, settings, data sources. Port **5002**.
- **Web portal (React + Vite)** – Command center: dashboard, **chat (Parler à EVA)**, drafts queue, audit log, kill switch, data sources. Port **3001**.

Phases 1–2 (Memory Vault, Voice, Shadow Mode) are supported by this app; the Python pipeline (LangChain, Qdrant, embeddings) and Flutter mobile app are separate.

## Same DB, same stack

| Layer     | Halisoft        | EVA (this app)     |
|----------|------------------|---------------------|
| Database | PostgreSQL (RLS) | Same PostgreSQL, schema `eva` |
| Backend  | Node.js + Express (5001) | Node.js + Express (5002) |
| Frontend | React (CRA)      | React + Vite (3001) |

## Production URL

**https://eva.halisoft.biz** — Use this domain when you deploy EVA (frontend + API behind same host or via `api.eva.halisoft.biz` for the API).

## Quick start

### 1. Database migration

Run the EVA schema migration on the **same** PostgreSQL instance used by Halisoft:

```bash
# From repo root
psql "$DATABASE_URL" -f migrations/2026_02_20_create_eva_schema.sql
```

Or use your existing migration runner if you have one.

### 2. Backend

```bash
cd eva
cp .env.example .env
# Set DATABASE_URL (same as Halisoft) or EVA_DATABASE_URL
npm install
npm run server
```

API runs at **http://localhost:5002**. Health: `GET /health`.

### 3. Web portal

```bash
cd eva/web
npm install
npm run dev
```

Portal runs at **http://localhost:3001**. It proxies `/api` to the EVA backend (see `vite.config.js`).

### 4. Run both (backend + frontend)

From `eva/`:

```bash
npm run dev
```

## Environment variables

| Variable           | Description |
|-------------------|-------------|
| `DATABASE_URL`    | Same as Halisoft PostgreSQL connection string. EVA uses schema `eva`. |
| `EVA_DATABASE_URL` | Optional; overrides `DATABASE_URL` for EVA. |
| `PORT`            | EVA API port (default **5002**). |
| `EVA_API_KEY`     | Optional. If set, requests must send `X-Api-Key` or `?api_key=`. |
| `EVA_OWNER_EMAIL` | Default owner email (default `loic@halisoft.biz`). |

## API overview

- `POST /api/chat` – **Talk to EVA**: send `{ "message": "…", "history": [] }`, get `{ "reply": "…" }` (Claude).
- `GET/POST /api/drafts` – List or create drafts (approve-before-send).
- `PATCH /api/drafts/:id` – Update draft (e.g. status: approved, rejected, sent).
- `GET/POST /api/audit-logs` – List or append audit log.
- `GET /api/settings`, `PUT /api/settings/:key` – Settings (e.g. kill switch).
- `GET /api/data-sources` – Registered ingestion sources (Phase 1).
- `GET /api/confidence-summary` – Confidence scores by category (dashboard).

## Project layout

```
eva/
├── package.json
├── .env.example
├── README.md
├── server/
│   ├── index.js      # Express app, port 5002
│   ├── db.js         # PostgreSQL, eva schema
│   └── routes/
│       └── eva.js    # Drafts, audit, settings, data sources
└── web/              # React + Vite portal
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── components/
        │   └── Layout.jsx
        └── pages/
            ├── Dashboard.jsx
            ├── Drafts.jsx
            ├── AuditLog.jsx
            ├── Settings.jsx
            └── DataSources.jsx
```

## Phases (from EVA docs)

- **Phase 1** – Archive & Memory Vault: Python pipeline + Qdrant + embeddings. This app stores metadata and audit; the RAG pipeline is separate.
- **Phase 2** – Voice + Shadow Mode: OpenAI Realtime API, Flutter app. This app: drafts queue, audit log.
- **Phase 3** – Limited proxy: approve-before-send. This app: draft approve/reject/send.
- **Phase 4–5** – Fine-tuned model, autonomous proxy. This app: settings (kill switch), confidence summary, audit.

## Production URL / Deployment

**There is no production URL for EVA yet.** The app runs locally (backend **5002**, portal **3001**) and the code lives in **https://github.com/Loic1968/EVA**.

To get a URL in production to test EVA:

1. **Deploy the backend** (Node API) to a host that runs Node and has access to your PostgreSQL (e.g. **Render** “Web Service”, **Railway**, **Fly.io”). Set `DATABASE_URL`, `ANTHROPIC_API_KEY`, and optionally `EVA_API_KEY`. The service will get a URL like `https://eva-api-xxxx.onrender.com`.
2. **Deploy the frontend** (Vite build):
   - Build: `cd web && npm run build` → output in `web/dist`.
   - Host `web/dist` as a static site (e.g. **Render** “Static Site”, **Vercel**, **Cloudflare Pages**).
   - If the API is on another host, build with `VITE_EVA_API_URL=https://api.eva.halisoft.biz npm run build` so the frontend calls that API.
3. Point your domain **https://eva.halisoft.biz** to the frontend (static site), and either serve the API on the same host (e.g. reverse-proxy `/api` to the Node service) or at **https://api.eva.halisoft.biz**.

After deployment, your **prod URL to test EVA** is **https://eva.halisoft.biz**.

## Security

- Use `EVA_API_KEY` in production for API access.
- Kill switch in Settings pauses autonomous operations (stored in `eva.settings`).
- All EVA tables are in schema `eva`; no FK to Halisoft `users` so EVA stays independent.

---

HaliSoft L.L.C-FZ | Dubai, UAE | 2026
