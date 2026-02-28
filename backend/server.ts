import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  createSession,
  getSession,
  streamFirstReply,
  streamChatReply,
} from './advisor.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'API is running' });
});

app.get('/api/hello', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from the backend!' });
});

app.post('/api/advisor/session', async (req: Request, res: Response) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'Advisor is not configured (missing OPENAI_API_KEY)' });
      return;
    }
    const { image, firstMessage } = req.body as { image?: string; firstMessage?: string };
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'Missing or invalid image (base64 string required)' });
      return;
    }
    const sessionId = createSession(image, firstMessage);
    await streamFirstReply(sessionId, image, firstMessage, res);
  } catch (err) {
    console.error('Advisor session error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start advisor session' });
    }
  }
});

app.post('/api/advisor/chat', async (req: Request, res: Response) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'Advisor is not configured (missing OPENAI_API_KEY)' });
      return;
    }
    const { sessionId, message } = req.body as { sessionId?: string; message?: string };
    if (!sessionId || typeof message !== 'string') {
      res.status(400).json({ error: 'Missing sessionId or message' });
      return;
    }
    if (!getSession(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await streamChatReply(sessionId, message.trim(), res);
  } catch (err) {
    console.error('Advisor chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to get reply' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
