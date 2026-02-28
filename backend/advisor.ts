import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { Response } from 'express';
import pdfParse from 'pdf-parse';

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: key });
}

const SYSTEM_PROMPT = `You are a renovation, construction-cost, and rental-return advisor.

This platform is for house-type properties only (single-family house, townhouse, duplex, semi-detached, detached, rowhouse). Condo/apartment requests are out of scope and must be flagged.

The owner may provide:
- Property address/location (required; used for localized pricing assumptions)
- One or more current-state photos/floor plan images (required)
- One or more optional target-outcome reference images (what they want to build)
- A current-house status note (what condition/issues exist now)
- Optional supporting documents (land size, floor plans, PDFs, text notes)
- Optional numeric area fields

Primary benchmark inputs (public websites):
- Toronto renovation benchmarks: CAD $100-$300/sqft for broad remodel scopes; full-gut projects can reach CAD $200-$500/sqft. Source context: Route Homes + HomeStars.
- City of Toronto permit fee benchmark (effective Jan 1, 2026): residential alterations/additions CAD $13.41 per m2, minimum fee CAD $214.79.
- Toronto rent benchmarks: CAD $3.82/sqft (Urbanation, Q2 2025 adjusted average rent) and CAD $2,498/month market average rent (Rentals.ca, January 2026 rent report).
- Zoning reference map: https://map.toronto.ca/maps/map.jsp?app=ZBL_CONSULT

How to calculate:
1. Start from the provided address/location and explicitly use it to localize cost/rent assumptions.
2. Use the current image to estimate rough interior size in sqft.
3. Cross-check that estimate against document data; if docs are missing, say uncertainty is higher.
4. Compare current image vs target image (if provided) to infer renovation scope level and complexity.
5. Provide construction cost and total out-of-pocket ranges in CAD.
6. Include permit + soft costs in out-of-pocket. Reasonable soft-cost assumptions are acceptable when exact values are unknown.
7. Estimate rental return from market benchmarks and the matched rentable area.
8. State assumptions clearly and keep math internally consistent.
9. If the location is outside Toronto, explicitly state what adjustment/proxy logic you applied and recommend local quote validation.

The first reply MUST include these exact bold labels on separate lines (in this order):
**Potential score:** [number from 0 to 100]/100 — one line only; rate investment/renovation potential based on layout, location, rental upside, and scope.
**Estimated renovation timeline:** [e.g. 3–6 months or 6–12 months] — total duration from start to move-in ready.
**Estimated current size from image:** [value]
**Documented size:** [value or "Not provided"]
**Matched size used for estimate:** [value]
**Construction cost:** [CAD range + short basis]
**Permit & soft costs:** [CAD range + short basis]
**Total out-of-pocket:** [CAD range]
**Estimated monthly rent:** [CAD range]
**Estimated annual gross rent:** [CAD range]
**Simple payback:** [years range]

Then include **Key factors:** on its own line, followed by 4–8 bullet points (each line starting with - ) that summarize: condition/layout strengths or issues, location upside, rental potential, main renovation drivers, and biggest risks or unknowns.

After that, include these sections:
1. **Renovation plan (phases):**
   **Phase 1:** ...
   **Phase 2:** ...
   **Phase 3:** ...
   **Phase 4:** ... (optional)
2. **Current vs target scope:** what exists now vs desired outcome and key work items.
3. **Legal & zoning checks:** mention zoning and permit checks tied to location, and include the Toronto zoning map link when Toronto is mentioned.
4. **Assumptions + confidence:** list the biggest assumptions and confidence level.
5. **Next data to improve accuracy:** what docs/measurements/quotes to collect next.

Always include this sentence exactly once: "This is not legal, engineering, or financial advice; confirm with licensed local professionals."`;

type Message = { role: 'user' | 'assistant'; content: string };

export type AdvisorDocumentInput = {
  name: string;
  mimeType: string;
  dataUrl?: string;
  textContent?: string;
};

export type AdvisorSessionInput = {
  currentImage: string;
  currentImages?: string[];
  targetImage?: string;
  targetImages?: string[];
  firstMessage?: string;
  currentHouseStatus?: string;
  propertyType?: string;
  location?: string;
  documentNotes?: string;
  supportingDocs?: AdvisorDocumentInput[];
  landAreaSqft?: number;
  interiorAreaSqft?: number;
  desiredRentableSqft?: number;
  renovationLevel?: string;
};

type Session = {
  messages: Message[];
  context: AdvisorSessionInput;
  firstUserMultimodal?: OpenAI.Chat.Completions.ChatCompletionContentPart[];
};

type PreparedDocuments = {
  textBlocks: string[];
  imageDataUrls: string[];
  notes: string[];
};

const sessions = new Map<string, Session>();
const MAX_DOCS = 8;
const MAX_DOC_IMAGE_COUNT = 4;
const MAX_TEXT_CHARS_PER_DOC = 7000;
const MAX_CURRENT_IMAGES_IN_PROMPT = 6;
const MAX_TARGET_IMAGES_IN_PROMPT = 6;

function normalizeImageUrl(image: string): string {
  if (image.startsWith('data:')) return image;
  return `data:image/jpeg;base64,${image}`;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\u0000/g, '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}...`;
}

function decodeDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const mimeMatch = header.match(/^data:([^;,]+)(;base64)?/i);
  const mimeType = mimeMatch?.[1] || 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);
  try {
    const buffer = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

async function prepareSupportingDocuments(docs: AdvisorDocumentInput[] | undefined): Promise<PreparedDocuments> {
  const textBlocks: string[] = [];
  const imageDataUrls: string[] = [];
  const notes: string[] = [];

  for (const rawDoc of (docs || []).slice(0, MAX_DOCS)) {
    const name = rawDoc.name?.trim() || 'Untitled document';
    const mimeType = rawDoc.mimeType?.trim() || 'application/octet-stream';

    if (mimeType.startsWith('image/') && rawDoc.dataUrl && imageDataUrls.length < MAX_DOC_IMAGE_COUNT) {
      imageDataUrls.push(normalizeImageUrl(rawDoc.dataUrl));
      notes.push(`Included image document: ${name}.`);
      continue;
    }

    if (rawDoc.textContent?.trim()) {
      textBlocks.push(`Document "${name}" (${mimeType}):\n${truncate(rawDoc.textContent, MAX_TEXT_CHARS_PER_DOC)}`);
      continue;
    }

    if (mimeType === 'application/pdf' && rawDoc.dataUrl) {
      const decoded = decodeDataUrl(rawDoc.dataUrl);
      if (!decoded) {
        notes.push(`Could not decode PDF: ${name}.`);
        continue;
      }
      try {
        const parsed = await pdfParse(decoded.buffer);
        const pdfText = parsed.text?.trim();
        if (pdfText) {
          textBlocks.push(`Document "${name}" (PDF extract):\n${truncate(pdfText, MAX_TEXT_CHARS_PER_DOC)}`);
        } else {
          notes.push(`PDF had no extractable text: ${name}.`);
        }
      } catch {
        notes.push(`Could not parse PDF text: ${name}.`);
      }
      continue;
    }

    if (rawDoc.dataUrl && (mimeType.startsWith('text/') || mimeType === 'application/json')) {
      const decoded = decodeDataUrl(rawDoc.dataUrl);
      if (decoded) {
        textBlocks.push(`Document "${name}" (${mimeType}):\n${truncate(decoded.buffer.toString('utf8'), MAX_TEXT_CHARS_PER_DOC)}`);
      } else {
        notes.push(`Could not decode text document: ${name}.`);
      }
      continue;
    }

    notes.push(`Unsupported document type (${mimeType}) for ${name}.`);
  }

  return { textBlocks, imageDataUrls, notes };
}

function buildContextText(context: AdvisorSessionInput, firstMessage?: string): string {
  const lines: string[] = [
    'Use the attached images/documents to estimate construction cost, total out-of-pocket cash, and rental return.',
  ];

  if (context.location?.trim()) lines.push(`Location: ${context.location.trim()}.`);
  if (context.propertyType?.trim()) lines.push(`Property type: ${context.propertyType.trim()}.`);
  if (context.currentHouseStatus?.trim()) lines.push(`Current house status from owner: ${context.currentHouseStatus.trim()}`);
  if (context.renovationLevel?.trim()) lines.push(`Renovation level preference: ${context.renovationLevel.trim()}.`);
  if (typeof context.landAreaSqft === 'number') lines.push(`Land size from owner/docs: ${context.landAreaSqft.toLocaleString()} sqft.`);
  if (typeof context.interiorAreaSqft === 'number') lines.push(`Interior size from owner/docs: ${context.interiorAreaSqft.toLocaleString()} sqft.`);
  if (typeof context.desiredRentableSqft === 'number') lines.push(`Desired rentable area target: ${context.desiredRentableSqft.toLocaleString()} sqft.`);
  if (context.documentNotes?.trim()) lines.push(`Owner document notes: ${context.documentNotes.trim()}`);

  const goal = firstMessage?.trim()
    || context.firstMessage?.trim()
    || 'I want to estimate construction cost, total out-of-pocket, and rental return for my renovation/conversion.';
  lines.push(`Owner goal: ${goal}`);

  return lines.join('\n');
}

async function buildInitialUserContent(
  context: AdvisorSessionInput,
  firstMessage?: string,
): Promise<{ parts: OpenAI.Chat.Completions.ChatCompletionContentPart[]; summaryText: string }> {
  const docs = await prepareSupportingDocuments(context.supportingDocs);

  const contextSections: string[] = [
    buildContextText(context, firstMessage),
    'Image order: all current-state images first, then all target-outcome images.',
  ];

  const currentImages = (context.currentImages?.length ? context.currentImages : [context.currentImage]).slice(0, MAX_CURRENT_IMAGES_IN_PROMPT);
  const targetImages = (context.targetImages?.length
    ? context.targetImages
    : (context.targetImage ? [context.targetImage] : [])
  ).slice(0, MAX_TARGET_IMAGES_IN_PROMPT);

  contextSections.push(`Current-state image count: ${currentImages.length}.`);
  contextSections.push(`Target-outcome image count: ${targetImages.length}.`);

  if (docs.textBlocks.length > 0) {
    contextSections.push(`Supporting document excerpts:\n${docs.textBlocks.join('\n\n')}`);
  }
  if (docs.notes.length > 0) {
    contextSections.push(`Document parsing notes:\n${docs.notes.map((n) => `- ${n}`).join('\n')}`);
  }

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: contextSections.join('\n\n') },
  ];

  for (const image of currentImages) {
    parts.push({ type: 'image_url', image_url: { url: normalizeImageUrl(image) } });
  }

  for (const image of targetImages) {
    parts.push({ type: 'image_url', image_url: { url: normalizeImageUrl(image) } });
  }

  for (const docImageUrl of docs.imageDataUrls) {
    parts.push({ type: 'image_url', image_url: { url: docImageUrl } });
  }

  const summaryLines: string[] = [];
  if (context.location?.trim()) summaryLines.push(`Location: ${context.location.trim()}`);
  if (context.propertyType?.trim()) summaryLines.push(`Property: ${context.propertyType.trim()}`);
  if (context.currentHouseStatus?.trim()) summaryLines.push(`Current status noted`);
  summaryLines.push(`Current images: ${currentImages.length}`);
  summaryLines.push(`Target images: ${targetImages.length}`);
  if (typeof context.interiorAreaSqft === 'number') summaryLines.push(`Documented interior: ${context.interiorAreaSqft.toLocaleString()} sqft`);
  if (typeof context.landAreaSqft === 'number') summaryLines.push(`Land: ${context.landAreaSqft.toLocaleString()} sqft`);
  if (typeof context.desiredRentableSqft === 'number') summaryLines.push(`Target rentable: ${context.desiredRentableSqft.toLocaleString()} sqft`);
  if (context.renovationLevel?.trim()) summaryLines.push(`Renovation level: ${context.renovationLevel.trim()}`);
  const goal = firstMessage?.trim() || context.firstMessage?.trim();
  if (goal) summaryLines.push(`Goal: ${goal}`);
  if (docs.textBlocks.length || docs.imageDataUrls.length) {
    summaryLines.push(`Supporting docs: ${docs.textBlocks.length} text extract(s), ${docs.imageDataUrls.length} image(s)`);
  }

  return {
    parts,
    summaryText: summaryLines.join(' | ') || 'Owner uploaded project context and asked for full cost + return estimate.',
  };
}

function sessionToMessages(session: Session): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  let firstUserSeen = false;

  for (const message of session.messages) {
    if (message.role === 'user') {
      if (!firstUserSeen && session.firstUserMultimodal) {
        out.push({
          role: 'user',
          content: session.firstUserMultimodal,
        });
      } else {
        out.push({ role: 'user', content: message.content });
      }
      firstUserSeen = true;
    } else {
      out.push({ role: 'assistant', content: message.content });
    }
  }

  return out;
}

export function createSession(input: AdvisorSessionInput): string {
  const sessionId = randomUUID();
  const safeDocs = (input.supportingDocs || []).slice(0, MAX_DOCS).map((doc) => ({
    name: doc.name?.trim() || 'Untitled document',
    mimeType: doc.mimeType?.trim() || 'application/octet-stream',
    dataUrl: doc.dataUrl,
    textContent: doc.textContent,
  }));

  sessions.set(sessionId, {
    messages: [],
    context: {
      ...input,
      currentImage: input.currentImage,
      currentImages: (input.currentImages?.length ? input.currentImages : [input.currentImage]).slice(0, MAX_CURRENT_IMAGES_IN_PROMPT),
      targetImage: input.targetImage,
      targetImages: (input.targetImages?.length
        ? input.targetImages
        : (input.targetImage ? [input.targetImage] : [])
      ).slice(0, MAX_TARGET_IMAGES_IN_PROMPT),
      firstMessage: input.firstMessage,
      currentHouseStatus: input.currentHouseStatus,
      propertyType: input.propertyType,
      location: input.location?.trim() || undefined,
      documentNotes: input.documentNotes,
      supportingDocs: safeDocs,
      landAreaSqft: input.landAreaSqft,
      interiorAreaSqft: input.interiorAreaSqft,
      desiredRentableSqft: input.desiredRentableSqft,
      renovationLevel: input.renovationLevel,
    },
  });

  return sessionId;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push({ role, content });
}

export async function streamFirstReply(
  sessionId: string,
  firstMessage: string | undefined,
  res: Response,
): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const built = await buildInitialUserContent(session.context, firstMessage);
  session.firstUserMultimodal = built.parts;
  session.messages.push({ role: 'user', content: built.summaryText });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Session-Id', sessionId);

  const stream = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: built.parts },
    ],
    stream: true,
    max_tokens: 1800,
  });

  let fullContent = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullContent += delta;
      res.write(delta);
    }
  }
  res.end();

  session.messages.push({ role: 'assistant', content: fullContent });
  return fullContent;
}

export async function streamChatReply(sessionId: string, userMessage: string, res: Response): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  session.messages.push({ role: 'user', content: userMessage });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...sessionToMessages(session),
  ];

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const stream = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    max_tokens: 1400,
  });

  let fullContent = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullContent += delta;
      res.write(delta);
    }
  }
  res.end();

  session.messages.push({ role: 'assistant', content: fullContent });
}
