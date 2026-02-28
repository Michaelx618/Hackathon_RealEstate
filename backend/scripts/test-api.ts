/**
 * Test script for the advisor API: prompt and response.
 * Run from repo root: npm run test:api
 * Or: cd backend && npx tsx scripts/test-api.ts
 */
import 'dotenv/config';
import OpenAI from 'openai';

// Same prompt as advisor.ts (including phased plan)
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

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('❌ OPENAI_API_KEY not set. Add it to backend/.env');
    process.exit(1);
  }
  console.log('✅ OPENAI_API_KEY is set\n');

  const openai = new OpenAI({ apiKey: key });

  // --- Test 1: Text-only (no image) - quick sanity check and prompt style ---
  console.log('--- Test 1: Text-only (no image) ---');
  console.log('User message: "Single-family house in San Francisco. I want to convert to Airbnb. No image yet – what would you typically advise?"\n');
  try {
    const textRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            'Location: San Francisco. This is a Single-family house. I want to convert to Airbnb. I don’t have a floor plan image yet – what would you typically advise for someone in my situation?',
        },
      ],
      max_tokens: 600,
    });
    const text = textRes.choices[0]?.message?.content ?? '(no content)';
    console.log('Assistant response (excerpt):');
    console.log(text.slice(0, 800) + (text.length > 800 ? '...' : ''));
    console.log('\n✅ Test 1 passed\n');
  } catch (err) {
    console.error('❌ Test 1 failed:', err);
    process.exit(1);
  }

  // --- Test 2: With a real image (vision) - one public URL ---
  console.log('--- Test 2: Vision (image + prompt) ---');
  const imageUrl =
    'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400';
  console.log('Using sample house image URL + "Location: Oakland. Townhouse. Convert to Airbnb."\n');
  try {
    const visionRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: 'Location: Oakland. This is a Townhouse. Here’s my floor plan. I want to convert to Airbnb – suggest layout changes, ballpark costs, and permits.',
            },
          ],
        },
      ],
      max_tokens: 700,
    });
    const visionText = visionRes.choices[0]?.message?.content ?? '(no content)';
    console.log('Assistant response (excerpt):');
    console.log(visionText.slice(0, 1200) + (visionText.length > 1200 ? '...' : ''));
    const hasPhase = /\*\*Phase\s*\d+:/i.test(visionText);
    const hasCost = /\*\*Estimated cost:\*\*/i.test(visionText);
    console.log(hasPhase ? '  ✓ Contains Phase 1/2/3 format' : '  ⚠ No Phase N: format found');
    console.log(hasCost ? '  ✓ Contains Estimated cost' : '  ⚠ No Estimated cost line');
    console.log('\n✅ Test 2 passed\n');
  } catch (err) {
    console.error('❌ Test 2 failed:', err);
    process.exit(1);
  }

  console.log('Done. API key works; prompting and vision response look good.');
}

main();
