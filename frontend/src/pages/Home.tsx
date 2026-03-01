import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getFeaturedListings } from '../data/listings'
import ListingPopup from '../components/ListingPopup'
import type { Listing } from '../data/listings'

function formatPrice(listing: { price: number; type: string }) {
  if (listing.type === 'rent') return `$${listing.price.toLocaleString()}/mo`
  if (listing.price >= 1_000_000) return `$${(listing.price / 1_000_000).toFixed(2)}M`
  return `$${listing.price.toLocaleString()}`
}

export default function Home() {
  const featuredListings = getFeaturedListings()
  const [location, setLocation] = useState('')
  const [popupListing, setPopupListing] = useState<Listing | null>(null)
  const navigate = useNavigate()

  const handleSearch = () => {
    const q = location.trim()
    if (q) navigate(`/advisor?location=${encodeURIComponent(q)}`)
    else navigate('/advisor')
  }

  return (
    <>
      <section className="hero">
        <div className="hero__content">
          <h1 className="hero__title">Design & renovate your property</h1>
          <p className="hero__subtitle">
            Planning to convert your house into an Airbnb, add a suite, or turn it into a multi-unit? Get a custom renovation plan—layout, costs, permits, and design—from one photo.
          </p>
          <div className="hero__search">
            <input
              type="text"
              placeholder="Address, city, or ZIP"
              className="hero__input"
              aria-label="Address, city, or ZIP"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button type="button" className="hero__btn" onClick={handleSearch}>
              Start my renovation plan
            </button>
          </div>
          <p className="hero__hint">We use your location to tailor permits, zoning, and cost estimates for your area.</p>
        </div>
      </section>

      <section className="section featured">
        <h2 className="section__title">Example properties</h2>
        <p className="section__subtitle">Browse sample listings or jump straight to designing your own.</p>
        <div className="listings">
          {featuredListings.map((listing) => (
            <button
              type="button"
              key={listing.id}
              className="listing-card listing-card--button"
              onClick={() => setPopupListing(listing)}
            >
              <div className="listing-card__image-wrap">
                <img src={listing.image} alt={listing.address} className="listing-card__image" />
                <span className="listing-card__price">{formatPrice(listing)}</span>
              </div>
              <div className="listing-card__body">
                <h3 className="listing-card__address">{listing.address}</h3>
                <p className="listing-card__city">{listing.city}, {listing.state}</p>
                <ul className="listing-card__meta">
                  <li>{listing.beds} beds</li>
                  <li>{listing.baths} baths</li>
                  <li>{listing.sqft.toLocaleString()} sqft</li>
                </ul>
              </div>
            </button>
          ))}
        </div>
        <ListingPopup listing={popupListing} onClose={() => setPopupListing(null)} />
        <Link to="/listings" className="section__link">View all listings →</Link>
      </section>

      <section className="section cta">
        <h2 className="section__title">Ready to design your conversion?</h2>
        <p className="section__subtitle">
          Upload your floor plan and get AI-powered advice for renovating, adding suites, or converting to short-term rental.
        </p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/advisor')}>Design & renovate</button>
      </section>
    </>
  )
}
