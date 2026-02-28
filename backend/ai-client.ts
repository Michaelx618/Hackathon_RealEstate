import OpenAI from 'openai';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_GEMINI_CHAT_MODEL = 'gemini-3.1-pro-preview';
/** Nano Banana Pro (Gemini 3 Pro Image) – best quality image generation/editing */
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3-pro-image-preview';
const FALLBACK_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_GEMINI_NATIVE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiInlineImage = {
  mimeType: string;
  dataBase64: string;
};

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
}

export function getGeminiClient(): OpenAI {
  return new OpenAI({
    apiKey: getGeminiApiKey(),
    baseURL: process.env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL,
  });
}

export function getGeminiChatModel(): string {
  return process.env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_GEMINI_CHAT_MODEL;
}

export function getGeminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
}

function parseDataUrl(value: string): GeminiInlineImage | null {
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return null;

  const header = value.slice(0, commaIndex);
  const payload = value.slice(commaIndex + 1);
  const mimeMatch = header.match(/^data:([^;,]+)(;base64)?/i);
  const mimeType = (mimeMatch?.[1] || 'image/jpeg').trim();
  const isBase64 = /;base64/i.test(header);

  try {
    const buffer = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return {
      mimeType,
      dataBase64: buffer.toString('base64'),
    };
  } catch {
    return null;
  }
}

async function fetchImageAsInline(url: string): Promise<GeminiInlineImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch reference image (HTTP ${response.status})`);
    }

    const mimeType = (response.headers.get('content-type') || 'image/jpeg')
      .split(';')[0]
      .trim();
    if (!mimeType.startsWith('image/')) {
      throw new Error(`Reference URL is not an image: ${url}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('Reference image is empty');
    }

    return {
      mimeType,
      dataBase64: buffer.toString('base64'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function toInlineImage(value: string): Promise<GeminiInlineImage | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    return parseDataUrl(trimmed);
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return await fetchImageAsInline(parsed.toString());
    }
  } catch {
    return null;
  }

  return null;
}

function makeHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function shouldFallbackToDefaultModel(error: unknown): boolean {
  const status = typeof error === 'object' && error && 'status' in error
    ? Number(error.status)
    : undefined;
  const message = error instanceof Error ? error.message : '';
  if (status === 404) return true;
  if (status === 400 && /not supported for generatecontent|not found/i.test(message)) return true;
  return false;
}

async function requestGeminiEditedImage(
  model: string,
  parts: Array<Record<string, unknown>>,
): Promise<string> {
  const endpointBase = process.env.GEMINI_NATIVE_BASE_URL?.trim() || DEFAULT_GEMINI_NATIVE_BASE_URL;
  const endpoint = `${endpointBase}/models/${encodeURIComponent(model)}:generateContent`;

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getGeminiApiKey(),
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let parsed: any = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const message = parsed?.error?.message
      || raw
      || `Gemini image request failed (HTTP ${response.status})`;
    throw makeHttpError(response.status, message);
  }

  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  for (const candidate of candidates) {
    const content = candidate?.content ?? candidate;
    const partsOut = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of partsOut) {
      const inline = part?.inlineData ?? part?.inline_data;
      let data = typeof inline?.data === 'string' ? inline.data : undefined;
      if (!data) continue;
      data = data.replace(/\s/g, '');
      if (data.length < 50 || !/^[A-Za-z0-9+/=]+$/.test(data)) continue;
      const mimeType = typeof inline?.mimeType === 'string'
        ? inline.mimeType
        : (typeof inline?.mime_type === 'string' ? inline.mime_type : 'image/png');
      return `data:${mimeType};base64,${data}`;
    }
  }

  // Fallback: search anywhere in the response for inline image data (handles alternate response shapes)
  const found = findInlineImageInObject(parsed);
  if (found) return found;

  const blockReason = parsed?.promptFeedback?.blockReason
    ?? parsed?.candidates?.[0]?.finishReason
    ?? parsed?.candidates?.[0]?.safetyRatings;
  const hint = blockReason
    ? ` (block/safety: ${JSON.stringify(blockReason)})`
    : ` (${candidates.length} candidate(s), no image part)`;
  throw new Error(`Gemini image response did not include image bytes${hint}`);
}

/** Recursively find the first inline image (data + mimeType) in a parsed API response. */
function findInlineImageInObject(obj: unknown, depth = 0): string | null {
  if (depth > 20) return null;
  if (obj === null || typeof obj !== 'object') return null;

  const o = obj as Record<string, unknown>;
  const rawData = typeof o.data === 'string' ? o.data : null;
  const mimeType = typeof o.mimeType === 'string' ? o.mimeType : (typeof o.mime_type === 'string' ? o.mime_type : null);
  if (rawData && rawData.length > 100) {
    const data = rawData.replace(/\s/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(data)) {
      const mime = mimeType?.startsWith('image/') ? mimeType : 'image/png';
      return `data:${mime};base64,${data}`;
    }
  }

  for (const key of Object.keys(o)) {
    const val = o[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findInlineImageInObject(item, depth + 1);
        if (found) return found;
      }
    } else if (val && typeof val === 'object') {
      const found = findInlineImageInObject(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export async function generateGeminiEditedImage(input: {
  prompt: string;
  baseImageDataUrl: string;
  referenceImageDataUrls?: string[];
  model?: string;
}): Promise<string> {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error('Missing image generation prompt');

  const model = input.model?.trim() || getGeminiImageModel();
  const baseImage = await toInlineImage(input.baseImageDataUrl);
  if (!baseImage) throw new Error('Missing or invalid base image for editing');

  const references = (input.referenceImageDataUrls || [])
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

  const referenceImages: GeminiInlineImage[] = [];
  for (const value of references) {
    const parsed = await toInlineImage(value);
    if (parsed) referenceImages.push(parsed);
  }

  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    {
      inline_data: {
        mime_type: baseImage.mimeType,
        data: baseImage.dataBase64,
      },
    },
  ];

  for (const image of referenceImages) {
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.dataBase64,
      },
    });
  }

  try {
    return await requestGeminiEditedImage(model, parts);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const noImageBytes = /did not include image bytes/i.test(message);
    if (noImageBytes && model !== FALLBACK_GEMINI_IMAGE_MODEL) {
      try {
        return await requestGeminiEditedImage(FALLBACK_GEMINI_IMAGE_MODEL, parts);
      } catch {
        throw error;
      }
    }
    if (model === DEFAULT_GEMINI_IMAGE_MODEL || !shouldFallbackToDefaultModel(error)) {
      throw error;
    }
    return await requestGeminiEditedImage(DEFAULT_GEMINI_IMAGE_MODEL, parts);
  }
}
