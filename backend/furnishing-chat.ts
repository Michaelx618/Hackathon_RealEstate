// @ts-nocheck
import { randomUUID } from 'crypto';
import OpenAI, { toFile } from 'openai';
import { generateGeminiEditedImage, getGeminiChatModel, getGeminiClient } from './ai-client.js';
const sessions = new Map();
const MAX_SLOT_COUNT = 8;
const MAX_OPTIONS_PER_SLOT = 4;
const MAX_REFERENCE_IMAGES_FOR_RENDER = 4;
const MAX_LINKS_PER_TURN = 10;
const MAX_MESSAGE_HISTORY = 14;
const SLOT_PLANNER_PROMPT = `You are an interior furnishing planner for an interactive chat.

Task:
Given conversation history and optional direct product links, produce the user's CURRENT desired furniture/appliance shopping slots.

Return strict JSON only:
{
  "assistantMessage": string,
  "slots": [
    {
      "label": string,
      "category": string,
      "searchQuery": string,
      "quantity": number,
      "constraints": string,
      "preferredLink": string
    }
  ]
}

Rules:
- Keep slots to 1-8 practical items for one room/unit.
- Reflect the latest user intent (add/remove/replace items when requested).
- Use concise IKEA-searchable searchQuery (style + type + size hints where available).
- quantity must be integer >= 1.
- category should be short (e.g. sofa, bed, table, chair, storage, lighting, appliance, decor, other).
- If user provides a specific product URL, put it in preferredLink for the closest slot.
- Do NOT collapse explicit requests into a generic bundle like "furniture set" when user listed distinct items.
- When user lists multiple items (comma-separated or joined with "and"), return one slot per item.
- Keep item intent faithful (e.g. "L-shape gray sofa", "oak coffee table", "TV console", "floor lamp", "65-inch TV").
- assistantMessage should briefly confirm what changed and what will be shown next.
- No markdown. No prose outside JSON.`;
const ROOM_PROFILE_PROMPT = `Estimate room dimensions for furnishing fit checks.

Return strict JSON only:
{
  "estimatedWidthM": number | null,
  "estimatedDepthM": number | null,
  "estimatedAreaSqm": number | null,
  "source": "floorplan" | "image" | "default",
  "notes": string[]
}

Rules:
- Use floor plan image if available; otherwise estimate from room image only.
- If uncertain, provide conservative estimates and include uncertainty in notes.
- If impossible, return null numeric fields and source="default".
- No markdown.`;
function optionalString(value) {
    if (typeof value !== 'string')
        return undefined;
    const out = value.trim();
    return out.length > 0 ? out : undefined;
}
function normalizeImageDataUrl(value) {
    if (value.startsWith('data:'))
        return value;
    return `data:image/jpeg;base64,${value}`;
}
function decodeDataUrl(dataUrl) {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0)
        return null;
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
    }
    catch {
        return null;
    }
}
async function toImageFileFromDataUrl(dataUrl, fileName) {
    const normalized = normalizeImageDataUrl(dataUrl);
    const decoded = decodeDataUrl(normalized);
    if (!decoded)
        throw new Error('Invalid image payload');
    return toFile(decoded.buffer, fileName, { type: decoded.mimeType });
}
function roundMoney(value) {
    return Math.round(value * 100) / 100;
}
function extractUrls(raw) {
    if (!raw)
        return [];
    const re = /(https?:\/\/[^\s)\]}"'<>]+)/gi;
    const out = [];
    let match;
    while ((match = re.exec(raw)) !== null) {
        const value = match[1]?.trim();
        if (!value)
            continue;
        try {
            const url = new URL(value);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                out.push(url.toString());
            }
        }
        catch {
            // Ignore invalid URL.
        }
    }
    return [...new Set(out)].slice(0, MAX_LINKS_PER_TURN);
}
function normalizeComparableUrl(value) {
    try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '').toLowerCase();
    }
    catch {
        return value.trim().toLowerCase();
    }
}
function slugify(input) {
    const compact = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return compact || 'item';
}
function makeHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
function buildOptionId(url, itemNo) {
    if (itemNo)
        return `ikea-${itemNo}`;
    return `opt-${makeHash(normalizeComparableUrl(url))}`;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, '').trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function asPositiveNumber(value) {
    const parsed = asNumber(value);
    if (typeof parsed !== 'number')
        return undefined;
    if (parsed <= 0)
        return undefined;
    return parsed;
}
function extractCm(raw) {
    if (!raw)
        return undefined;
    const match = raw.match(/(\d+(?:\.\d+)?)\s*cm/i);
    if (!match?.[1])
        return undefined;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return roundMoney(parsed);
}
function getCurrencyFromLocation(location) {
    const normalized = location.toLowerCase();
    const looksLikeCanada = /\b(canada|ontario|toronto|vancouver|montreal|alberta|british columbia|quebec|ottawa|calgary|edmonton)\b/.test(normalized)
        || /\b[a-z]\d[a-z][\s-]?\d[a-z]\d\b/i.test(location);
    if (looksLikeCanada) {
        return {
            countryCode: 'ca',
            languageCode: 'en',
            currency: 'CAD',
            label: 'Canada',
        };
    }
    return {
        countryCode: 'us',
        languageCode: 'en',
        currency: 'USD',
        label: 'United States',
    };
}
async function fetchWithTimeout(url, init, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; HomeKeyBot/1.0)',
                ...(init?.headers || {}),
            },
        });
    }
    finally {
        clearTimeout(timeout);
    }
}
function safeJsonParse(raw) {
    const trimmed = raw.trim();
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        // Try extracting one object envelope.
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
        const snippet = trimmed.slice(first, last + 1);
        try {
            const parsed = JSON.parse(snippet);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            return {};
        }
    }
    return {};
}
function takeStringArray(raw, max = 8) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const value of raw.slice(0, max)) {
        const text = optionalString(value);
        if (text)
            out.push(text);
    }
    return out;
}
function parsePlannerSlots(raw) {
    if (!Array.isArray(raw))
        return [];
    const slots = [];
    for (const entry of raw.slice(0, MAX_SLOT_COUNT)) {
        if (!entry || typeof entry !== 'object')
            continue;
        const obj = entry;
        const label = optionalString(obj.label);
        const category = optionalString(obj.category) || 'other';
        const searchQuery = optionalString(obj.searchQuery) || label;
        if (!label || !searchQuery)
            continue;
        const quantityRaw = asPositiveNumber(obj.quantity);
        const quantity = Math.max(1, Math.min(20, Math.round(quantityRaw || 1)));
        slots.push({
            label,
            category,
            searchQuery,
            quantity,
            constraints: optionalString(obj.constraints),
            preferredLink: optionalString(obj.preferredLink),
        });
    }
    return slots;
}
function normalizeSlotCategory(raw) {
    const text = (optionalString(raw) || '').toLowerCase();
    if (/(sofa|couch|sectional)/.test(text))
        return 'sofa';
    if (/(coffee table|table)/.test(text))
        return 'table';
    if (/(tv console|media|storage|cabinet|console|stand|bench)/.test(text))
        return 'storage';
    if (/(lamp|lighting)/.test(text))
        return 'lighting';
    if (/(tv|television|appliance)/.test(text))
        return 'appliance';
    if (/(bed|mattress)/.test(text))
        return 'bed';
    return text || 'other';
}
function slotLooksGeneric(slot) {
    const label = `${slot.label || ''} ${slot.searchQuery || ''}`.toLowerCase();
    if (/(furniture set|primary furniture|full set|bundle|package|room set|modern furniture set)/.test(label)) {
        return true;
    }
    return false;
}
function hasSimilarRequestedSlot(existingSlots, requested) {
    const reqCategory = normalizeSlotCategory(requested.category || requested.label || requested.searchQuery);
    const reqLabel = slugify(requested.label || requested.searchQuery || '');
    for (const slot of existingSlots) {
        const slotCategory = normalizeSlotCategory(slot.category || slot.label || slot.searchQuery);
        if (slotCategory !== reqCategory)
            continue;
        const slotLabel = slugify(slot.label || slot.searchQuery || '');
        if (slotLabel === reqLabel)
            return true;
        if (slotLabel.includes(reqLabel) || reqLabel.includes(slotLabel))
            return true;
    }
    return false;
}
function parseExplicitQuantity(text, phrases) {
    for (const phrase of phrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const before = text.match(new RegExp(`\\b(\\d+)\\s+${escaped}\\b`, 'i'));
        if (before?.[1]) {
            const value = Number(before[1]);
            if (Number.isFinite(value) && value > 0)
                return Math.min(20, Math.round(value));
        }
        const after = text.match(new RegExp(`\\b${escaped}\\s*x\\s*(\\d+)\\b`, 'i'));
        if (after?.[1]) {
            const value = Number(after[1]);
            if (Number.isFinite(value) && value > 0)
                return Math.min(20, Math.round(value));
        }
    }
    return 1;
}
function extractRuleBasedSlots(message, links) {
    const text = optionalString(message);
    if (!text)
        return [];
    const lowered = text.toLowerCase();
    const slots = [];
    const linkQueue = [...links];
    const pushSlot = (slot) => {
        if (slots.length >= MAX_SLOT_COUNT)
            return;
        if (!slot.label || !slot.searchQuery)
            return;
        slots.push({
            ...slot,
            quantity: Math.max(1, Math.min(20, Math.round(slot.quantity || 1))),
            preferredLink: slot.preferredLink || linkQueue.shift(),
        });
    };
    const tvSizeMatch = lowered.match(/\b(\d{2,3})\s*(?:-|\s)?(?:inch|in|")\s*tv\b/i);
    const tvSize = tvSizeMatch?.[1];
    const hasLShape = /\bl[\s-]?shape(?:d)?\b|\bsectional\b/.test(lowered);
    const hasGray = /\b(gray|grey|charcoal)\b/.test(lowered);
    const hasOak = /\boak\b/.test(lowered);
    if (/\b(sofa|couch|sectional)\b/.test(lowered)) {
        const queryParts = [];
        if (hasLShape)
            queryParts.push('L-shape');
        if (hasGray)
            queryParts.push('gray');
        queryParts.push('sofa');
        pushSlot({
            label: `${hasLShape ? 'L-shape ' : ''}${hasGray ? 'Gray ' : ''}Sofa`.trim(),
            category: 'sofa',
            searchQuery: queryParts.join(' '),
            quantity: parseExplicitQuantity(text, ['sofa', 'sectional', 'couch']),
            constraints: hasLShape ? 'L-shape / sectional preferred.' : undefined,
        });
    }
    if (/\bcoffee\s+table\b/.test(lowered)) {
        pushSlot({
            label: `${hasOak ? 'Oak ' : ''}Coffee Table`.trim(),
            category: 'table',
            searchQuery: `${hasOak ? 'oak ' : ''}coffee table`.trim(),
            quantity: parseExplicitQuantity(text, ['coffee table']),
        });
    }
    if (/\b(tv|television)\s*(console|stand|bench|unit)\b|\b(media)\s*(console|stand|unit)\b/.test(lowered)) {
        const sizeHint = tvSize ? `${tvSize} inch ` : '';
        pushSlot({
            label: 'TV Console',
            category: 'storage',
            searchQuery: `${sizeHint}tv console`.trim(),
            quantity: parseExplicitQuantity(text, ['tv console', 'tv stand', 'media console', 'media unit']),
            constraints: tvSize ? `Should support approximately ${tvSize}-inch TV.` : undefined,
        });
    }
    if (/\bfloor\s+lamp\b|\bstanding\s+lamp\b/.test(lowered)) {
        pushSlot({
            label: 'Floor Lamp',
            category: 'lighting',
            searchQuery: 'floor lamp',
            quantity: parseExplicitQuantity(text, ['floor lamp', 'standing lamp']),
        });
    }
    const hasTvRequest = Boolean(tvSize)
        || (/\b(tv|television)\b/.test(lowered)
            && !/\b(tv|television)\s*(console|stand|bench|unit)\b/.test(lowered));
    if (hasTvRequest) {
        pushSlot({
            label: `${tvSize ? `${tvSize}-inch ` : ''}TV`.trim(),
            category: 'appliance',
            searchQuery: `${tvSize ? `${tvSize} inch ` : ''}tv`.trim(),
            quantity: parseExplicitQuantity(text, ['tv', 'television']),
            constraints: tvSize ? `${tvSize}-inch size requested.` : undefined,
        });
    }
    if (slots.length === 0)
        return [];
    const deduped = [];
    const seen = new Set();
    for (const slot of slots) {
        const key = `${normalizeSlotCategory(slot.category)}:${slugify(slot.label || slot.searchQuery)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(slot);
    }
    return deduped.slice(0, MAX_SLOT_COUNT);
}
function mergePlannerWithRuleBasedSlots(plannerSlots, ruleSlots, latestMessage) {
    if (ruleSlots.length === 0)
        return plannerSlots;
    const messageLooksLikeList = /,| and |\bwith\b/i.test((latestMessage || '').toLowerCase());
    const genericPlanner = plannerSlots.length === 0
        || plannerSlots.every((slot) => slotLooksGeneric(slot))
        || (plannerSlots.some((slot) => slotLooksGeneric(slot)) && plannerSlots.length <= 2);
    if (genericPlanner || plannerSlots.length < ruleSlots.length || messageLooksLikeList) {
        return ruleSlots.slice(0, MAX_SLOT_COUNT);
    }
    const merged = [...plannerSlots];
    for (const rule of ruleSlots) {
        if (hasSimilarRequestedSlot(merged, rule))
            continue;
        merged.push(rule);
        if (merged.length >= MAX_SLOT_COUNT)
            break;
    }
    return merged.slice(0, MAX_SLOT_COUNT);
}
function parseIkeaPrice(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return roundMoney(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, '').trim());
        if (Number.isFinite(parsed) && parsed > 0)
            return roundMoney(parsed);
    }
    return null;
}
function pickImageUrl(value) {
    if (!value)
        return undefined;
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (Array.isArray(value)) {
        for (const item of value) {
            const picked = pickImageUrl(item);
            if (picked)
                return picked;
        }
        return undefined;
    }
    if (typeof value !== 'object')
        return undefined;
    const obj = value;
    return optionalString(obj.url) || optionalString(obj.contentUrl) || optionalString(obj['@id']);
}
function fallbackDimensionsText(widthRaw, depthRaw, heightRaw) {
    const parts = [];
    if (widthRaw)
        parts.push(`W ${widthRaw}`);
    if (depthRaw)
        parts.push(`D ${depthRaw}`);
    if (heightRaw)
        parts.push(`H ${heightRaw}`);
    return parts.length ? parts.join(' | ') : undefined;
}
function getIkeaSearchEndpoint(market) {
    return `https://sik.search.blue.cdtapps.com/${market.countryCode}/${market.languageCode}/search?c=sr&v=20250507`;
}
function getIkeaSearchReferer(market, query) {
    const encoded = encodeURIComponent(query);
    return `https://www.ikea.com/${market.countryCode}/${market.languageCode}/search/?q=${encoded}`;
}
async function searchIkeaProducts(market, query) {
    const body = {
        searchParameters: {
            input: query,
            type: 'QUERY',
        },
        allowAutocorrect: true,
        components: [
            {
                component: 'PRIMARY_AREA',
                columns: 4,
                types: {
                    main: 'PRODUCT',
                    breakouts: ['PLANNER', 'CATEGORY', 'CONTENT', 'MATTRESS_WARRANTY', 'FINANCIAL_SERVICES'],
                },
                filterConfig: {
                    'subcategories-style': 'tree-navigation',
                    'max-num-filters': 7,
                },
                window: {
                    size: 24,
                    offset: 0,
                },
                forceFilterCalculation: true,
                sort: 'RELEVANCE',
            },
            { component: 'SIMILAR_PRODUCTS' },
            { component: 'SEARCH_SUMMARY' },
        ],
    };
    const response = await fetchWithTimeout(getIkeaSearchEndpoint(market), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/plain, */*',
            origin: 'https://www.ikea.com',
            referer: getIkeaSearchReferer(market, query),
        },
        body: JSON.stringify(body),
    }, 12000);
    if (!response.ok)
        return [];
    const raw = await response.json();
    const primary = raw.results?.find((entry) => entry.component === 'PRIMARY_AREA');
    const items = primary?.items || [];
    const options = [];
    for (const item of items) {
        const product = item.product;
        const url = optionalString(product?.pipUrl);
        if (!url)
            continue;
        const option = {
            optionId: buildOptionId(url, optionalString(product?.itemNo)),
            source: 'ikea',
            name: optionalString(product?.name) || 'IKEA product',
            url,
            imageUrl: optionalString(product?.mainImageUrl),
            unitPrice: parseIkeaPrice(product?.salesPrice?.numeral),
            currency: optionalString(product?.salesPrice?.currencyCode) || market.currency,
            itemNo: optionalString(product?.itemNo),
            typeName: optionalString(product?.typeName),
        };
        options.push(option);
    }
    const deduped = new Map();
    for (const option of options) {
        const key = normalizeComparableUrl(option.url);
        if (!deduped.has(key))
            deduped.set(key, option);
    }
    return [...deduped.values()];
}
function findJsonLdById(html, scriptId) {
    const regex = new RegExp(`<script[^>]*id=["']${scriptId}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
    const match = html.match(regex);
    if (!match?.[1])
        return undefined;
    try {
        const parsed = JSON.parse(match[1]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
function collectJsonLdObjects(html) {
    const out = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
        const raw = match[1]?.trim();
        if (!raw)
            continue;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item === 'object' && !Array.isArray(item)) {
                        out.push(item);
                    }
                }
            }
            else if (parsed && typeof parsed === 'object') {
                out.push(parsed);
            }
        }
        catch {
            continue;
        }
    }
    return out;
}
function pickProductJsonLd(html) {
    const preferred = findJsonLdById(html, 'pip-range-json-ld');
    if (preferred)
        return preferred;
    const blocks = collectJsonLdObjects(html);
    for (const block of blocks) {
        const type = block['@type'];
        if (typeof type === 'string' && /product/i.test(type))
            return block;
        if (Array.isArray(type) && type.some((t) => typeof t === 'string' && /product/i.test(t)))
            return block;
    }
    return undefined;
}
async function fetchIkeaProductDetails(url, market) {
    const response = await fetchWithTimeout(url, {
        headers: {
            accept: 'text/html,application/xhtml+xml',
            referer: `https://www.ikea.com/${market.countryCode}/${market.languageCode}/`,
        },
    }, 12000);
    if (!response.ok)
        return {};
    const html = await response.text();
    const jsonLd = pickProductJsonLd(html);
    if (!jsonLd)
        return {};
    const widthRaw = optionalString(jsonLd.width);
    const depthRaw = optionalString(jsonLd.depth);
    const heightRaw = optionalString(jsonLd.height);
    let offersObj;
    const offers = jsonLd.offers;
    if (offers && typeof offers === 'object' && !Array.isArray(offers)) {
        offersObj = offers;
    }
    else if (Array.isArray(offers)) {
        const first = offers.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
        if (first && typeof first === 'object' && !Array.isArray(first)) {
            offersObj = first;
        }
    }
    const name = optionalString(jsonLd.name);
    const unitPrice = parseIkeaPrice(offersObj?.price);
    const currency = optionalString(offersObj?.priceCurrency);
    const canonicalUrl = optionalString(offersObj?.url) || optionalString(jsonLd.url) || url;
    const imageUrl = pickImageUrl(jsonLd.image);
    return {
        name,
        unitPrice,
        currency,
        url: canonicalUrl,
        imageUrl,
        widthCm: extractCm(widthRaw),
        depthCm: extractCm(depthRaw),
        heightCm: extractCm(heightRaw),
        dimensionsText: fallbackDimensionsText(widthRaw, depthRaw, heightRaw),
    };
}
function extractMetaTagContent(html, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexes = [
        new RegExp(`<meta[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]*name=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
    ];
    for (const regex of regexes) {
        const match = html.match(regex);
        if (match?.[1])
            return match[1].trim();
    }
    return undefined;
}
function extractTitleTag(html) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match?.[1])
        return undefined;
    return match[1].replace(/\s+/g, ' ').trim();
}
function detectCurrency(raw) {
    if (!raw)
        return undefined;
    const upper = raw.toUpperCase();
    if (upper.includes('CAD') || upper.includes('C$'))
        return 'CAD';
    if (upper.includes('USD') || upper.includes('US$'))
        return 'USD';
    if (upper.includes('EUR') || upper.includes('€'))
        return 'EUR';
    if (upper.includes('GBP') || upper.includes('£'))
        return 'GBP';
    return undefined;
}
function parseLoosePrice(raw) {
    if (!raw)
        return null;
    const cleaned = raw.replace(/,/g, ' ');
    const match = cleaned.match(/(\d+(?:[\s.]\d{3})*(?:[.,]\d{1,2})?)/);
    if (!match?.[1])
        return null;
    const normalized = match[1].replace(/\s/g, '').replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return null;
    return roundMoney(parsed);
}
function extractDimensionsFromText(raw) {
    if (!raw)
        return {};
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return {};
    const triple = cleaned.match(/(\d+(?:\.\d+)?)\s*cm\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i);
    if (triple?.[1] && triple[2] && triple[3]) {
        return {
            text: `${triple[1]} cm x ${triple[2]} cm x ${triple[3]} cm`,
            widthCm: Number(triple[1]),
            depthCm: Number(triple[2]),
            heightCm: Number(triple[3]),
        };
    }
    const pair = cleaned.match(/(\d+(?:\.\d+)?)\s*cm\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i);
    if (pair?.[1] && pair[2]) {
        return {
            text: `${pair[1]} cm x ${pair[2]} cm`,
            widthCm: Number(pair[1]),
            depthCm: Number(pair[2]),
        };
    }
    return {};
}
async function scrapeGenericProductLink(url, fallbackCurrency) {
    const response = await fetchWithTimeout(url, { headers: { accept: 'text/html,application/xhtml+xml' } }, 12000);
    if (!response.ok)
        return undefined;
    const html = await response.text();
    const title = extractMetaTagContent(html, 'og:title')
        || extractMetaTagContent(html, 'twitter:title')
        || extractTitleTag(html)
        || 'Linked furniture product';
    const imageUrl = extractMetaTagContent(html, 'og:image') || extractMetaTagContent(html, 'twitter:image');
    const description = extractMetaTagContent(html, 'og:description')
        || extractMetaTagContent(html, 'description')
        || '';
    const priceRaw = extractMetaTagContent(html, 'product:price:amount')
        || extractMetaTagContent(html, 'og:price:amount')
        || extractMetaTagContent(html, 'price')
        || description;
    const currencyRaw = extractMetaTagContent(html, 'product:price:currency')
        || extractMetaTagContent(html, 'og:price:currency')
        || priceRaw;
    const looseDimensions = extractDimensionsFromText(description);
    return {
        optionId: buildOptionId(url),
        source: 'link',
        name: title,
        url,
        imageUrl,
        unitPrice: parseLoosePrice(priceRaw),
        currency: detectCurrency(currencyRaw) || fallbackCurrency,
        dimensionsText: looseDimensions.text,
        widthCm: looseDimensions.widthCm,
        depthCm: looseDimensions.depthCm,
        heightCm: looseDimensions.heightCm,
    };
}
function slotSelectionKey(slot) {
    return `${slugify(slot.label)}:${slugify(slot.category)}`;
}
function buildSlotId(slot, index) {
    return `${slugify(slot.label)}-${index + 1}`;
}
function summarizeMessages(messages) {
    const relevant = messages.slice(-MAX_MESSAGE_HISTORY);
    return relevant
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join('\n');
}
async function planDesiredSlots(session, message, links) {
    const existingSlotsText = session.slots.length
        ? session.slots.map((slot) => `- ${slot.label} | ${slot.category} | qty=${slot.quantity} | query=${slot.searchQuery}`).join('\n')
        : 'None yet.';
    const linkedText = links.length ? links.map((link) => `- ${link}`).join('\n') : 'None';
    const prompt = [
        `Location: ${session.context.location}`,
        `IKEA market: ${session.context.market.label} (${session.context.market.currency})`,
        'Conversation history:',
        summarizeMessages(session.messages),
        'Latest user message:',
        message,
        'Extracted links from latest request:',
        linkedText,
        'Current slots before update:',
        existingSlotsText,
        'Return JSON only.',
    ].join('\n\n');
    const completion = await getGeminiClient().chat.completions.create({
        model: getGeminiChatModel(),
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SLOT_PLANNER_PROMPT },
            { role: 'user', content: prompt },
        ],
    });
    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw);
    const plannerSlots = parsePlannerSlots(parsed.slots);
    const ruleSlots = extractRuleBasedSlots(message, links);
    let slots = mergePlannerWithRuleBasedSlots(plannerSlots, ruleSlots, message);
    if (slots.length === 0) {
        slots = [{
                label: 'Living room sofa',
                category: 'sofa',
                searchQuery: 'gray sofa',
                quantity: 1,
            }];
    }
    return {
        assistantMessage: optionalString(parsed.assistantMessage) || 'Updated your furniture plan and refreshed IKEA options.',
        slots,
    };
}
async function getOptionFromLink(market, rawLink, cache) {
    const link = optionalString(rawLink);
    if (!link)
        return undefined;
    let normalized;
    try {
        normalized = new URL(link).toString();
    }
    catch {
        return undefined;
    }
    const cacheKey = normalizeComparableUrl(normalized);
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    let option;
    if (/\.ikea\.com\//i.test(normalized) || /\/ikea\.com\//i.test(normalized)) {
        const details = await fetchIkeaProductDetails(normalized, market);
        option = {
            optionId: buildOptionId(details.url || normalized),
            source: 'ikea',
            name: details.name || 'IKEA linked product',
            url: details.url || normalized,
            imageUrl: details.imageUrl,
            unitPrice: details.unitPrice ?? null,
            currency: details.currency || market.currency,
            dimensionsText: details.dimensionsText,
            widthCm: details.widthCm,
            depthCm: details.depthCm,
            heightCm: details.heightCm,
        };
    }
    else {
        option = await scrapeGenericProductLink(normalized, market.currency);
    }
    if (!option)
        return undefined;
    cache.set(cacheKey, option);
    return option;
}
async function enrichIkeaOption(option, market, cache) {
    const cacheKey = normalizeComparableUrl(option.url);
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const details = await fetchIkeaProductDetails(option.url, market)
        .catch(() => ({}));
    const enriched = {
        ...option,
        name: details.name || option.name,
        url: details.url || option.url,
        imageUrl: details.imageUrl || option.imageUrl,
        unitPrice: details.unitPrice ?? option.unitPrice,
        currency: details.currency || option.currency,
        dimensionsText: details.dimensionsText || option.dimensionsText,
        widthCm: details.widthCm ?? option.widthCm,
        depthCm: details.depthCm ?? option.depthCm,
        heightCm: details.heightCm ?? option.heightCm,
    };
    cache.set(cacheKey, enriched);
    return enriched;
}
function dedupeOptions(options) {
    const map = new Map();
    for (const option of options) {
        const key = normalizeComparableUrl(option.url);
        if (!map.has(key))
            map.set(key, option);
    }
    return [...map.values()];
}
function buildIkeaSearchFallbackOption(slot, market) {
    return {
        optionId: `fallback-${slugify(slot.label || slot.searchQuery)}-${makeHash(slot.searchQuery || slot.label || 'item')}`,
        source: 'ikea',
        name: `${slot.label} (IKEA search)`,
        url: getIkeaSearchReferer(market, slot.searchQuery || slot.label || 'furniture'),
        unitPrice: null,
        currency: market.currency,
        dimensionsText: undefined,
    };
}
function buildNoDirectMatchOption(slot, market, reason) {
    return {
        optionId: `no-match-${slugify(slot.label || slot.searchQuery)}-${makeHash(slot.searchQuery || slot.label || 'item')}`,
        source: 'ikea',
        name: `${slot.label} (${reason})`,
        url: getIkeaSearchReferer(market, slot.searchQuery || slot.label || 'furniture'),
        unitPrice: null,
        currency: market.currency,
        dimensionsText: undefined,
    };
}
async function buildSlotOptions(slot, market, cache) {
    const options = [];
    if (slot.preferredLink) {
        const linked = await getOptionFromLink(market, slot.preferredLink, cache);
        if (linked)
            options.push(linked);
    }
    const searchOptions = await searchIkeaProducts(market, slot.searchQuery);
    const topSearchOptions = searchOptions.slice(0, MAX_OPTIONS_PER_SLOT * 2);
    const enrichedSearch = await Promise.all(topSearchOptions.map((option) => enrichIkeaOption(option, market, cache).catch(() => option)));
    options.push(...enrichedSearch);
    const deduped = dedupeOptions(options);
    const top = deduped.slice(0, MAX_OPTIONS_PER_SLOT);
    const normalizedCategory = normalizeSlotCategory(slot.category || slot.label || slot.searchQuery);
    if (normalizedCategory === 'appliance' && /\btv\b/i.test(slot.searchQuery || slot.label || '')) {
        const likelyTelevision = top.filter((option) => {
            const name = (option.name || '').toLowerCase();
            if (!/\b(tv|television|smart)\b/.test(name))
                return false;
            if (/\b(unit|stand|bench|console|cabinet|storage)\b/.test(name))
                return false;
            return true;
        });
        if (likelyTelevision.length === 0) {
            return [buildNoDirectMatchOption(slot, market, 'No direct IKEA TV match; add a product link')];
        }
    }
    if (top.length > 0)
        return top;
    return [buildIkeaSearchFallbackOption(slot, market)];
}
async function updateSlotsFromDesired(session, desiredSlots) {
    const prevSelectionBySlotKey = new Map();
    for (const existing of session.slots) {
        const key = `${slugify(existing.label)}:${slugify(existing.category)}`;
        if (existing.selectedOptionId)
            prevSelectionBySlotKey.set(key, existing.selectedOptionId);
    }
    const nextSlots = [];
    for (const [index, desired] of desiredSlots.slice(0, MAX_SLOT_COUNT).entries()) {
        const options = await buildSlotOptions(desired, session.context.market, session.optionCache);
        if (options.length === 0)
            continue;
        const slotId = buildSlotId(desired, index);
        const slotKey = slotSelectionKey(desired);
        const previousSelected = prevSelectionBySlotKey.get(slotKey);
        const selectedOptionId = options.some((option) => option.optionId === previousSelected)
            ? previousSelected
            : options[0].optionId;
        nextSlots.push({
            slotId,
            label: desired.label,
            category: desired.category,
            searchQuery: desired.searchQuery,
            quantity: desired.quantity,
            constraints: desired.constraints,
            selectedOptionId,
            options,
        });
    }
    if (nextSlots.length > 0) {
        session.slots = nextSlots;
    }
}
function collectSelectedItems(slots) {
    const items = [];
    for (const slot of slots) {
        const selected = slot.options.find((option) => option.optionId === slot.selectedOptionId);
        if (!selected)
            continue;
        const subtotal = selected.unitPrice !== null
            ? roundMoney(selected.unitPrice * slot.quantity)
            : null;
        items.push({
            slotId: slot.slotId,
            slotLabel: slot.label,
            quantity: slot.quantity,
            optionId: selected.optionId,
            name: selected.name,
            url: selected.url,
            imageUrl: selected.imageUrl,
            unitPrice: selected.unitPrice,
            currency: selected.currency,
            subtotal,
            dimensionsText: selected.dimensionsText,
            widthCm: selected.widthCm,
            depthCm: selected.depthCm,
            heightCm: selected.heightCm,
            itemNo: selected.itemNo,
        });
    }
    return items;
}
function computeTotals(selectedItems, fallbackCurrency) {
    const totalPrice = roundMoney(selectedItems.reduce((sum, item) => sum + (typeof item.subtotal === 'number' ? item.subtotal : 0), 0));
    const missingPriceCount = selectedItems.filter((item) => item.unitPrice === null).length;
    const currency = selectedItems.find((item) => item.currency)?.currency || fallbackCurrency;
    return { totalPrice, currency, missingPriceCount };
}
async function estimateRoomProfile(session) {
    if (session.roomProfile)
        return session.roomProfile;
    try {
        const content = [
            {
                type: 'text',
                text: [
                    `Property location: ${session.context.location}`,
                    'Estimate room dimensions for furniture fit checks.',
                    'If uncertain, still provide best estimate and explain uncertainty.',
                    'Return JSON only.',
                ].join('\n'),
            },
            {
                type: 'image_url',
                image_url: { url: normalizeImageDataUrl(session.context.roomImage) },
            },
        ];
        if (session.context.floorPlanImage) {
            content.push({
                type: 'image_url',
                image_url: { url: normalizeImageDataUrl(session.context.floorPlanImage) },
            });
        }
        const completion = await getGeminiClient().chat.completions.create({
            model: getGeminiChatModel(),
            temperature: 0.2,
            max_tokens: 450,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: ROOM_PROFILE_PROMPT },
                { role: 'user', content },
            ],
        });
        const raw = completion.choices[0]?.message?.content || '{}';
        const parsed = safeJsonParse(raw);
        const width = asPositiveNumber(parsed.estimatedWidthM);
        const depth = asPositiveNumber(parsed.estimatedDepthM);
        const area = asPositiveNumber(parsed.estimatedAreaSqm) || (width && depth ? roundMoney(width * depth) : undefined);
        const sourceRaw = optionalString(parsed.source);
        const source = sourceRaw === 'floorplan' || sourceRaw === 'image' || sourceRaw === 'default'
            ? sourceRaw
            : (session.context.floorPlanImage ? 'floorplan' : 'image');
        const roomProfile = {
            estimatedWidthM: width,
            estimatedDepthM: depth,
            estimatedAreaSqm: area,
            source,
            notes: takeStringArray(parsed.notes, 6),
        };
        if (!roomProfile.estimatedAreaSqm) {
            roomProfile.estimatedAreaSqm = 16;
            roomProfile.source = 'default';
            roomProfile.notes.push('Fallback room area of 16 sqm used due limited visual scale information.');
        }
        if (!roomProfile.estimatedWidthM || !roomProfile.estimatedDepthM) {
            const areaGuess = roomProfile.estimatedAreaSqm || 16;
            const side = Math.sqrt(areaGuess);
            roomProfile.estimatedWidthM = roundMoney(side);
            roomProfile.estimatedDepthM = roundMoney(areaGuess / side);
            roomProfile.notes.push('Width/depth approximated from estimated area.');
        }
        session.roomProfile = roomProfile;
        return roomProfile;
    }
    catch {
        const fallback = {
            estimatedWidthM: 4,
            estimatedDepthM: 4,
            estimatedAreaSqm: 16,
            source: 'default',
            notes: ['Fallback dimensions used (4.0m x 4.0m) because automatic estimation failed.'],
        };
        session.roomProfile = fallback;
        return fallback;
    }
}
function analyzeSpacing(roomProfile, selectedItems) {
    const notes = [];
    const itemsWithFootprint = selectedItems.filter((item) => typeof item.widthCm === 'number' && typeof item.depthCm === 'number');
    const usedAreaSqm = itemsWithFootprint.reduce((sum, item) => {
        const width = (item.widthCm || 0) / 100;
        const depth = (item.depthCm || 0) / 100;
        const area = width * depth * item.quantity;
        return sum + area;
    }, 0);
    const estimatedAreaSqm = roomProfile.estimatedAreaSqm;
    const spacing = {
        estimatedAreaSqm,
        usedAreaSqm: usedAreaSqm > 0 ? roundMoney(usedAreaSqm) : undefined,
        fitStatus: 'unknown',
        notes,
    };
    if (!estimatedAreaSqm || estimatedAreaSqm <= 0 || !spacing.usedAreaSqm) {
        notes.push('Spacing confidence is limited because room area or item dimensions are incomplete.');
        const missingDims = selectedItems.filter((item) => !item.widthCm || !item.depthCm).length;
        if (missingDims > 0) {
            notes.push(`${missingDims} selected item(s) are missing width/depth dimensions.`);
        }
        return spacing;
    }
    const coverageRatio = spacing.usedAreaSqm / estimatedAreaSqm;
    spacing.coverageRatio = roundMoney(coverageRatio);
    if (coverageRatio <= 0.45) {
        spacing.fitStatus = 'good';
        notes.push('Layout density is comfortable with reasonable circulation area.');
    }
    else if (coverageRatio <= 0.65) {
        spacing.fitStatus = 'moderate';
        notes.push('Layout is moderately dense; verify walkways around major furniture.');
    }
    else {
        spacing.fitStatus = 'tight';
        notes.push('Layout is dense and may feel crowded; consider smaller alternatives.');
    }
    const roomWidthCm = (roomProfile.estimatedWidthM || 0) * 100;
    const roomDepthCm = (roomProfile.estimatedDepthM || 0) * 100;
    for (const item of itemsWithFootprint) {
        const width = item.widthCm || 0;
        const depth = item.depthCm || 0;
        if (width > roomWidthCm * 0.95 && depth > roomDepthCm * 0.95) {
            notes.push(`${item.name} is likely oversized relative to the current room estimate.`);
        }
        else if (Math.max(width, depth) > Math.max(roomWidthCm, roomDepthCm) * 0.9) {
            notes.push(`${item.name} is close to room span limits; placement flexibility may be low.`);
        }
    }
    if (coverageRatio > 0.55) {
        notes.push('Target at least 80-90 cm clear paths between major furniture zones.');
    }
    return spacing;
}
async function fetchImageAsFile(url, fileNamePrefix) {
    try {
        const response = await fetchWithTimeout(url, undefined, 12000);
        if (!response.ok) {
            return { error: `Image fetch failed (${response.status}) for ${url}` };
        }
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
        if (!contentType.startsWith('image/')) {
            return { error: `Reference URL is not an image: ${url}` };
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 15 * 1024 * 1024) {
            return { error: `Reference image too large for ${url}` };
        }
        const extension = contentType.split('/')[1] || 'jpg';
        const file = await toFile(buffer, `${fileNamePrefix}.${extension}`, { type: contentType });
        return { file };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : `Failed to fetch image ${url}` };
    }
}
async function generatePreviewImage(session, selectedItems, spacing) {
    const notes = [];
    if (selectedItems.length === 0) {
        notes.push('No selected items yet, preview not rendered.');
        return { notes };
    }
    const selectedList = selectedItems.map((item, index) => {
        const size = item.dimensionsText
            || ((item.widthCm && item.depthCm)
                ? `${item.widthCm} cm x ${item.depthCm} cm${item.heightCm ? ` x ${item.heightCm} cm` : ''}`
                : 'size not available');
        return `${index + 1}. ${item.name} (qty ${item.quantity}, size ${size})`;
    }).join('\n');
    const prompt = [
        'Preserve the exact room geometry, perspective, wall/floor structure, and window positions from the original image.',
        'Furnish the room with the selected real products below, keeping realistic scale and non-overlapping layout.',
        selectedList,
        `Spacing target: fit status ${spacing.fitStatus}. Keep at least ~80-90 cm circulation where feasible.`,
        'If everything cannot fit, prioritize main seating/bed/storage items first while keeping a believable design.',
    ].join('\n\n');
    try {
        const previewImageDataUrl = await generateGeminiEditedImage({
            prompt,
            baseImageDataUrl: session.context.roomImage,
            referenceImageDataUrls: session.context.floorPlanImage ? [session.context.floorPlanImage] : [],
        });
        return { previewImageDataUrl, notes };
    }
    catch (error) {
        const status = typeof error === 'object' && error && 'status' in error
            ? Number(error.status)
            : undefined;
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (status === 429 || /quota|resource_exhausted/i.test(message)) {
            notes.push('Image preview unavailable: Gemini image quota is exceeded (HTTP 429). Enable billing or retry after quota reset.');
        }
        else if (status === 403) {
            notes.push('Image preview unavailable: Gemini image generation is not permitted for this API key/project.');
        }
        else if (status === 404 || /not found|not supported for predict/i.test(message)) {
            notes.push('Image preview unavailable: selected GEMINI_IMAGE_MODEL does not support image editing. Use gemini-3-pro-image-preview (Nano Banana Pro).');
        }
        else {
            notes.push(`Image generation failed: ${message}`);
        }
        return { notes };
    }
}
function ensureSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session)
        throw new Error('Furnishing session not found');
    return session;
}
function applySelectionAction(session, action) {
    if (!action)
        return undefined;
    const slot = session.slots.find((entry) => entry.slotId === action.slotId);
    if (!slot)
        return `Could not find slot ${action.slotId}.`;
    if (action.type === 'clear_slot') {
        slot.selectedOptionId = undefined;
        return `Cleared selection for ${slot.label}.`;
    }
    if (action.type === 'select_option') {
        const candidate = slot.options.find((option) => option.optionId === action.optionId);
        if (!candidate)
            return `Could not find that option in ${slot.label}.`;
        slot.selectedOptionId = candidate.optionId;
        return `Updated ${slot.label} to ${candidate.name}.`;
    }
    return undefined;
}
function safeMessage(raw) {
    const text = optionalString(raw);
    if (!text)
        return undefined;
    return text.slice(0, 4000);
}
function mergeLinks(listA, listB) {
    return [...new Set([...listA, ...listB])].slice(0, MAX_LINKS_PER_TURN);
}
function buildAssistantMessage(baseMessage, totals, spacing) {
    const lines = [baseMessage];
    lines.push(`Current total: ${totals.currency} ${totals.totalPrice.toFixed(2)}.`);
    if (typeof spacing.coverageRatio === 'number') {
        lines.push(`Estimated furniture coverage: ${(spacing.coverageRatio * 100).toFixed(1)}% of room area (${spacing.fitStatus}).`);
    }
    else {
        lines.push(`Spacing status: ${spacing.fitStatus}.`);
    }
    return lines.join(' ');
}
function sanitizeLinks(links) {
    if (!links)
        return [];
    const out = [];
    for (const raw of links.slice(0, MAX_LINKS_PER_TURN)) {
        const value = optionalString(raw);
        if (!value)
            continue;
        try {
            const parsed = new URL(value);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                out.push(parsed.toString());
            }
        }
        catch {
            // Ignore invalid URL.
        }
    }
    return [...new Set(out)];
}
export function createFurnishingSession(input) {
    const roomImage = optionalString(input.roomImage);
    const location = optionalString(input.location);
    if (!roomImage)
        throw new Error('Missing room image');
    if (!location)
        throw new Error('Missing property address/location');
    const sessionId = randomUUID();
    const market = getCurrencyFromLocation(location);
    const session = {
        sessionId,
        context: {
            roomImage,
            floorPlanImage: optionalString(input.floorPlanImage),
            location,
            market,
        },
        messages: [],
        slots: [],
        roomProfile: undefined,
        previewImageDataUrl: undefined,
        optionCache: new Map(),
        notes: [],
    };
    sessions.set(sessionId, session);
    return sessionId;
}
export function getFurnishingSession(sessionId) {
    return sessions.get(sessionId);
}
export async function runFurnishingTurn(sessionId, input) {
    const session = ensureSession(sessionId);
    const message = safeMessage(input.message);
    const action = input.action;
    const inputLinks = sanitizeLinks(input.productLinks);
    const actionNote = applySelectionAction(session, action);
    if (message) {
        session.messages.push({ role: 'user', content: message });
    }
    const messageLinks = extractUrls(message);
    const turnLinks = mergeLinks(inputLinks, messageLinks);
    let plannerMessage = actionNote || 'Updated your plan and refreshed the preview.';
    const shouldReplan = Boolean(message) || session.slots.length === 0;
    if (shouldReplan) {
        const planningMessage = message || 'Plan furniture for this room based on current context.';
        const planned = await planDesiredSlots(session, planningMessage, turnLinks);
        // Promote direct links as preferred links when planner missed them.
        if (turnLinks.length > 0) {
            for (const [index, link] of turnLinks.entries()) {
                if (index >= planned.slots.length)
                    break;
                if (!planned.slots[index])
                    continue;
                if (!planned.slots[index].preferredLink) {
                    planned.slots[index].preferredLink = link;
                }
            }
        }
        await updateSlotsFromDesired(session, planned.slots);
        plannerMessage = planned.assistantMessage;
    }
    const roomProfile = await estimateRoomProfile(session);
    const selectedItems = collectSelectedItems(session.slots);
    const totals = computeTotals(selectedItems, session.context.market.currency);
    const spacing = analyzeSpacing(roomProfile, selectedItems);
    const render = await generatePreviewImage(session, selectedItems, spacing);
    if (render.previewImageDataUrl) {
        session.previewImageDataUrl = render.previewImageDataUrl;
    }
    const assistantMessage = buildAssistantMessage(plannerMessage, totals, spacing);
    session.messages.push({ role: 'assistant', content: assistantMessage });
    const combinedNotes = [...session.notes, ...render.notes];
    return {
        sessionId: session.sessionId,
        assistantMessage,
        previewImageDataUrl: session.previewImageDataUrl,
        slots: session.slots,
        selectedItems,
        totalPrice: totals.totalPrice,
        currency: totals.currency,
        missingPriceCount: totals.missingPriceCount,
        spacing,
        roomProfile,
        notes: combinedNotes,
    };
}
