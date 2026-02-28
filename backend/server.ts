import './load-env';
import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  createSession,
  getSession,
  streamFirstReply,
  streamChatReply,
} from './advisor.js';
import type { AdvisorDocumentInput, AdvisorSessionInput } from './advisor.js';
import { buildFurnishingPreview } from './furnishing.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '35mb' }));

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
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'Furnishing preview is not configured (missing OPENAI_API_KEY)' });
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

    const productLinks = sanitizeUrlArray(body.productLinks);
    const requestText = optionalString(body.requestText)
      || optionalString(body.description)
      || optionalString(body.prompt);

    const result = await buildFurnishingPreview({
      roomImage,
      requestText,
      productLinks,
      currencyPreference: optionalString(body.currency),
    });

    res.json(result);
  } catch (err) {
    console.error('Furnishing preview error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate furnishing preview' });
    }
  }
});

app.post('/api/advisor/session', async (req: Request, res: Response) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'Advisor is not configured (missing OPENAI_API_KEY)' });
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
      location: optionalString(body.location),
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
