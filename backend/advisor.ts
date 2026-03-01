import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { Response as ExpressResponse } from 'express';
import {
  generateGeminiEditedImage,
  getGeminiChatModel,
  getGeminiClient,
} from './ai-client.js';

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
- Renovator directory reference: https://renomark.ca/find-a-renovator/
- Architect directory references: https://oaa.on.ca/oaa-directory and https://secure.oaa.on.ca/practiceregister
- Cost guide references:
  - https://routehomes.ca/average-home-renovation-costs-in-toronto/
  - https://www.homestars.com/home-constructions-renovations/price-guides/cost-to-renovate-a-house
- Permit fee reference: https://www.toronto.ca/services-payments/building-construction/apply-for-a-building-permit/building-permit-fees/
- Rent references:
  - https://rentals.ca/national-rent-report
  - https://urbanation.ca/news/q2-2025-condominium-rental-market-survey

How to calculate:
1. Start from the provided address/location and explicitly use it to localize cost/rent assumptions.
2. Use the current image to estimate rough interior size in sqft.
3. Cross-check that estimate against document data; if docs are missing, say uncertainty is higher.
4. Compare current image vs target image (if provided) to infer renovation scope level and complexity.
5. Provide construction cost and total out-of-pocket ranges in CAD.
6. Include permit + soft costs in out-of-pocket. Reasonable soft-cost assumptions are acceptable when exact values are unknown.
7. Estimate rental return from market benchmarks and the matched rentable area. When nearby condo/house rent comparables are provided, explicitly use them as the primary local rent signal.
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
**Detailed pricing breakdown:** [then 6-12 bullet lines; each line must start with "- " and include a CAD range + short basis]
**Out-of-pocket breakdown:** [then bullet lines with explicit math components: construction subtotal, permits, architecture/design fees, engineering/consultant, contingency, financing/carrying, and final total]
**Return breakdown:** [then bullet lines with monthly gross rent, vacancy assumption, operating reserve/opex assumption, monthly net rent, annual net rent, and return/payback interpretation]
**Pricing references (contractor/architect/benchmarks):** [then 5-10 bullet lines, each with source name + full URL + one short note on how used]

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
6. **Where to get quotes now:** provide at least one contractor-directory link and one architect-directory link relevant to the location.

For follow-up replies, still provide updated numbers and keep these sections present: **Detailed pricing breakdown**, **Out-of-pocket breakdown**, **Return breakdown**, and **Pricing references (contractor/architect/benchmarks)**.

Never omit required section headings. If data is uncertain, provide conservative ranges with explicit assumptions instead of leaving sections empty.
When "Address intelligence" context is provided, use it to localize estimates and cite those source links in **Pricing references (contractor/architect/benchmarks)**.

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
  addressResearch?: AdvisorAddressResearch;
};

type Session = {
  messages: Message[];
  context: AdvisorSessionInput;
  firstUserMultimodal?: OpenAI.Chat.Completions.ChatCompletionContentPart[];
  latestRenderImageDataUrl?: string;
  latestRenderPrompt?: string;
  latestRenderNotes?: string[];
};

type PreparedDocuments = {
  textBlocks: string[];
  imageDataUrls: string[];
  notes: string[];
};

type AddressListingHit = {
  title: string;
  url: string;
  snippet?: string;
};

type AddressAmenitySummary = {
  schools: number;
  groceries: number;
  parks: number;
  transitStops: number;
  nearestTransitStopM?: number;
};

type AddressSource = {
  label: string;
  url: string;
  note?: string;
};

type AddressRentComparableHit = {
  title: string;
  url: string;
  snippet?: string;
  propertyType: 'condo' | 'house';
  monthlyRent: number;
  currency: string;
};

type AddressRentSignals = {
  currency: string;
  condoSampleCount: number;
  houseSampleCount: number;
  condoMedianMonthly?: number;
  houseMedianMonthly?: number;
  blendedMonthlyLow?: number;
  blendedMonthlyHigh?: number;
  comparables: AddressRentComparableHit[];
  notes: string[];
};

export type AdvisorAddressResearch = {
  query: string;
  normalizedAddress?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  countryCode?: string;
  osmType?: string;
  amenitySummary?: AddressAmenitySummary;
  rentSignals?: AddressRentSignals;
  listingHits: AddressListingHit[];
  sources: AddressSource[];
  notes: string[];
  updatedAt: string;
};

const sessions = new Map<string, Session>();
const MAX_DOCS = 8;
const MAX_DOC_IMAGE_COUNT = 4;
const MAX_TEXT_CHARS_PER_DOC = 7000;
const MAX_CURRENT_IMAGES_IN_PROMPT = 6;
const MAX_TARGET_IMAGES_IN_PROMPT = 6;
const MAX_RENDER_REFERENCE_IMAGES = 4;
const ADDRESS_RESEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const ADDRESS_RESEARCH_CACHE_MAX_ENTRIES = 80;
const ADDRESS_RESEARCH_RADIUS_M = 1500;
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const HTTP_USER_AGENT = 'Mozilla/5.0 (compatible; HomeKeyAdvisor/1.0; +https://homekey.local)';

type CachedAddressResearch = {
  data: AdvisorAddressResearch;
  expiresAt: number;
};

const addressResearchCache = new Map<string, CachedAddressResearch>();

export type AdvisorRenderResult = {
  previewImageDataUrl?: string;
  prompt: string;
  notes: string[];
};

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  return out.length > 0 ? out : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function dedupeSources(values: AddressSource[]): AddressSource[] {
  const seen = new Set<string>();
  const out: AddressSource[] = [];
  for (const value of values) {
    const url = value.url?.trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      label: value.label?.trim() || 'Reference',
      url,
      note: optionalString(value.note),
    });
  }
  return out;
}

function dedupeRentComparables(values: AddressRentComparableHit[]): AddressRentComparableHit[] {
  const seen = new Set<string>();
  const out: AddressRentComparableHit[] = [];
  for (const value of values) {
    const key = `${value.propertyType}:${value.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }
  return Math.round(sorted[mid] * 100) / 100;
}

function trimAddressResearchCache(): void {
  while (addressResearchCache.size > ADDRESS_RESEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = addressResearchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    addressResearchCache.delete(oldestKey);
  }
}

function getCachedAddressResearch(query: string): AdvisorAddressResearch | undefined {
  const key = query.toLowerCase();
  const cached = addressResearchCache.get(key);
  if (!cached) return undefined;
  if (Date.now() > cached.expiresAt) {
    addressResearchCache.delete(key);
    return undefined;
  }
  return cached.data;
}

function setCachedAddressResearch(query: string, data: AdvisorAddressResearch): void {
  addressResearchCache.set(query.toLowerCase(), {
    data,
    expiresAt: Date.now() + ADDRESS_RESEARCH_CACHE_TTL_MS,
  });
  trimAddressResearchCache();
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': HTTP_USER_AGENT,
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const value = Number.parseInt(hex, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .replace(/&#(\d+);/g, (_m, num: string) => {
      const value = Number.parseInt(num, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    });
}

function stripHtml(input: string): string {
  const withoutTags = input.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

function toAbsoluteUrl(base: string, href: string): string | undefined {
  try {
    const parsed = new URL(href, base);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function decodeDuckDuckGoResultUrl(rawHref: string): string | undefined {
  const absolute = toAbsoluteUrl('https://duckduckgo.com', rawHref);
  if (!absolute) return undefined;

  try {
    const parsed = new URL(absolute);
    if (parsed.hostname === 'duckduckgo.com' && parsed.pathname.startsWith('/l/')) {
      const redirectTarget = parsed.searchParams.get('uddg');
      if (redirectTarget) {
        const decoded = decodeURIComponent(redirectTarget);
        return toAbsoluteUrl('https://duckduckgo.com', decoded);
      }
    }
    return absolute;
  } catch {
    return undefined;
  }
}

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function inferDefaultCurrency(countryCode?: string): string {
  if (!countryCode) return 'USD';
  if (countryCode.toUpperCase() === 'CA') return 'CAD';
  if (countryCode.toUpperCase() === 'US') return 'USD';
  return 'USD';
}

function detectCurrencyFromText(raw: string): string | undefined {
  const upper = raw.toUpperCase();
  if (upper.includes('CAD') || upper.includes('C$')) return 'CAD';
  if (upper.includes('USD') || upper.includes('US$')) return 'USD';
  return undefined;
}

function parseMonthlyRentFromText(raw: string): { amount: number; currency?: string } | undefined {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const hasMonthlySignal = /(?:\/\s*(?:mo|month)|per\s+month|monthly)/i.test(text);
  const hasRentSignal = /\bfor rent\b|\brent\b/i.test(text);
  if (!hasMonthlySignal && !hasRentSignal) return undefined;

  const matches = [...text.matchAll(/(?:C\$|CAD\s*\$?|US\$\s*|USD\s*\$?|\$)\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.\d{1,2})?)/gi)];
  if (matches.length === 0) return undefined;

  const parsed: number[] = [];
  for (const match of matches) {
    const rawAmount = match[1];
    if (!rawAmount) continue;
    const amount = Number(rawAmount.replace(/,/g, ''));
    if (!Number.isFinite(amount)) continue;
    if (amount < 400 || amount > 20000) continue;
    parsed.push(amount);
  }
  if (parsed.length === 0) return undefined;

  const amount = median(parsed);
  if (!amount) return undefined;
  return {
    amount,
    currency: detectCurrencyFromText(text),
  };
}

function parseRentAmountLoose(raw: string): { amount: number; currency?: string } | undefined {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (!/\brent\b/i.test(text)) return undefined;

  const matches = [...text.matchAll(/(?:C\$|CAD\s*\$?|US\$\s*|USD\s*\$?|\$)\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.\d{1,2})?)/gi)];
  if (matches.length === 0) return undefined;

  const values: number[] = [];
  for (const match of matches) {
    const rawAmount = match[1];
    if (!rawAmount) continue;
    const amount = Number(rawAmount.replace(/,/g, ''));
    if (!Number.isFinite(amount)) continue;
    if (amount < 500 || amount > 25000) continue;
    values.push(amount);
  }
  const amount = median(values);
  if (!amount) return undefined;
  return {
    amount,
    currency: detectCurrencyFromText(text),
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

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

function mergeUniqueImages(current: string[] | undefined, incoming: string[], max: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  const push = (value: string): void => {
    const normalized = normalizeImageUrl(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(normalized);
  };

  for (const value of current || []) push(value);
  for (const value of incoming) push(value);

  return merged.slice(0, max);
}

function buildRenderPrompt(session: Session, instruction?: string): string {
  const latestAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant')?.content;
  const renderLines: string[] = [
    'Preserve the room geometry, camera perspective, and architectural structure from the base image.',
    'Apply a realistic post-renovation visual update aligned with the owner intent and constraints.',
    'Keep scale, circulation, and lighting believable and buildable.',
  ];

  if (session.context.location?.trim()) {
    renderLines.push(`Property location: ${session.context.location.trim()}.`);
  }
  if (session.context.propertyType?.trim()) {
    renderLines.push(`Property type: ${session.context.propertyType.trim()}.`);
  }
  if (session.context.currentHouseStatus?.trim()) {
    renderLines.push(`Current condition notes: ${session.context.currentHouseStatus.trim()}`);
  }
  if (session.context.firstMessage?.trim()) {
    renderLines.push(`Original owner goal: ${truncate(session.context.firstMessage.trim(), 450)}`);
  }
  if (instruction?.trim()) {
    renderLines.push(`Latest edit instruction: ${truncate(instruction.trim(), 450)}`);
  }
  if (latestAssistant?.trim()) {
    renderLines.push(`Renovation advisor context: ${truncate(latestAssistant.trim(), 650)}`);
  }

  renderLines.push('If reference/annotated images are provided, use them as renovation/style/layout direction.');
  return renderLines.join('\n\n');
}

async function summarizeVisualContextFromImages(
  baseImage: string,
  references: string[],
  instruction?: string,
): Promise<string | undefined> {
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: [
        'Summarize the room layout and design intent into one concise photorealistic image-generation prompt.',
        'Focus on architecture, camera angle, materials, style direction, and furniture placement cues.',
        'Do not include markdown. Keep it under 140 words.',
        instruction ? `Latest owner instruction: ${instruction}` : undefined,
      ].filter(Boolean).join('\n'),
    },
    { type: 'image_url', image_url: { url: normalizeImageUrl(baseImage) } },
  ];

  for (const image of references) {
    content.push({ type: 'image_url', image_url: { url: normalizeImageUrl(image) } });
  }

  try {
    const completion = await getGeminiClient().chat.completions.create({
      model: getGeminiChatModel(),
      temperature: 0.2,
      max_tokens: 260,
      messages: [{ role: 'user', content }],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return undefined;
    return truncate(text, 800);
  } catch {
    return undefined;
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
        const { default: pdfParse } = await import('pdf-parse');
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

async function geocodeAddressContext(query: string): Promise<{
  normalizedAddress?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  countryCode?: string;
  osmType?: string;
  notes: string[];
  sources: AddressSource[];
}> {
  const notes: string[] = [];
  const sources: AddressSource[] = [];
  const encoded = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encoded}`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json' },
    });

    sources.push({
      label: 'OpenStreetMap Nominatim',
      url: 'https://nominatim.openstreetmap.org/',
      note: `Geocoding query for "${query}"`,
    });

    if (!response.ok) {
      notes.push(`Address geocoding request returned HTTP ${response.status}.`);
      return { notes, sources };
    }

    const payload = await response.json() as Array<Record<string, unknown>>;
    const top = payload?.[0];
    if (!top) {
      notes.push('No exact geocoding match found for the address.');
      return { notes, sources };
    }

    const latitude = asFiniteNumber(top.lat);
    const longitude = asFiniteNumber(top.lon);
    const address = (top.address && typeof top.address === 'object')
      ? (top.address as Record<string, unknown>)
      : {};

    const city = optionalString(address.city)
      || optionalString(address.town)
      || optionalString(address.village)
      || optionalString(address.municipality)
      || optionalString(address.county);

    const provinceState = optionalString(address.state) || optionalString(address.region);
    const postalCode = optionalString(address.postcode);
    const countryCode = optionalString(address.country_code)?.toUpperCase();

    return {
      normalizedAddress: optionalString(top.display_name),
      latitude,
      longitude,
      city,
      provinceState,
      postalCode,
      countryCode,
      osmType: optionalString(top.osm_type),
      notes,
      sources,
    };
  } catch (error) {
    notes.push(`Address geocoding failed: ${error instanceof Error ? error.message : 'Unknown error'}.`);
    return { notes, sources };
  }
}

function getOverpassElementCoords(element: Record<string, unknown>): { lat: number; lon: number } | undefined {
  const lat = asFiniteNumber(element.lat);
  const lon = asFiniteNumber(element.lon);
  if (typeof lat === 'number' && typeof lon === 'number') {
    return { lat, lon };
  }

  const center = (element.center && typeof element.center === 'object')
    ? (element.center as Record<string, unknown>)
    : undefined;
  const centerLat = asFiniteNumber(center?.lat);
  const centerLon = asFiniteNumber(center?.lon);
  if (typeof centerLat === 'number' && typeof centerLon === 'number') {
    return { lat: centerLat, lon: centerLon };
  }
  return undefined;
}

async function summarizeNearbyAmenities(
  latitude: number,
  longitude: number,
): Promise<{ amenitySummary?: AddressAmenitySummary; notes: string[]; sources: AddressSource[] }> {
  const notes: string[] = [];
  const sources: AddressSource[] = [{
    label: 'OpenStreetMap Overpass',
    url: 'https://overpass-api.de/',
    note: `Nearby amenities within ${ADDRESS_RESEARCH_RADIUS_M} m radius`,
  }];

  const query = `
[out:json][timeout:20];
(
  node(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["amenity"="school"];
  way(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["amenity"="school"];
  relation(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["amenity"="school"];

  node(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["shop"~"supermarket|convenience|grocery"];
  way(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["shop"~"supermarket|convenience|grocery"];
  relation(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["shop"~"supermarket|convenience|grocery"];

  node(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["leisure"="park"];
  way(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["leisure"="park"];
  relation(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["leisure"="park"];

  node(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["highway"="bus_stop"];
  node(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["public_transport"~"platform|stop_position"];
  node(around:${ADDRESS_RESEARCH_RADIUS_M},${latitude},${longitude})["railway"~"station|tram_stop|subway_entrance"];
);
out center tags;
  `.trim();

  try {
    const response = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ data: query }).toString(),
    });

    if (!response.ok) {
      notes.push(`Amenity lookup returned HTTP ${response.status}.`);
      return { notes, sources };
    }

    const payload = await response.json() as { elements?: Array<Record<string, unknown>> };
    const elements = payload.elements || [];
    if (elements.length === 0) {
      notes.push('No nearby amenity records were found from OpenStreetMap within search radius.');
      return { notes, sources };
    }

    const schoolIds = new Set<string>();
    const groceryIds = new Set<string>();
    const parkIds = new Set<string>();
    const transitIds = new Set<string>();
    let nearestTransit: number | undefined;

    for (const element of elements) {
      const tags = (element.tags && typeof element.tags === 'object')
        ? (element.tags as Record<string, unknown>)
        : {};

      const amenity = optionalString(tags.amenity)?.toLowerCase();
      const shop = optionalString(tags.shop)?.toLowerCase();
      const leisure = optionalString(tags.leisure)?.toLowerCase();
      const highway = optionalString(tags.highway)?.toLowerCase();
      const publicTransport = optionalString(tags.public_transport)?.toLowerCase();
      const railway = optionalString(tags.railway)?.toLowerCase();

      const elementType = optionalString(element.type) || 'element';
      const numericId = asFiniteNumber(element.id);
      const coords = getOverpassElementCoords(element);
      const elementId = numericId !== undefined
        ? String(Math.round(numericId))
        : (coords ? `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}` : randomUUID());
      const key = `${elementType}:${elementId}`;

      if (amenity === 'school') schoolIds.add(key);
      if (shop && /^(supermarket|convenience|grocery)$/.test(shop)) groceryIds.add(key);
      if (leisure === 'park') parkIds.add(key);

      const transitMatch = highway === 'bus_stop'
        || publicTransport === 'platform'
        || publicTransport === 'stop_position'
        || railway === 'station'
        || railway === 'tram_stop'
        || railway === 'subway_entrance';

      if (transitMatch) {
        transitIds.add(key);
        if (coords) {
          const distance = haversineMeters(latitude, longitude, coords.lat, coords.lon);
          if (nearestTransit === undefined || distance < nearestTransit) {
            nearestTransit = distance;
          }
        }
      }
    }

    const amenitySummary: AddressAmenitySummary = {
      schools: schoolIds.size,
      groceries: groceryIds.size,
      parks: parkIds.size,
      transitStops: transitIds.size,
      nearestTransitStopM: nearestTransit !== undefined ? Math.round(nearestTransit) : undefined,
    };

    return { amenitySummary, notes, sources };
  } catch (error) {
    notes.push(`Amenity lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}.`);
    return { notes, sources };
  }
}

async function searchDuckDuckGoHits(
  query: string,
  preferredDomains: string[],
  limit: number,
): Promise<{ hits: AddressListingHit[]; source: AddressSource; notes: string[] }> {
  const notes: string[] = [];
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const source: AddressSource = {
    label: 'DuckDuckGo web search',
    url: searchUrl,
    note: `Query: "${query}"`,
  };

  try {
    const response = await fetchWithTimeout(searchUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });

    if (!response.ok) {
      notes.push(`Web search returned HTTP ${response.status} for query: ${query}`);
      return { hits: [], source, notes };
    }

    const html = await response.text();
    const results: Array<AddressListingHit & { sortPriority: number; index: number }> = [];
    const seen = new Set<string>();
    const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = anchorRe.exec(html)) !== null) {
      const href = optionalString(match[1]);
      const titleHtml = optionalString(match[2]);
      if (!href || !titleHtml) continue;

      const resolved = decodeDuckDuckGoResultUrl(href);
      if (!resolved) continue;
      if (seen.has(resolved)) continue;

      const domain = extractDomain(resolved);
      const isPreferred = domain && preferredDomains.some((entry) => domain.endsWith(entry));
      const snippetWindow = html.slice(match.index, match.index + 900);
      const snippetMatch = snippetWindow.match(/<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
      const snippet = snippetMatch?.[1] ? truncate(stripHtml(snippetMatch[1]), 280) : undefined;

      seen.add(resolved);
      results.push({
        title: truncate(stripHtml(titleHtml), 180),
        url: resolved,
        snippet,
        sortPriority: isPreferred ? 0 : 1,
        index,
      });
      index += 1;

      if (results.length >= limit * 3) break;
    }

    results.sort((a, b) => (a.sortPriority - b.sortPriority) || (a.index - b.index));
    return {
      hits: results.slice(0, limit).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
      })),
      source,
      notes,
    };
  } catch (error) {
    notes.push(`Web search failed for "${query}": ${error instanceof Error ? error.message : 'Unknown error'}.`);
    return { hits: [], source, notes };
  }
}

async function searchAddressListingHits(
  query: string,
): Promise<{ listingHits: AddressListingHit[]; notes: string[]; sources: AddressSource[] }> {
  const notes: string[] = [];
  const preferredDomains = [
    'realtor.ca',
    'realtor.com',
    'housesigma.com',
    'zoocasa.com',
    'zillow.com',
    'redfin.com',
    'trulia.com',
    'point2homes.com',
    'centris.ca',
  ];
  const result = await searchDuckDuckGoHits(`${query} house listing sold price`, preferredDomains, 8);
  if (result.hits.length === 0) {
    notes.push('No public listing links were detected from address web search.');
  }
  notes.push(...result.notes);
  return {
    listingHits: result.hits,
    notes,
    sources: [result.source],
  };
}

async function searchCityAverageRentSignal(
  city: string | undefined,
  provinceState: string | undefined,
  countryCode: string | undefined,
): Promise<{ averageMonthly?: number; currency: string; notes: string[]; sources: AddressSource[] }> {
  const notes: string[] = [];
  const sources: AddressSource[] = [];
  const currency = inferDefaultCurrency(countryCode);
  const locationText = [city, provinceState].filter(Boolean).join(' ').trim();
  if (!locationText) {
    return { currency, notes: ['City-level rent fallback was skipped because city/province was unavailable.'], sources };
  }

  const preferredDomains = ['rentals.ca', 'zumper.com', 'zillow.com', 'apartments.com', 'rentfaster.ca'];
  const result = await searchDuckDuckGoHits(
    `${locationText} average rent per month`,
    preferredDomains,
    8,
  );
  sources.push(result.source);
  notes.push(...result.notes);

  const values: number[] = [];
  for (const hit of result.hits) {
    const parsed = parseRentAmountLoose(`${hit.title} ${hit.snippet || ''}`);
    if (!parsed) continue;
    values.push(parsed.amount);
  }

  const averageMonthly = median(values);
  if (!averageMonthly) {
    notes.push(`City-level average-rent lookup did not return parseable monthly values for ${locationText}.`);
    return { currency, notes, sources };
  }

  return {
    averageMonthly,
    currency,
    notes,
    sources,
  };
}

async function searchNearbyRentComparables(
  query: string,
  city?: string,
  provinceState?: string,
  countryCode?: string,
): Promise<{ rentSignals?: AddressRentSignals; notes: string[]; sources: AddressSource[] }> {
  const notes: string[] = [];
  const sources: AddressSource[] = [];
  const defaultCurrency = inferDefaultCurrency(countryCode);
  const preferredRentDomains = [
    'rentals.ca',
    'realtor.ca',
    'zumper.com',
    'zillow.com',
    'apartments.com',
    'rentfaster.ca',
    'point2homes.com',
    'trulia.com',
  ];

  const condoComps: AddressRentComparableHit[] = [];
  const houseComps: AddressRentComparableHit[] = [];
  const baseQueries = dedupeStrings([
    query,
    [city, provinceState].filter(Boolean).join(' ').trim(),
    city || '',
  ]).slice(0, 3);

  const collectComparables = (
    propertyType: 'condo' | 'house',
    hits: AddressListingHit[],
    bucket: AddressRentComparableHit[],
  ): void => {
    for (const hit of hits) {
      const parsed = parseMonthlyRentFromText(`${hit.title} ${hit.snippet || ''}`);
      if (!parsed) continue;
      bucket.push({
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        propertyType,
        monthlyRent: parsed.amount,
        currency: parsed.currency || defaultCurrency,
      });
    }
  };

  for (const baseQuery of baseQueries) {
    const [condoResult, houseResult, townhouseResult] = await Promise.all([
      searchDuckDuckGoHits(`${baseQuery} condo for rent`, preferredRentDomains, 10),
      searchDuckDuckGoHits(`${baseQuery} house for rent`, preferredRentDomains, 10),
      searchDuckDuckGoHits(`${baseQuery} townhouse for rent`, preferredRentDomains, 8),
    ]);

    sources.push(condoResult.source, houseResult.source, townhouseResult.source);
    notes.push(...condoResult.notes, ...houseResult.notes, ...townhouseResult.notes);

    collectComparables('condo', condoResult.hits, condoComps);
    collectComparables('house', houseResult.hits, houseComps);
    collectComparables('house', townhouseResult.hits, houseComps);

    if (condoComps.length + houseComps.length >= 10) break;
  }

  const deduped = dedupeRentComparables([...condoComps, ...houseComps]).slice(0, 16);
  const condoValues = deduped.filter((entry) => entry.propertyType === 'condo').map((entry) => entry.monthlyRent);
  const houseValues = deduped.filter((entry) => entry.propertyType === 'house').map((entry) => entry.monthlyRent);
  let condoMedian = median(condoValues);
  let houseMedian = median(houseValues);

  if (condoMedian && !houseMedian) {
    houseMedian = Math.round(condoMedian * 1.12);
    notes.push('House-rent sample was thin; applied +12% proxy on condo median as a low-confidence house estimate.');
  }
  if (houseMedian && !condoMedian) {
    condoMedian = Math.round(houseMedian * 0.9);
    notes.push('Condo-rent sample was thin; applied -10% proxy on house median as a low-confidence condo estimate.');
  }

  if (!condoMedian && !houseMedian) {
    const cityFallback = await searchCityAverageRentSignal(city, provinceState, countryCode);
    sources.push(...cityFallback.sources);
    notes.push(...cityFallback.notes);

    if (cityFallback.averageMonthly) {
      condoMedian = Math.round(cityFallback.averageMonthly);
      houseMedian = Math.round(cityFallback.averageMonthly * 1.15);
      notes.push('Used city-level average rent signal fallback and applied +15% house premium due sparse listing-level rent comparables.');
    }
  }

  if (!condoMedian && !houseMedian) {
    const looksToronto = Boolean(city?.toLowerCase().includes('toronto') || provinceState?.toLowerCase().includes('ontario'));
    if (looksToronto) {
      condoMedian = 2498;
      houseMedian = 2873;
      notes.push('Used Toronto benchmark fallback: CAD 2,498/month condo average with +15% house premium.');
    } else {
      notes.push('Nearby rent comparable scraping did not find enough monthly rent amounts.');
      return { notes, sources };
    }
  }

  const blendedBase = houseMedian && condoMedian
    ? ((houseMedian * 0.65) + (condoMedian * 0.35))
    : (houseMedian || condoMedian || 0);
  const blendedMonthlyLow = Math.round(blendedBase * 0.92);
  const blendedMonthlyHigh = Math.round(blendedBase * 1.08);

  const rentSignals: AddressRentSignals = {
    currency: deduped[0]?.currency || defaultCurrency,
    condoSampleCount: condoValues.length,
    houseSampleCount: houseValues.length,
    condoMedianMonthly: condoMedian,
    houseMedianMonthly: houseMedian,
    blendedMonthlyLow,
    blendedMonthlyHigh,
    comparables: deduped,
    notes: [],
  };

  if (condoValues.length === 0) {
    rentSignals.notes.push('No condo monthly rents were parsed from nearby web results.');
  }
  if (houseValues.length === 0) {
    rentSignals.notes.push('No house monthly rents were parsed from nearby web results.');
  }
  if (rentSignals.notes.length > 0) {
    notes.push(...rentSignals.notes);
  }

  return {
    rentSignals,
    notes,
    sources,
  };
}

async function researchAddressContext(query: string): Promise<AdvisorAddressResearch> {
  const trimmed = query.trim();
  const cached = getCachedAddressResearch(trimmed);
  if (cached) return cached;

  const notes: string[] = [];
  const sources: AddressSource[] = [];
  let normalizedAddress: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;
  let city: string | undefined;
  let provinceState: string | undefined;
  let postalCode: string | undefined;
  let countryCode: string | undefined;
  let osmType: string | undefined;
  let amenitySummary: AddressAmenitySummary | undefined;
  let rentSignals: AddressRentSignals | undefined;
  let listingHits: AddressListingHit[] = [];

  const [geocodeResult, listingResult] = await Promise.allSettled([
    geocodeAddressContext(trimmed),
    searchAddressListingHits(trimmed),
  ]);

  if (geocodeResult.status === 'fulfilled') {
    normalizedAddress = geocodeResult.value.normalizedAddress;
    latitude = geocodeResult.value.latitude;
    longitude = geocodeResult.value.longitude;
    city = geocodeResult.value.city;
    provinceState = geocodeResult.value.provinceState;
    postalCode = geocodeResult.value.postalCode;
    countryCode = geocodeResult.value.countryCode;
    osmType = geocodeResult.value.osmType;
    notes.push(...geocodeResult.value.notes);
    sources.push(...geocodeResult.value.sources);
  } else {
    notes.push(`Address geocoding failed: ${geocodeResult.reason instanceof Error ? geocodeResult.reason.message : 'Unknown error'}.`);
  }

  if (listingResult.status === 'fulfilled') {
    listingHits = listingResult.value.listingHits;
    notes.push(...listingResult.value.notes);
    sources.push(...listingResult.value.sources);
  } else {
    notes.push(`Address listing lookup failed: ${listingResult.reason instanceof Error ? listingResult.reason.message : 'Unknown error'}.`);
  }

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    const amenityResult = await summarizeNearbyAmenities(latitude, longitude);
    amenitySummary = amenityResult.amenitySummary;
    notes.push(...amenityResult.notes);
    sources.push(...amenityResult.sources);
  } else {
    notes.push('Skipping amenity lookup because geocoded coordinates were unavailable.');
  }

  const rentCompResult = await searchNearbyRentComparables(
    normalizedAddress || `${trimmed} ${city || ''} ${provinceState || ''}`.trim(),
    city,
    provinceState,
    countryCode,
  );
  rentSignals = rentCompResult.rentSignals;
  notes.push(...rentCompResult.notes);
  sources.push(...rentCompResult.sources);

  const data: AdvisorAddressResearch = {
    query: trimmed,
    normalizedAddress,
    latitude,
    longitude,
    city,
    provinceState,
    postalCode,
    countryCode,
    osmType,
    amenitySummary,
    rentSignals,
    listingHits,
    sources: dedupeSources(sources),
    notes: dedupeStrings(notes),
    updatedAt: new Date().toISOString(),
  };

  setCachedAddressResearch(trimmed, data);
  return data;
}

function buildAddressResearchContextText(addressResearch: AdvisorAddressResearch): string {
  const lines: string[] = ['Address intelligence (online lookup):'];

  if (addressResearch.normalizedAddress) {
    lines.push(`- Matched address: ${addressResearch.normalizedAddress}`);
  }
  if (typeof addressResearch.latitude === 'number' && typeof addressResearch.longitude === 'number') {
    lines.push(`- Coordinates: ${addressResearch.latitude.toFixed(6)}, ${addressResearch.longitude.toFixed(6)}`);
  }

  const locationParts = [
    addressResearch.city,
    addressResearch.provinceState,
    addressResearch.postalCode,
    addressResearch.countryCode,
  ].filter(Boolean);
  if (locationParts.length > 0) {
    lines.push(`- Location fields: ${locationParts.join(' | ')}`);
  }

  if (addressResearch.amenitySummary) {
    const amenities = addressResearch.amenitySummary;
    lines.push(
      `- Nearby amenities (${ADDRESS_RESEARCH_RADIUS_M}m): schools=${amenities.schools}, groceries=${amenities.groceries}, parks=${amenities.parks}, transit stops=${amenities.transitStops}.`,
    );
    if (typeof amenities.nearestTransitStopM === 'number') {
      lines.push(`- Nearest transit stop distance: ~${amenities.nearestTransitStopM} meters.`);
    }
  }

  if (addressResearch.rentSignals) {
    const rent = addressResearch.rentSignals;
    lines.push(
      `- Nearby rent comparables: condo median=${rent.condoMedianMonthly ? `${rent.currency} ${Math.round(rent.condoMedianMonthly).toLocaleString()}/month (${rent.condoSampleCount} sample(s))` : 'not found'};`
      + ` house median=${rent.houseMedianMonthly ? `${rent.currency} ${Math.round(rent.houseMedianMonthly).toLocaleString()}/month (${rent.houseSampleCount} sample(s))` : 'not found'}.`,
    );
    if (rent.blendedMonthlyLow && rent.blendedMonthlyHigh) {
      lines.push(`- Blended monthly rent signal for this project: ${rent.currency} ${rent.blendedMonthlyLow.toLocaleString()}-${rent.blendedMonthlyHigh.toLocaleString()} / month.`);
    }
    if (rent.comparables.length > 0) {
      lines.push('- Sample nearby rent comparables used:');
      for (const comparable of rent.comparables.slice(0, 6)) {
        lines.push(
          `  - [${comparable.propertyType}] ${comparable.currency} ${Math.round(comparable.monthlyRent).toLocaleString()}/month | ${comparable.title} | ${comparable.url}`,
        );
      }
    }
  }

  if (addressResearch.listingHits.length > 0) {
    lines.push('- Potential public listing/market references found for this address:');
    for (const hit of addressResearch.listingHits.slice(0, 6)) {
      const summary = hit.snippet ? ` - ${hit.snippet}` : '';
      lines.push(`  - ${hit.title} | ${hit.url}${summary}`);
    }
  } else {
    lines.push('- No listing hits were detected automatically; proceed with broader location benchmarks.');
  }

  if (addressResearch.sources.length > 0) {
    lines.push('- Address intelligence sources:');
    for (const source of addressResearch.sources.slice(0, 10)) {
      const note = source.note ? ` (${source.note})` : '';
      lines.push(`  - ${source.label}: ${source.url}${note}`);
    }
  }

  if (addressResearch.notes.length > 0) {
    lines.push('- Address research notes / caveats:');
    for (const note of addressResearch.notes.slice(0, 10)) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join('\n');
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
  if (context.addressResearch) lines.push(buildAddressResearchContextText(context.addressResearch));

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
  if (context.addressResearch) {
    const addressParts = [
      context.addressResearch.city,
      context.addressResearch.provinceState,
      context.addressResearch.postalCode,
    ].filter(Boolean).join(', ');
    const rentSummary = context.addressResearch.rentSignals?.blendedMonthlyLow
      && context.addressResearch.rentSignals?.blendedMonthlyHigh
      ? ` | rent signal: ${context.addressResearch.rentSignals.currency} ${context.addressResearch.rentSignals.blendedMonthlyLow.toLocaleString()}-${context.addressResearch.rentSignals.blendedMonthlyHigh.toLocaleString()}/mo`
      : '';
    summaryLines.push(
      `Address intelligence: ${context.addressResearch.listingHits.length} listing hit(s),`
      + ` ${context.addressResearch.amenitySummary ? 'amenities mapped' : 'amenities unavailable'}`
      + (addressParts ? ` | ${addressParts}` : '')
      + rentSummary,
    );
  }
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
      addressResearch: input.addressResearch,
    },
    latestRenderImageDataUrl: undefined,
    latestRenderPrompt: undefined,
    latestRenderNotes: [],
  });

  return sessionId;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getAddressResearch(sessionId: string): AdvisorAddressResearch | undefined {
  return sessions.get(sessionId)?.context.addressResearch;
}

export async function ensureAddressResearch(sessionId: string): Promise<AdvisorAddressResearch | undefined> {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  if (session.context.addressResearch) return session.context.addressResearch;
  if (!session.context.location?.trim()) return undefined;

  session.context.addressResearch = await researchAddressContext(session.context.location.trim());
  return session.context.addressResearch;
}

export function appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push({ role, content });
}

export async function streamFirstReply(
  sessionId: string,
  firstMessage: string | undefined,
  res: ExpressResponse,
): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (!session.context.addressResearch && session.context.location?.trim()) {
    session.context.addressResearch = await researchAddressContext(session.context.location.trim());
  }

  const built = await buildInitialUserContent(session.context, firstMessage);
  session.firstUserMultimodal = built.parts;
  session.messages.push({ role: 'user', content: built.summaryText });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Session-Id', sessionId);

  const stream = await getGeminiClient().chat.completions.create({
    model: getGeminiChatModel(),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: built.parts },
    ],
    stream: true,
    max_tokens: 2600,
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

export async function streamChatReply(sessionId: string, userMessage: string, res: ExpressResponse): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (!session.context.addressResearch && session.context.location?.trim()) {
    session.context.addressResearch = await researchAddressContext(session.context.location.trim());
  }

  session.messages.push({ role: 'user', content: userMessage });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...sessionToMessages(session),
  ];

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const stream = await getGeminiClient().chat.completions.create({
    model: getGeminiChatModel(),
    messages,
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
}

export async function renderAdvisorPreview(
  sessionId: string,
  input?: { instruction?: string; referenceImages?: string[] },
): Promise<AdvisorRenderResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const incomingReferences = (input?.referenceImages || [])
    .map((image) => image?.trim())
    .filter((image): image is string => Boolean(image))
    .map((image) => normalizeImageUrl(image));

  if (incomingReferences.length > 0) {
    session.context.targetImages = mergeUniqueImages(
      session.context.targetImages,
      incomingReferences,
      MAX_TARGET_IMAGES_IN_PROMPT,
    );
  }

  const baseImage = session.latestRenderImageDataUrl
    || session.context.currentImages?.[0]
    || session.context.currentImage;
  if (!baseImage) {
    throw new Error('No base image available for rendering');
  }

  const references = (session.context.targetImages || [])
    .slice(0, MAX_RENDER_REFERENCE_IMAGES);
  const visualContext = await summarizeVisualContextFromImages(baseImage, references, input?.instruction);
  const prompt = [
    buildRenderPrompt(session, input?.instruction),
    visualContext ? `Image-grounded context:\n${visualContext}` : undefined,
  ].filter(Boolean).join('\n\n');
  const notes: string[] = [];

  try {
    const previewImageDataUrl = await generateGeminiEditedImage({
      prompt,
      baseImageDataUrl: baseImage,
      referenceImageDataUrls: references,
    });
    session.latestRenderImageDataUrl = previewImageDataUrl;
    session.latestRenderPrompt = prompt;
    session.latestRenderNotes = notes;
    return { previewImageDataUrl, prompt, notes };
  } catch (error) {
    notes.push(`Preview generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  session.latestRenderPrompt = prompt;
  session.latestRenderNotes = notes;
  return {
    previewImageDataUrl: session.latestRenderImageDataUrl,
    prompt,
    notes,
  };
}
