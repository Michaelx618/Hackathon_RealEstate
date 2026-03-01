# HomeKey - Real Estate Hackathon App

A React + Express application for browsing real estate listings with AI-powered renovation cost estimation and furnishing preview features, powered by Google Gemini.

## Architecture

- **Frontend**: React 19 + TypeScript, built with Vite, runs on port 5000
- **Backend**: Express + TypeScript (tsx), runs on port 3000
- **AI**: Google Gemini (via OpenAI-compatible client) for renovation advisor and furnishing preview

## Project Structure

```
/
├── frontend/              # React/Vite frontend
│   ├── src/
│   │   ├── pages/         # Route pages (Home, Listings, Advisor, FurnishingPreview, etc.)
│   │   ├── components/    # Shared components (Navbar, ListingPopup, etc.)
│   │   └── data/          # Static data (listings, demo, advisorQuestions)
│   └── vite.config.ts     # Dev server on 0.0.0.0:5000, proxies /api to backend
├── backend/               # Express API
│   ├── server.ts          # API routes
│   ├── advisor.ts         # Renovation advisor logic (Gemini chat + image)
│   ├── ai-client.ts       # Gemini API client wrapper
│   ├── furnishing.ts      # Furnishing logic
│   ├── furnishing-chat.ts # Furnishing chat session management
│   ├── load-env.ts        # Environment variable loading
│   └── scripts/           # Test scripts
├── start.sh               # Starts both backend and frontend concurrently
└── package.json           # Root package with dev/build/start scripts
```

## Running

The workflow runs `bash start.sh` which starts:
1. Backend: `npm run dev --prefix backend` → port 3000
2. Frontend: `npm run dev --prefix frontend` → port 5000

## Environment Variables

- `GEMINI_API_KEY` (required for advisor + furnishing features) — set as a Replit secret

## Key API Routes

- `GET /api/health` — health check
- `POST /api/advisor/session` — start advisor session (streams Gemini response)
- `POST /api/advisor/chat` — continue advisor chat
- `GET /api/advisor/research/:sessionId` — get address research for a session
- `POST /api/advisor/render` — render advisor preview image
- `POST /api/furnishing/session` — start furnishing session
- `POST /api/furnishing/chat` — continue furnishing chat
- `POST /api/furnishing/preview` — generate furnishing preview

## Deployment

- Build: `npm run build` (builds frontend with Vite, backend with TypeScript compiler)
- Run: `PORT=5000 npm start` (serves compiled backend which also serves frontend static files)
- Target: Autoscale
