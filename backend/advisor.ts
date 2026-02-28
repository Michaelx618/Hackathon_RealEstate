import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { Response } from 'express';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a design and renovation advisor focused on helping people convert or renovate their property. Many users want to convert a house to Airbnb/short-term rental, add a suite or in-law unit, or turn one property into multiple rental units. The user has shared a floor plan image. Give specific, practical advice tailored to their property type and goal.

Structure your first reply as follows:

1. **Renovation plan (phases):** Start with a clear phased plan the user can follow. Use exactly this format so it can be shown as a timeline:
   **Phase 1:** [One short line: e.g. "Permits & planning" or "Foundation work"]
   **Phase 2:** [One short line: e.g. "Kitchen and bath updates"]
   **Phase 3:** [One short line: e.g. "Layout and finishes"]
   **Phase 4:** [One short line if needed: e.g. "Furnishing for rental"]
   Use 3–4 phases. Each phase line should be one brief phrase or sentence. Then continue with full detail below.

2. **Design & renovation:** What to change (kitchen, bath, layout, walls), in what order, and why. Adapt to their goal (e.g. Airbnb vs long-term tenant, adding a suite vs full conversion). Consider property type (condo vs single-family, HOA rules).
3. **Conversions (Airbnb, suites, multi-unit):** Which rooms or areas could become a separate unit, suite, or listing; ADU potential; layout changes for short-term or long-term rentability. Mention that they must confirm zoning and local rules (e.g. short-term rental regulations).
4. **Legal & permits:** If the user gave a location, mention how permits and zoning often work there. Briefly note what usually requires permits (structural, electrical, plumbing, adding units). Always add: "This is not legal advice; confirm with your local permitting office or a lawyer."
5. **Cost:** Give ballpark ranges. Use this format when summarizing: "**Estimated cost:** $X,000–$Y,000 for [scope]" so the user can quickly see numbers. Add that these are estimates and they should get local quotes.
6. **Design:** Flow, finishes, and layout tips that fit their goal (e.g. durable finishes if renting out).

Be conversational, clear, and responsive to follow-up questions. If something is outside your expertise (e.g. structural or legal), say so and suggest they consult a professional.`;

type Message = { role: 'user' | 'assistant'; content: string };
type Session = { messages: Message[]; imageBase64: string | null; propertyType?: string; location?: string };

const sessions = new Map<string, Session>();

function normalizeImageUrl(image: string): string {
  if (image.startsWith('data:')) return image;
  return `data:image/jpeg;base64,${image}`;
}

function buildUserContentWithImage(imageBase64: string, text?: string, propertyType?: string, location?: string): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'image_url',
      image_url: { url: normalizeImageUrl(imageBase64) },
    },
  ];
  const prefixParts: string[] = [];
  if (location?.trim()) prefixParts.push(`Location: ${location.trim()}.`);
  if (propertyType) prefixParts.push(`This is a ${propertyType}.`);
  const prefix = prefixParts.length ? prefixParts.join(' ') + ' ' : '';
  const defaultText = "Here's my floor plan. Please analyze it and suggest renovations, how to repurpose for tenants, ballpark costs, permits to consider, and design tips. Tailor permits, zoning, and cost ballparks to my location when possible.";
  const fullText = text?.trim() ? `${prefix}${text.trim()}` : `${prefix}${defaultText}`;
  parts.push({ type: 'text', text: fullText });
  return parts;
}

function sessionToMessages(session: Session): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const firstUser = session.messages.find((m) => m.role === 'user');
  const hasImage = session.imageBase64 && firstUser;
  for (let i = 0; i < session.messages.length; i++) {
    const m = session.messages[i];
    if (m.role === 'user') {
      if (hasImage && i === 0) {
        out.push({
          role: 'user',
          content: buildUserContentWithImage(session.imageBase64!, m.content || undefined),
        });
      } else {
        out.push({ role: 'user', content: m.content });
      }
    } else {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

export function createSession(imageBase64: string, firstMessage?: string, propertyType?: string, location?: string): string {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    messages: [],
    imageBase64,
    propertyType: propertyType || undefined,
    location: location?.trim() || undefined,
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
  imageBase64: string,
  firstMessage: string | undefined,
  res: Response,
  propertyType?: string,
  location?: string
): Promise<string> {
  const session = sessions.get(sessionId)!;
  const prefixParts: string[] = [];
  if (location?.trim()) prefixParts.push(`Location: ${location.trim()}.`);
  if (propertyType) prefixParts.push(`This is a ${propertyType}.`);
  const prefix = prefixParts.length ? prefixParts.join(' ') + ' ' : '';
  const userText = firstMessage?.trim() || "Here's my floor plan. Please analyze it and suggest renovations, how to repurpose for tenants, ballpark costs, permits to consider, and design tips. Tailor advice to my location when possible.";
  session.messages.push({ role: 'user', content: `${prefix}${userText}` });
  const userContent = buildUserContentWithImage(imageBase64, firstMessage || undefined, propertyType, location);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Session-Id', sessionId);

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    stream: true,
    max_tokens: 1500,
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

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    max_tokens: 1500,
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
