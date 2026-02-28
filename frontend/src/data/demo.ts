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
