import OpenAI, { toFile } from 'openai';
import {
  getGeminiChatModel,
  getGeminiClient,
  getGeminiImageModel,
} from './ai-client.js';

const MAX_PRODUCT_LINKS = 8;
const MAX_REFERENCES_FOR_IMAGE_EDIT = 4;
const MAX_ITEMS = 20;

const FURNISHING_PLAN_PROMPT = `You are an interior staging + furniture procurement assistant.

You receive:
- A room/unit image.
- User request text (desired furniture/appliances style and use).
- Optional parsed product-link data (title, price, currency, dimensions, image URL, description).

Output must be valid JSON only (no markdown, no prose outside JSON) with this exact schema:
{
  "designPrompt": string,
  "summary": string,
  "assumptions": string[],
  "items": [
    {
      "name": string,
      "category": string,
      "quantity": number,
      "unitPrice": number | null,
      "currency": string,
      "dimensions": string,
      "source": "link" | "description",
      "link": string,
      "notes": string,
      "estimatedPrice": boolean
    }
  ]
}

Rules:
- Keep item list practical for a single room/unit setup.
- Prefer product-link prices when provided.
- When the user has supplied parsed product-link data (e.g. IKEA or other store URLs), you MUST match each such product to an item: set "source" to "link" and set "link" to the exact product URL from the parsed list (the numbered link, e.g. "1. https://..."). This ensures the SOURCE column shows a clickable product link.
- For items that do not come from any supplied link, set "source" to "description" and "link" to "".
- If a needed item has no known price, estimate a realistic mid-market price and set estimatedPrice=true.
- Quantity must be positive integers.
- designPrompt must explicitly ask to preserve room geometry/perspective and place requested items in realistic scale.
- Include furniture and appliances if user asked for them.
- Keep assumptions short and concrete.`;

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const raw = value.replace(/,/g, '').trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function truncate(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function normalizeImageDataUrl(value: string): string {
  if (value.startsWith('data:')) return value;
  return `data:image/jpeg;base64,${value}`;
}

function decodeDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;

  const header = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const match = header.match(/^data:([^;,]+)(;base64)?/i);
  const mimeType = match?.[1] || 'application/octet-stream';
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

async function toImageFileFromDataUrl(dataUrl: string, name: string): Promise<File> {
  const normalized = normalizeImageDataUrl(dataUrl);
  const decoded = decodeDataUrl(normalized);
  if (!decoded) throw new Error('Invalid image payload');
  return toFile(decoded.buffer, name, { type: decoded.mimeType });
}

function extractTagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(tag)) !== null) {
    const key = match[1]?.toLowerCase();
    const value = decodeHtmlEntities((match[2] ?? match[3] ?? match[4] ?? '').trim());
    if (key && value) out[key] = value;
  }

  return out;
}

function extractMetaValues(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const attrs = extractTagAttributes(tag);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    const value = attrs.content || attrs.value || '';
    if (!key || !value) continue;
    if (!out[key]) out[key] = [];
    out[key].push(value);
  }

  return out;
}

function firstMeta(meta: Record<string, string[]>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = meta[key.toLowerCase()]?.[0];
    if (candidate?.trim()) return candidate.trim();
  }
  return undefined;
}

function extractTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  const plain = decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim());
  return plain || undefined;
}

function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      const cleaned = raw
        .replace(/^<!--/, '')
        .replace(/-->$/, '')
        .trim();
      try {
        out.push(JSON.parse(cleaned));
      } catch {
        continue;
      }
    }
  }

  return out;
}

function hasProductType(value: unknown): boolean {
  if (typeof value === 'string') return /product/i.test(value);
  if (Array.isArray(value)) return value.some((entry) => hasProductType(entry));
  return false;
}

function collectProductNodes(node: unknown, out: Record<string, unknown>[], seen: Set<unknown>): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectProductNodes(item, out, seen);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (hasProductType(obj['@type'])) {
    out.push(obj);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') collectProductNodes(value, out, seen);
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function detectCurrency(raw?: string): string | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (upper.includes('CAD') || upper.includes('C$')) return 'CAD';
  if (upper.includes('USD') || upper.includes('US$')) return 'USD';
  if (upper.includes('EUR') || upper.includes('€')) return 'EUR';
  if (upper.includes('GBP') || upper.includes('£')) return 'GBP';
  return undefined;
}

function parsePrice(raw?: string): number | undefined {
  if (!raw) return undefined;

  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/,/g, '');

  const direct = Number(cleaned);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 100) / 100;

  const match = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match?.[1]) return undefined;

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 100) / 100;
}

function extractPriceAndCurrency(raw?: string): { price?: number; currency?: string } {
  if (!raw) return {};
  const currency = detectCurrency(raw);
  const hasPriceCue = /(?:\$|€|£|\b(?:usd|cad|eur|gbp)\b|\bprice\b)/i.test(raw);
  return {
    price: hasPriceCue ? parsePrice(raw) : undefined,
    currency,
  };
}

function makeAbsoluteUrl(base: string, maybeRelative: string | undefined): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return undefined;
  }
}

function extractDimensions(text?: string): string | undefined {
  if (!text) return undefined;
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;

  const directMatch = compact.match(/\b\d+(?:\.\d+)?\s?(?:cm|mm|m|in|inch|inches|ft|")\s?[xX×]\s?\d+(?:\.\d+)?\s?(?:cm|mm|m|in|inch|inches|ft|")\s?(?:[xX×]\s?\d+(?:\.\d+)?\s?(?:cm|mm|m|in|inch|inches|ft|"))?/i);
  if (directMatch?.[0]) return directMatch[0];

  const keywordMatch = compact.match(/(dimensions?|size)[:\s-]{1,3}([^.;|]+)/i);
  if (keywordMatch?.[2]) return truncate(keywordMatch[2], 90);

  return undefined;
}

function pickProductImage(value: unknown, baseUrl: string): string | undefined {
  if (typeof value === 'string') return makeAbsoluteUrl(baseUrl, value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = pickProductImage(entry, baseUrl);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  return makeAbsoluteUrl(baseUrl, asString(obj.url) || asString(obj['@id']) || asString(obj.contentUrl));
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HomeKeyBot/1.0)',
        Accept: 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export type ProductLinkSnapshot = {
  link: string;
  title?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  dimensions?: string;
  description?: string;
  status: 'ok' | 'error';
  error?: string;
};

async function scrapeProductLink(rawLink: string): Promise<ProductLinkSnapshot> {
  const link = optionalString(rawLink);
  if (!link) {
    return { link: rawLink, status: 'error', error: 'Empty link' };
  }

  let normalized: string;
  try {
    normalized = new URL(link).toString();
  } catch {
    return { link, status: 'error', error: 'Invalid URL' };
  }

  try {
    const response = await fetchWithTimeout(normalized);
    if (!response.ok) {
      return {
        link: normalized,
        status: 'error',
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (contentType.startsWith('image/')) {
      return {
        link: normalized,
        status: 'ok',
        title: normalized.split('/').filter(Boolean).pop() || 'Product image',
        imageUrl: normalized,
      };
    }

    const html = await response.text();
    const meta = extractMetaValues(html);
    const title = firstMeta(meta, ['og:title', 'twitter:title']) || extractTitleTag(html);
    const description = firstMeta(meta, ['description', 'og:description', 'twitter:description']);

    const metaImage = firstMeta(meta, ['og:image', 'twitter:image', 'product:image']);
    const metaPriceRaw = firstMeta(meta, [
      'product:price:amount',
      'og:price:amount',
      'price',
      'twitter:data1',
      'product:price',
    ]);
    const metaCurrencyRaw = firstMeta(meta, [
      'product:price:currency',
      'og:price:currency',
      'price:currency',
    ]);

    let price = parsePrice(metaPriceRaw);
    let currency = detectCurrency(metaCurrencyRaw) || detectCurrency(metaPriceRaw);
    let imageUrl = makeAbsoluteUrl(normalized, metaImage);
    let dimensions = extractDimensions(firstMeta(meta, ['product:dimensions', 'dimensions', 'size']));

    const productNodes: Record<string, unknown>[] = [];
    for (const block of extractJsonLdBlocks(html)) {
      collectProductNodes(block, productNodes, new Set<unknown>());
    }

    for (const product of productNodes) {
      const offers = product.offers;
      const firstOffer = Array.isArray(offers)
        ? offers.find((offer) => offer && typeof offer === 'object') as Record<string, unknown> | undefined
        : (offers && typeof offers === 'object' ? offers as Record<string, unknown> : undefined);

      const ldPrice = parsePrice(
        asString(firstOffer?.price)
        || asString((firstOffer as Record<string, unknown> | undefined)?.lowPrice)
        || asString((firstOffer as Record<string, unknown> | undefined)?.highPrice),
      );

      const ldCurrency = detectCurrency(
        asString(firstOffer?.priceCurrency)
        || asString((firstOffer as Record<string, unknown> | undefined)?.priceCurrency),
      );

      if (!price && ldPrice) price = ldPrice;
      if (!currency && ldCurrency) currency = ldCurrency;
      if (!imageUrl) {
        const image = pickProductImage(product.image, normalized);
        if (image) imageUrl = image;
      }
      if (!dimensions) {
        dimensions = extractDimensions(
          [
            asString(product.dimensions),
            asString(product.size),
            asString(product.width),
            asString(product.height),
            asString(product.depth),
            asString(product.description),
          ].filter(Boolean).join(' ; '),
        );
      }
    }

    if (!price) {
      const fallbackText = `${title || ''} ${description || ''}`;
      const found = extractPriceAndCurrency(fallbackText);
      if (found.price) price = found.price;
      if (!currency && found.currency) currency = found.currency;
    }

    return {
      link: normalized,
      title: title ? truncate(title, 140) : undefined,
      description: description ? truncate(description, 260) : undefined,
      price,
      currency,
      imageUrl,
      dimensions,
      status: 'ok',
    };
  } catch (error) {
    return {
      link: normalized,
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to fetch product link',
    };
  }
}

type PlannerItem = {
  name: string;
  category?: string;
  quantity: number;
  unitPrice?: number;
  currency?: string;
  dimensions?: string;
  source: 'link' | 'description';
  link?: string;
  notes?: string;
  estimatedPrice: boolean;
};

type PlannerOutput = {
  designPrompt: string;
  summary: string;
  assumptions: string[];
  items: PlannerItem[];
};

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // continue to fallback parse
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const snippet = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(snippet);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function parsePlannerItems(raw: unknown): PlannerItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannerItem[] = [];

  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = optionalString(item.name);
    if (!name) continue;

    const quantityRaw = optionalNumber(item.quantity);
    const quantity = Math.max(1, Math.min(20, Math.round(quantityRaw || 1)));
    const unitPrice = optionalNumber(item.unitPrice);
    const currency = optionalString(item.currency)?.toUpperCase();
    const source = optionalString(item.source) === 'link' ? 'link' : 'description';

    out.push({
      name,
      category: optionalString(item.category),
      quantity,
      unitPrice: unitPrice && unitPrice > 0 ? Math.round(unitPrice * 100) / 100 : undefined,
      currency,
      dimensions: optionalString(item.dimensions),
      source,
      link: optionalString(item.link),
      notes: optionalString(item.notes),
      estimatedPrice: Boolean(item.estimatedPrice),
    });
  }

  return out;
}

async function buildPlannerOutput(
  roomImage: string,
  requestText: string | undefined,
  productSnapshots: ProductLinkSnapshot[],
  currencyPreference?: string,
): Promise<PlannerOutput> {
  const productSummary = productSnapshots.length
    ? productSnapshots.map((item, index) => {
      const parts = [
        `${index + 1}. ${item.link}`,
        item.title ? `title=${item.title}` : undefined,
        typeof item.price === 'number' ? `price=${item.price}` : undefined,
        item.currency ? `currency=${item.currency}` : undefined,
        item.dimensions ? `dimensions=${item.dimensions}` : undefined,
        item.description ? `description=${truncate(item.description, 140)}` : undefined,
        item.status === 'error' ? `status=error (${item.error})` : 'status=ok',
      ].filter(Boolean);
      return parts.join(' | ');
    }).join('\n')
    : 'No product links supplied.';

  const promptText = [
    `User request: ${requestText || 'User wants staged furniture/appliances in this room.'}`,
    `Preferred currency: ${currencyPreference || 'CAD'}`,
    'Parsed product-link data:',
    productSummary,
    'Return JSON only.',
  ].join('\n\n');

  const completion = await getGeminiClient().chat.completions.create({
    model: getGeminiChatModel(),
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 1300,
    messages: [
      { role: 'system', content: FURNISHING_PLAN_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: normalizeImageDataUrl(roomImage) } },
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const parsed = extractJsonObject(raw);

  const designPrompt = optionalString(parsed.designPrompt)
    || 'Preserve the exact room geometry and camera angle. Add realistic furniture and appliances based on the request, with natural proportions and lighting.';

  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions
      .map((value) => optionalString(value))
      .filter((value): value is string => Boolean(value))
      .slice(0, 10)
    : [];

  return {
    designPrompt,
    summary: optionalString(parsed.summary) || 'Staged preview and shopping list generated from room photo + request.',
    assumptions,
    items: parsePlannerItems(parsed.items),
  };
}

async function fetchImageAsFile(url: string, fileNamePrefix: string): Promise<{ file?: File; error?: string }> {
  try {
    const response = await fetchWithTimeout(url, 12000);
    if (!response.ok) {
      return { error: `Image fetch failed (${response.status}) for ${url}` };
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return { error: `URL is not an image: ${url}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) {
      return { error: `Image too large for ${url}` };
    }

    const extension = contentType.split('/')[1] || 'jpg';
    const file = await toFile(buffer, `${fileNamePrefix}.${extension}`, { type: contentType });
    return { file };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `Failed to fetch image ${url}` };
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type FurnishingPreviewInput = {
  roomImage: string;
  requestText?: string;
  productLinks?: string[];
  currencyPreference?: string;
};

export type FurnishingLineItem = {
  name: string;
  category?: string;
  quantity: number;
  unitPrice: number | null;
  subtotal: number | null;
  currency: string;
  dimensions?: string;
  source: 'link' | 'description';
  link?: string;
  notes?: string;
  estimatedPrice: boolean;
};

export type FurnishingPreviewResult = {
  previewImageDataUrl?: string;
  stagingPrompt: string;
  summary: string;
  assumptions: string[];
  items: FurnishingLineItem[];
  totalPrice: number;
  currency: string;
  missingPriceCount: number;
  sourceProducts: ProductLinkSnapshot[];
  notes: string[];
};

function mergePlannerItemsWithSnapshots(
  plannerItems: PlannerItem[],
  snapshots: ProductLinkSnapshot[],
  currencyPreference?: string,
): FurnishingLineItem[] {
  const snapshotByUrl = new Map<string, ProductLinkSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.status !== 'ok') continue;
    snapshotByUrl.set(normalizeComparableUrl(snapshot.link), snapshot);
  }

  const usedSnapshotKeys = new Set<string>();
  const merged: FurnishingLineItem[] = [];

  for (const item of plannerItems.slice(0, MAX_ITEMS)) {
    const normalizedLink = item.link ? normalizeComparableUrl(item.link) : undefined;
    const linkedSnapshot = normalizedLink ? snapshotByUrl.get(normalizedLink) : undefined;

    if (linkedSnapshot && normalizedLink) {
      usedSnapshotKeys.add(normalizedLink);
    }

    const unitPrice =
      item.unitPrice
      || linkedSnapshot?.price
      || null;

    const currency =
      item.currency
      || linkedSnapshot?.currency
      || currencyPreference
      || 'CAD';

    merged.push({
      name: item.name || linkedSnapshot?.title || 'Furniture item',
      category: item.category,
      quantity: item.quantity,
      unitPrice,
      subtotal: unitPrice ? roundMoney(unitPrice * item.quantity) : null,
      currency: currency.toUpperCase(),
      dimensions: item.dimensions || linkedSnapshot?.dimensions,
      source: linkedSnapshot ? 'link' : item.source,
      link: item.link || linkedSnapshot?.link,
      notes: item.notes,
      estimatedPrice: item.estimatedPrice || (!linkedSnapshot?.price && unitPrice !== null),
    });
  }

  for (const snapshot of snapshots) {
    if (snapshot.status !== 'ok') continue;
    const key = normalizeComparableUrl(snapshot.link);
    if (usedSnapshotKeys.has(key)) continue;

    merged.push({
      name: snapshot.title || 'Linked product',
      category: undefined,
      quantity: 1,
      unitPrice: snapshot.price || null,
      subtotal: snapshot.price ? roundMoney(snapshot.price) : null,
      currency: (snapshot.currency || currencyPreference || 'CAD').toUpperCase(),
      dimensions: snapshot.dimensions,
      source: 'link',
      link: snapshot.link,
      notes: snapshot.description,
      estimatedPrice: !snapshot.price,
    });
  }

  return merged.slice(0, MAX_ITEMS);
}

async function generatePreviewImage(
  roomImage: string,
  stagingPrompt: string,
  snapshots: ProductLinkSnapshot[],
): Promise<{ previewImageDataUrl?: string; notes: string[] }> {
  const notes: string[] = [];
  if (roomImage || snapshots.length > 0) {
    notes.push('Gemini image generation uses text-guided staging from analyzed room context.');
  }

  try {
    const generated = await getGeminiClient().images.generate({
      model: getGeminiImageModel(),
      prompt: stagingPrompt,
      response_format: 'b64_json',
    });

    const first = generated.data?.[0];
    if (first?.b64_json) {
      return {
        previewImageDataUrl: `data:image/png;base64,${first.b64_json}`,
        notes,
      };
    }

    if (first?.url) {
      const fetched = await fetchWithTimeout(first.url, 12000);
      if (fetched.ok) {
        const contentType = fetched.headers.get('content-type')?.split(';')[0] || 'image/png';
        const buffer = Buffer.from(await fetched.arrayBuffer());
        return {
          previewImageDataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
          notes,
        };
      }
    }

    notes.push('Image generation did not return image data.');
    return { notes };
  } catch (error) {
    notes.push(`Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { notes };
  }
}

export async function buildFurnishingPreview(input: FurnishingPreviewInput): Promise<FurnishingPreviewResult> {
  const roomImage = optionalString(input.roomImage);
  if (!roomImage) throw new Error('Missing room image');

  const currencyPreference = optionalString(input.currencyPreference)?.toUpperCase() || 'CAD';

  const cleanLinks = (input.productLinks || [])
    .map((link) => optionalString(link))
    .filter((link): link is string => Boolean(link))
    .slice(0, MAX_PRODUCT_LINKS);

  const snapshots = await Promise.all(cleanLinks.map((link) => scrapeProductLink(link)));

  const planner = await buildPlannerOutput(roomImage, optionalString(input.requestText), snapshots, currencyPreference);

  const stagingPrompt = [
    'Preserve the original room architecture, viewpoint, perspective, windows, and lighting as much as possible.',
    'Add or replace furniture/appliances in realistic scale and usable layout with clear walking paths.',
    planner.designPrompt,
  ].join('\n');

  const items = mergePlannerItemsWithSnapshots(planner.items, snapshots, currencyPreference);

  const totalPrice = roundMoney(
    items.reduce((sum, item) => sum + (typeof item.subtotal === 'number' ? item.subtotal : 0), 0),
  );
  const missingPriceCount = items.filter((item) => item.unitPrice === null).length;

  const preview = await generatePreviewImage(roomImage, stagingPrompt, snapshots);

  return {
    previewImageDataUrl: preview.previewImageDataUrl,
    stagingPrompt,
    summary: planner.summary,
    assumptions: planner.assumptions,
    items,
    totalPrice,
    currency: items.find((item) => item.currency)?.currency || currencyPreference,
    missingPriceCount,
    sourceProducts: snapshots,
    notes: preview.notes,
  };
}
