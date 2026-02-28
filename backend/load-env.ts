import { fileURLToPath } from 'url';
import path from 'path';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.join(process.cwd(), '.env');
const backendEnv = path.join(__dirname, '..', '.env');
// Load backend/.env first, then root .env so root wins when both exist (e.g. "npm start" from root)
loadEnv({ path: backendEnv });
loadEnv({ path: rootEnv });
