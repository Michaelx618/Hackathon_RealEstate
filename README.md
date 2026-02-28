# Hackathon App

React + Vite frontend with Node.js Express backend.

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
| backend  | `npm run dev` | Express with watch |
| backend  | `npm start`   | Run server        |
