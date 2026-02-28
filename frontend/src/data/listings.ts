export interface Listing {
  id: number
  address: string
  city: string
  state: string
  zip: string
  price: number
  beds: number
  baths: number
  sqft: number
  type: 'sale' | 'rent'
  image: string
  description?: string
}

export const listings: Listing[] = [
  { id: 1, address: '124 Oak Street', city: 'San Francisco', state: 'CA', zip: '94102', price: 1_250_000, beds: 4, baths: 3, sqft: 2400, type: 'sale', image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop', description: 'Spacious family home with modern finishes and a large backyard.' },
  { id: 2, address: '88 Marina Blvd', city: 'San Francisco', state: 'CA', zip: '94123', price: 2_100_000, beds: 5, baths: 4, sqft: 3200, type: 'sale', image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop', description: 'Stunning waterfront property with bay views.' },
  { id: 3, address: '456 Pine Ave', city: 'Oakland', state: 'CA', zip: '94610', price: 895_000, beds: 3, baths: 2, sqft: 1800, type: 'sale', image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop', description: 'Charming craftsman in a walkable neighborhood.' },
  { id: 4, address: '2200 Pacific Heights Dr', city: 'San Francisco', state: 'CA', zip: '94115', price: 3_450_000, beds: 6, baths: 5, sqft: 4200, type: 'sale', image: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=400&h=300&fit=crop', description: 'Luxury estate with panoramic city views.' },
  { id: 5, address: '901 Mission St', city: 'San Francisco', state: 'CA', zip: '94103', price: 2_800, beds: 2, baths: 2, sqft: 1100, type: 'rent', image: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400&h=300&fit=crop', description: 'Modern condo in the heart of SoMa.' },
  { id: 6, address: '55 Tehama St', city: 'San Francisco', state: 'CA', zip: '94105', price: 3_200, beds: 2, baths: 2, sqft: 950, type: 'rent', image: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=400&h=300&fit=crop', description: 'New construction with rooftop deck.' },
  { id: 7, address: '1200 Broadway', city: 'Oakland', state: 'CA', zip: '94612', price: 725_000, beds: 2, baths: 1, sqft: 1200, type: 'sale', image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&h=300&fit=crop', description: 'Cozy bungalow with updated kitchen.' },
  { id: 8, address: '3400 Grand Ave', city: 'Oakland', state: 'CA', zip: '94610', price: 1_150_000, beds: 4, baths: 3, sqft: 2200, type: 'sale', image: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=400&h=300&fit=crop', description: 'Lake Merritt views and a finished basement.' },
  { id: 9, address: '2500 Harrison St', city: 'San Francisco', state: 'CA', zip: '94110', price: 1_650_000, beds: 3, baths: 2, sqft: 1600, type: 'sale', image: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=400&h=300&fit=crop', description: 'Victorian with original details and a garden.' },
  { id: 10, address: '1800 Divisadero St', city: 'San Francisco', state: 'CA', zip: '94115', price: 4_500, beds: 3, baths: 2, sqft: 1400, type: 'rent', image: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&h=300&fit=crop', description: 'Top-floor flat with lots of light.' },
  { id: 11, address: '789 Castro St', city: 'San Francisco', state: 'CA', zip: '94114', price: 1_399_000, beds: 3, baths: 2, sqft: 1850, type: 'sale', image: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop', description: 'Walk to shops and transit. Turn-key condition.' },
  { id: 12, address: '4100 MacArthur Blvd', city: 'Oakland', state: 'CA', zip: '94619', price: 2_100, beds: 3, baths: 2, sqft: 1350, type: 'rent', image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop', description: 'Quiet hills location with parking.' },
]

export function getFeaturedListings(): Listing[] {
  return listings.filter((l) => l.type === 'sale').slice(0, 3)
}

export function getListingById(id: number): Listing | undefined {
  return listings.find((l) => l.id === id)
}
