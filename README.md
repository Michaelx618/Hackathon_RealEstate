# Renovate — AI renovation & conversion advisor

**Design, price, and evaluate your property project with AI.** Enter your address/location, upload the current floor plan/photo, optionally upload documents (land size, plan PDFs, notes) and a target-outcome image, then get phased renovation guidance plus construction cost, total out-of-pocket, and rental-return estimates.

---

## Quick start (for judges / Devpost demo)

From the project root:

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.  
For full AI advice, add `OPENAI_API_KEY` to a `.env` file in the **project root** (copy from `.env.example`). The backend loads env from the root. Without it, the advisor still loads and shows a friendly “not configured” message.

---

## Hackathon app (technical overview)

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

**Run both frontend and backend at once** (from project root):

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**. Backend runs on port 3000; frontend proxies `/api` to it.

To run them separately:
```bash
# Terminal 1 – backend
cd backend && npm install && npm run dev

# Terminal 2 – frontend
cd frontend && npm install && npm run dev
```

- **Frontend:** http://localhost:5173  
- **Backend API:** http://localhost:3000  

The frontend proxies `/api` requests to the backend in development.

**Single port (unified, for testing or deployment):** Build once, then run the server; it serves both the app and the API on one port:

```bash
npm run build
npm start
```

Then open **http://localhost:3000**. Put `OPENAI_API_KEY` in a root `.env` (see `.env.example`).

### Construction + return advisor

The **Construction + return advisor** flow is the main feature: users enter location, choose property + renovation type, upload a current-state image/floor plan, optionally add supporting documents and a target-outcome image, then get:
- image-vs-document size cross-checks
- construction-cost range
- permit + soft-cost assumptions
- total out-of-pocket estimate
- rent and simple payback estimates

The backend uses the OpenAI API (GPT-4o with vision), plus public benchmark references for Toronto permit/rent/zoning context.

Benchmark links used in the app:
- Toronto zoning map: https://map.toronto.ca/maps/map.jsp?app=ZBL_CONSULT
- Toronto building permit fees: https://www.toronto.ca/services-payments/building-construction/building-fees/building-permit-fees/
- Rentals.ca national rent report: https://rentals.ca/national-rent-report
- Urbanation condo rental survey (Toronto): https://urbanation.ca/news/q2-2025-condominium-rental-market-survey

**API key:** Set `OPENAI_API_KEY` in a `.env` file at the **project root** (copy `.env.example`). The backend loads it via `load-env`. Without it, the advisor and furniture preview return a friendly “not configured yet” message.

---

## How to test

1. **Start the app** (from project root):
   ```bash
   npm install
   npm run dev
   ```
2. Open **http://localhost:5173** in your browser.
3. **Home:** Enter a city/ZIP and click “Start my renovation plan” — you should land on the advisor with location pre-filled. Click “Design & renovate” in the nav to go there directly.
4. **Construction + return advisor:** Pick property + renovation level, enter location, upload a current image (required), optionally upload target image and supporting docs, and click “Calculate project economics”. If `OPENAI_API_KEY` is set, you’ll get a streamed estimate with out-of-pocket + rent return and can send follow-up messages; if not, you’ll see the “not configured yet” message.
5. **Listings:** Use “Example listings” and filters (city, type) — all sample data.
6. **About / Contact:** Static pages and contact form (success message is local only).
7. **404:** Visit e.g. `/foo` — you should see “Page not found” with a link home.

**Mobile:** Resize the browser or use dev tools device mode; the layout should stack and remain usable.

---

## Deployment (for hosting)

When your team sets up hosting and the API:

- **Frontend:** Build with `cd frontend && npm run build`. Serve the `frontend/dist` folder (e.g. Vercel, Netlify, or any static host). Set the API base URL if the backend is on a different origin (or use relative `/api` and proxy in production).
- **Backend:** Set `OPENAI_API_KEY` and `PORT` in the host’s environment. Run `npm run build` then `npm start`, or run with `tsx`/`node` in dev. Enable CORS for the frontend origin if they’re on different domains.
- **Env:** Copy `backend/.env.example` to `backend/.env` and fill in; the host will use their own env vars (no need to commit `.env`).

## Scripts

| Location  | Command     | Description        |
|----------|-------------|--------------------|
| **root** | `npm run dev` | Start backend + frontend together |
| frontend | `npm run dev` | Vite dev server   |
| frontend | `npm run build` | Production build |
| backend  | `npm run dev` | Run server with tsx (no build) |
| backend  | `npm run build` | Compile TS to `dist/` |
| backend  | `npm run test:api` | Test advisor API (prompt + vision); uses `OPENAI_API_KEY` from `.env` |
| backend  | `npm start`   | Run compiled server |

---

## Devpost submission (copy-paste)

**Title:** Renovate — AI renovation & conversion advisor

**Tagline:** From current floor plan to project economics: upload current state + optional docs, then get construction cost, out-of-pocket cash estimate, and rental return.

**What it does:** Users enter address/city/ZIP, pick property + renovation type, upload a current image/floor plan, and optionally add supporting docs (PDF/text/image), area fields, and a target-outcome image. GPT-4o with vision compares current vs target state, estimates rough size, cross-checks document space data, and returns structured outputs for construction cost, permit/soft-cost assumptions, total out-of-pocket, monthly/annual rent estimate, simple payback, phased renovation plan, and zoning/permit reminders. Users can chat for follow-up scenario analysis.

**How we built it:** React + Vite (TypeScript) frontend, Node.js Express (TypeScript) backend. OpenAI API (GPT-4o) for chat and vision; streaming responses for the advisor. Frontend parses the reply for “Phase 1/2/3” and “Estimated cost” to show a timeline and cost card. Session-based chat so users can ask follow-ups. Image upload with client-side resize/compress before sending.

**Challenges:** Keeping the AI output structured enough for the timeline/cost UI while staying conversational; handling missing API key gracefully so the app runs in any environment.

**What's next:** Optional address → property lookup, save/export plans, and integration with permit databases by jurisdiction.
