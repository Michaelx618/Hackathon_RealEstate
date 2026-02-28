/**
 * Demo data for testing the renovation advisor: sample addresses and floor plan image URLs.
 * Use addresses to quick-fill location; open floor plan links, save the image, then upload.
 */

export const SAMPLE_ADDRESSES = [
  'Austin, TX',
  'Denver, CO',
  'Portland, OR',
  'Seattle, WA',
  'San Francisco, CA',
  'Austin, TX 78701',
  '123 Main St, Portland OR',
  '456 Oak Ave, Denver CO 80202',
] as const;

/** Sample floor plan image URLs for testing. Open link → right-click image → Save As → upload in app. */
export const SAMPLE_FLOOR_PLAN_LINKS: { label: string; url: string }[] = [
  { label: 'Sample floor plan (Wikimedia)', url: 'https://upload.wikimedia.org/wikipedia/commons/9/9a/Sample_Floorplan.jpg' },
  { label: 'House floor plan (Wikimedia)', url: 'https://upload.wikimedia.org/wikipedia/commons/1/18/Floor_plan_1.jpg' },
  { label: 'Brentmore plan (Wikimedia)', url: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Typical_floor_plan_of_the_Brentmore_%28NYPL_b11389518-417244%29.jpg' },
];

/** Toronto addresses for testing the conversion/advisor flow with Toronto-specific pricing and permits. */
export const TORONTO_SAMPLE_ADDRESSES = [
  '100 Queen St W, Toronto, ON M5H 2N2',
  '350 Bloor St E, Toronto, ON M4W 1J4',
  '1 King St W, Toronto, ON M5H 1A1',
  '55 Harbour Sq, Toronto, ON M5J 2L1',
  '200 Front St W, Toronto, ON M5V 3W2',
  'Toronto, ON',
  'Toronto, ON M5V 1A1',
] as const;

/** Pairs of Toronto address + floor plan for conversion testing. Use the address in the advisor location field and the floor plan URL to download an image to upload. */
export const TORONTO_FLOOR_PLAN_TEST_CASES: { address: string; floorPlanLabel: string; floorPlanUrl: string }[] = [
  { address: '100 Queen St W, Toronto, ON M5H 2N2', floorPlanLabel: 'Sample floor plan (Wikimedia)', floorPlanUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9a/Sample_Floorplan.jpg' },
  { address: '350 Bloor St E, Toronto, ON M4W 1J4', floorPlanLabel: 'House floor plan (Wikimedia)', floorPlanUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/18/Floor_plan_1.jpg' },
  { address: '1 King St W, Toronto, ON M5H 1A1', floorPlanLabel: 'Brentmore plan (Wikimedia)', floorPlanUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Typical_floor_plan_of_the_Brentmore_%28NYPL_b11389518-417244%29.jpg' },
  { address: 'Toronto, ON', floorPlanLabel: 'Sample floor plan (Wikimedia)', floorPlanUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9a/Sample_Floorplan.jpg' },
];
