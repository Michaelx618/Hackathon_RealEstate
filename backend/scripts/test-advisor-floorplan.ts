/**
 * Test the advisor API with a real floor plan image from test-data.
 * Start the backend first: npm run dev --prefix backend (or npm run dev from root).
 * Then: cd backend && npx tsx scripts/test-advisor-floorplan.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, '../../test-data/images/sample-floorplan.jpg');
const API_URL = process.env.ADVISOR_API_URL || 'http://localhost:3000';

function toDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const base64 = buf.toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

async function main() {
  if (!fs.existsSync(TEST_IMAGE)) {
    console.error('❌ Test image not found:', TEST_IMAGE);
    process.exit(1);
  }

  const imageDataUrl = toDataUrl(TEST_IMAGE);
  console.log('📷 Loaded floor plan image:', TEST_IMAGE);
  console.log('📤 POST', `${API_URL}/api/advisor/session`);
  console.log('');

  const body = {
    currentImage: imageDataUrl,
    currentImages: [imageDataUrl],
    firstMessage: 'Estimate renovation cost and rental potential. I may rent it out or add a suite.',
    propertyType: 'House / Townhouse',
    location: 'Toronto, ON',
  };

  const res = await fetch(`${API_URL}/api/advisor/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('❌ Request failed:', res.status, err);
    process.exit(1);
  }

  const sessionId = res.headers.get('X-Session-Id');
  if (sessionId) console.log('Session ID:', sessionId);

  const reader = res.body?.getReader();
  if (!reader) {
    console.error('No response body');
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let fullText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    process.stdout.write(chunk);
  }

  console.log('\n\n--- Parsed structure check ---');
  const hasScore = /\*\*Potential score:\*\*\s*\d+\s*\/?\s*100/i.test(fullText);
  const hasTimeline = /\*\*Estimated renovation timeline:\*\*/i.test(fullText);
  const hasKeyFactors = /\*\*Key factors:\*\*/i.test(fullText);
  const hasConstructionCost = /\*\*Construction cost:\*\*/i.test(fullText);
  const hasPhases = /\*\*Phase\s*1:\*\*/i.test(fullText);
  console.log('Potential score:', hasScore ? '✓' : '✗');
  console.log('Estimated timeline:', hasTimeline ? '✓' : '✗');
  console.log('Key factors:', hasKeyFactors ? '✓' : '✗');
  console.log('Construction cost:', hasConstructionCost ? '✓' : '✗');
  console.log('Phases:', hasPhases ? '✓' : '✗');
  console.log('\nTotal response length:', fullText.length, 'chars');
}

main().catch((err) => {
  console.error('Error:', err.message);
  if (err.cause?.code === 'ECONNREFUSED') {
    console.error('Make sure the backend is running: npm run dev --prefix backend');
  }
  process.exit(1);
});
