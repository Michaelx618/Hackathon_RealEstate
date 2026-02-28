# Hackathon App

React + Vite frontend and Node.js Express backend, both in **TypeScript**.

## TypeScript configs

| File | Purpose |
|------|--------|
| **Frontend** | |
| `frontend/tsconfig.json` | Main TS config: strict mode, React JSX, ESNext modules, `src` only. |
| `frontend/tsconfig.node.json` | Config for Vite config file (`vite.config.ts`) only. |
| `frontend/src/vite-env.d.ts` | Vite client types (e.g. `import.meta.env`, asset imports). |
| **Backend** | |
| `backend/tsconfig.json` | Node/Express: ES2022, NodeNext modules, strict, output to `dist/`. |

**Frontend:** Vite compiles TS on the fly; no separate `tsc` step for dev.  
**Backend:** `npm run dev` uses `tsx` to run `server.ts` directly; `npm run build` runs `tsc` to emit `dist/`.

## Push to GitHub

1. Create a new repository on [GitHub](https://github.com/new) (do not add a README or .gitignore).
2. Then run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## Setup

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend (in another terminal)
cd backend && npm install && npm run dev
```

- **Frontend:** http://localhost:5173  
- **Backend API:** http://localhost:3001  

The frontend proxies `/api` requests to the backend in development.

## Scripts

| Location  | Command     | Description        |
|----------|-------------|--------------------|
| frontend | `npm run dev` | Vite dev server   |
| frontend | `npm run build` | Production build |
| backend  | `npm run dev` | Run server with tsx (no build) |
| backend  | `npm run build` | Compile TS to `dist/` |
| backend  | `npm start`   | Run compiled server |
