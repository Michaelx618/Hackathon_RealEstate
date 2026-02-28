import './load-env';
import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { isGeminiConfigured } from './ai-client.js';
import {
  createSession,
  getSession,
  renderAdvisorPreview,
  streamFirstReply,
  streamChatReply,
} from './advisor.js';
import type { AdvisorDocumentInput, AdvisorSessionInput } from './advisor.js';
import {
  createFurnishingSession,
  getFurnishingSession,
  runFurnishingTurn,
} from './furnishing-chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '35mb' }));

// Serve frontend build from same port (for deployment)
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  return out.length > 0 ? out : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(/,/g, '').trim());
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
  }
  return undefined;
}

function sanitizeSupportingDocs(value: unknown): AdvisorDocumentInput[] {
  if (!Array.isArray(value)) return [];
  const docs: AdvisorDocumentInput[] = [];

  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const name = optionalString(obj.name) || 'Uploaded document';
    const mimeType = optionalString(obj.mimeType) || 'application/octet-stream';
    const textContent = optionalString(obj.textContent);
    const dataUrl = optionalString(obj.dataUrl);

    if (!textContent && !dataUrl) continue;
    docs.push({ name, mimeType, textContent, dataUrl });
  }

  return docs;
}

function sanitizeImageArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  const images: string[] = [];
  for (const raw of value.slice(0, max)) {
    const image = optionalString(raw);
    if (image) images.push(image);
  }
  return images;
}

function sanitizeUrlArray(value: unknown, max = 8): string[] {
  const urls: string[] = [];

  const pushIfValid = (raw: unknown): void => {
    const candidate = optionalString(raw);
    if (!candidate) return;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        urls.push(parsed.toString());
      }
    } catch {
      // Ignore invalid URL values from user input.
    }
  };

  if (Array.isArray(value)) {
    for (const raw of value.slice(0, max * 2)) pushIfValid(raw);
  } else if (typeof value === 'string') {
    for (const chunk of value.split(/[\n,]+/g).slice(0, max * 2)) pushIfValid(chunk);
  }

  return urls.slice(0, max);
}

function sanitizeFurnishingAction(value: unknown):
  | { type: 'select_option'; slotId: string; optionId: string }
  | { type: 'clear_slot'; slotId: string }
  | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const action = value as Record<string, unknown>;
  const type = optionalString(action.type);
  const slotId = optionalString(action.slotId);
  if (!slotId) return undefined;

  if (type === 'select_option') {
    const optionId = optionalString(action.optionId);
    if (!optionId) return undefined;
    return { type: 'select_option', slotId, optionId };
  }

  if (type === 'clear_slot') {
    return { type: 'clear_slot', slotId };
  }

  return undefined;
}

function isUnsupportedPropertyType(value: string | undefined): boolean {
  if (!value) return false;
  return /(condo|apartment)/i.test(value);
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'API is running' });
});

app.get('/api/hello', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from the backend!' });
});

app.post('/api/furnishing/preview', async (req: Request, res: Response) => {
  try {
    if (!isGeminiConfigured()) {
      res.status(503).json({ error: 'Furnishing preview is not configured (missing GEMINI_API_KEY)' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const roomImage = optionalString(body.roomImage)
      || optionalString(body.unitImage)
      || optionalString(body.image);

    if (!roomImage) {
      res.status(400).json({ error: 'Missing room image (base64/data URL image required)' });
      return;
    }
    const location = optionalString(body.location);
    if (!location) {
      res.status(400).json({ error: 'Missing property address/location (required for localized product pricing).' });
      return;
    }

    const productLinks = sanitizeUrlArray(body.productLinks, 10);
    const requestText = optionalString(body.requestText)
      || optionalString(body.description)
      || optionalString(body.prompt);

    const sessionId = createFurnishingSession({
      roomImage,
      floorPlanImage: optionalString(body.floorPlanImage),
      location,
      firstMessage: requestText,
      productLinks,
    });
    const result = await runFurnishingTurn(sessionId, {
      message: requestText,
      productLinks,
    });

    res.json(result);
  } catch (err) {
    console.error('Furnishing preview error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate furnishing preview' });
    }
  }
});

app.post('/api/furnishing/session', async (req: Request, res: Response) => {
  try {
    if (!isGeminiConfigured()) {
      res.status(503).json({ error: 'Furnishing preview is not configured (missing GEMINI_API_KEY)' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const roomImage = optionalString(body.roomImage)
      || optionalString(body.unitImage)
      || optionalString(body.image);
    const floorPlanImage = optionalString(body.floorPlanImage);
    const firstMessage = optionalString(body.firstMessage)
      || optionalString(body.requestText)
      || optionalString(body.description);
    const location = optionalString(body.location);

    if (!roomImage) {
      res.status(400).json({ error: 'Missing room image (base64/data URL image required)' });
      return;
    }
    if (!location) {
      res.status(400).json({ error: 'Missing property address/location (required for localized product pricing).' });
      return;
    }

    const productLinks = sanitizeUrlArray(body.productLinks, 10);
    const sessionId = createFurnishingSession({
      roomImage,
      floorPlanImage,
      location,
      firstMessage,
      productLinks,
    });

    const result = await runFurnishingTurn(sessionId, {
      message: firstMessage,
      productLinks,
    });

    res.setHeader('X-Session-Id', sessionId);
    res.json(result);
  } catch (err) {
    console.error('Furnishing session error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start furnishing session' });
    }
  }
});

app.post('/api/furnishing/chat', async (req: Request, res: Response) => {
  try {
    if (!isGeminiConfigured()) {
      res.status(503).json({ error: 'Furnishing preview is not configured (missing GEMINI_API_KEY)' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const sessionId = optionalString(body.sessionId);
    const message = optionalString(body.message);
    const action = sanitizeFurnishingAction(body.action);
    const productLinks = sanitizeUrlArray(body.productLinks, 10);

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    if (!message && !action) {
      res.status(400).json({ error: 'Provide a message or action' });
      return;
    }
    if (!getFurnishingSession(sessionId)) {
      res.status(404).json({ error: 'Furnishing session not found' });
      return;
    }

    const result = await runFurnishingTurn(sessionId, {
      message,
      action,
      productLinks,
    });

    res.json(result);
  } catch (err) {
    console.error('Furnishing chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process furnishing chat turn' });
    }
  }
});

app.post('/api/advisor/session', async (req: Request, res: Response) => {
  try {
    if (!isGeminiConfigured()) {
      res.status(503).json({ error: 'Advisor is not configured (missing GEMINI_API_KEY)' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const currentImages = sanitizeImageArray(body.currentImages);
    const targetImages = sanitizeImageArray(body.targetImages);

    const fallbackCurrentImage = optionalString(body.currentImage) || optionalString(body.image);
    const currentImage = currentImages[0] || fallbackCurrentImage;
    if (!currentImage) {
      res.status(400).json({ error: 'Missing current image (base64/data URL image required)' });
      return;
    }
    const fallbackTargetImage = optionalString(body.targetImage);

    const firstMessage = optionalString(body.firstMessage);
    const location = optionalString(body.location);
    if (!location) {
      res.status(400).json({ error: 'Missing property address/location (required for localized pricing).' });
      return;
    }
    const requestedPropertyType = optionalString(body.propertyType);
    if (isUnsupportedPropertyType(requestedPropertyType)) {
      res.status(400).json({ error: 'Only house-type properties are supported right now (no condo/apartment).' });
      return;
    }
    const sessionInput: AdvisorSessionInput = {
      currentImage,
      currentImages: currentImages.length ? currentImages : [currentImage],
      targetImage: targetImages[0] || fallbackTargetImage,
      targetImages: targetImages.length
        ? targetImages
        : (fallbackTargetImage ? [fallbackTargetImage] : []),
      firstMessage,
      currentHouseStatus: optionalString(body.currentHouseStatus),
      propertyType: requestedPropertyType || 'House / Townhouse',
      location,
      documentNotes: optionalString(body.documentNotes),
      supportingDocs: sanitizeSupportingDocs(body.supportingDocs),
      landAreaSqft: optionalNumber(body.landAreaSqft),
      interiorAreaSqft: optionalNumber(body.interiorAreaSqft),
      desiredRentableSqft: optionalNumber(body.desiredRentableSqft),
      renovationLevel: optionalString(body.renovationLevel),
    };

    const sessionId = createSession(sessionInput);
    await streamFirstReply(sessionId, firstMessage, res);
  } catch (err) {
    console.error('Advisor session error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start advisor session' });
    }
  }
});

app.post('/api/advisor/chat', async (req: Request, res: Response) => {
  try {
    if (!isGeminiConfigured()) {
      res.status(503).json({ error: 'Advisor is not configured (missing GEMINI_API_KEY)' });
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

app.post('/api/advisor/render', async (req: Request, res: Response) => {
  try {
    if (!isGeminiConfigured()) {
      res.status(503).json({ error: 'Advisor is not configured (missing GEMINI_API_KEY)' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const sessionId = optionalString(body.sessionId);
    const instruction = optionalString(body.instruction) || optionalString(body.message);
    const referenceImages = sanitizeImageArray(body.referenceImages, 4);

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    if (!getSession(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const result = await renderAdvisorPreview(sessionId, {
      instruction,
      referenceImages,
    });

    res.json(result);
  } catch (err) {
    console.error('Advisor render error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to render advisor preview image' });
    }
  }
});

// SPA fallback: serve index.html for non-API routes when frontend build exists
if (fs.existsSync(frontendDist)) {
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (isGeminiConfigured()) {
    console.log('GEMINI_API_KEY is set (advisor + furnishing preview enabled)');
  } else {
    console.log('GEMINI_API_KEY not set — set it in backend/.env or root .env to enable advisor and furnishing');
  }
  if (fs.existsSync(frontendDist)) {
    console.log(`Frontend served on same port. Open http://localhost:${PORT}`);
  }
});
