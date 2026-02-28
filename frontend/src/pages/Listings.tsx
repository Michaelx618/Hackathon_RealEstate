import { useState } from 'react'
import { Link } from 'react-router-dom'
import { listings } from '../data/listings'

function formatPrice(listing: { price: number; type: string }) {
  if (listing.type === 'rent') return `$${listing.price.toLocaleString()}/mo`
  if (listing.price >= 1_000_000) return `$${(listing.price / 1_000_000).toFixed(2)}M`
  return `$${listing.price.toLocaleString()}`
}

const cities = [...new Set(listings.map((l) => l.city))].sort()

export default function Listings() {
  const [cityFilter, setCityFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'sale' | 'rent'>('all')

  const filtered = listings.filter((listing) => {
    const matchCity = !cityFilter || listing.city === cityFilter
    const matchType = typeFilter === 'all' || listing.type === typeFilter
    return matchCity && matchType
  })

  return (
    <div className="page page--listings">
      <h1 className="page__title">All listings</h1>
      <p className="page__subtitle">{listings.length} properties available</p>

      <div className="listings-filters">
        <select
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="listings-filters__select"
          aria-label="Filter by city"
        >
          <option value="">All cities</option>
          {cities.map((city) => (
            <option key={city} value={city}>{city}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'sale' | 'rent')}
          className="listings-filters__select"
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="sale">For sale</option>
          <option value="rent">For rent</option>
        </select>
      </div>

      <div className="listings listings--grid">
        {filtered.map((listing) => (
          <Link to={`/listings/${listing.id}`} key={listing.id} className="listing-card">
            <div className="listing-card__image-wrap">
              <img src={listing.image} alt={listing.address} className="listing-card__image" />
              <span className="listing-card__price">{formatPrice(listing)}</span>
              <span className={`listing-card__badge listing-card__badge--${listing.type}`}>
                {listing.type === 'rent' ? 'Rent' : 'For sale'}
              </span>
            </div>
            <div className="listing-card__body">
              <h3 className="listing-card__address">{listing.address}</h3>
              <p className="listing-card__city">{listing.city}, {listing.state} {listing.zip}</p>
              <ul className="listing-card__meta">
                <li>{listing.beds} beds</li>
                <li>{listing.baths} baths</li>
                <li>{listing.sqft.toLocaleString()} sqft</li>
              </ul>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="listings__empty">No listings match your filters. Try adjusting the filters above.</p>
      )}
    </div>
  )
}
