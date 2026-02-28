import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { Response } from 'express';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a renovation and rental repurposing advisor. The user has shared a floor plan image. Use it to give specific, practical advice.

When you see the layout image (and in follow-up replies), cover:
- **Renovation:** What to change (kitchen, bath, layout), in what order, and why.
- **Repurposing for tenants:** Which rooms or areas could become a separate unit, ADU potential, layout changes for rentability. Mention that they should confirm zoning and local rules.
- **Price/cost:** Ballpark ranges for the renovations you suggest (e.g. "typical kitchen refresh $X–Y"), with a clear caveat that these are estimates and they should get local quotes.
- **Design:** Flow, finishes, and layout tips that fit their goal (e.g. durable finishes if renting out).

Be conversational, clear, and responsive to follow-up questions. If something is outside your expertise (e.g. structural or legal), say so and suggest they consult a professional.`;

type Message = { role: 'user' | 'assistant'; content: string };
type Session = { messages: Message[]; imageBase64: string | null };

const sessions = new Map<string, Session>();

function normalizeImageUrl(image: string): string {
  if (image.startsWith('data:')) return image;
  return `data:image/jpeg;base64,${image}`;
}

function buildUserContentWithImage(imageBase64: string, text?: string): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'image_url',
      image_url: { url: normalizeImageUrl(imageBase64) },
    },
  ];
  if (text?.trim()) {
    parts.push({ type: 'text', text: text.trim() });
  } else {
    parts.push({ type: 'text', text: "Here's my floor plan. Please analyze it and suggest renovations, how to repurpose for tenants, ballpark costs, and design tips." });
  }
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

export function createSession(imageBase64: string, firstMessage?: string): string {
  const sessionId = randomUUID();
  const userText = firstMessage?.trim() || "Here's my floor plan. Please analyze it and suggest renovations, how to repurpose for tenants, ballpark costs, and design tips.";
  sessions.set(sessionId, {
    messages: [],
    imageBase64,
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
  res: Response
): Promise<string> {
  const session = sessions.get(sessionId)!;
  const userContent = buildUserContentWithImage(imageBase64, firstMessage);
  session.messages.push({ role: 'user', content: firstMessage?.trim() || "Here's my floor plan. Please analyze it and suggest renovations, how to repurpose for tenants, ballpark costs, and design tips." });

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
