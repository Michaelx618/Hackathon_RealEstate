import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Listing } from '../data/listings'

function formatPrice(listing: { price: number; type: string }) {
  if (listing.type === 'rent') return `$${listing.price.toLocaleString()}/mo`
  if (listing.price >= 1_000_000) return `$${(listing.price / 1_000_000).toFixed(2)}M`
  return `$${listing.price.toLocaleString()}`
}

/** Sample layout rooms for popup display */
const SAMPLE_LAYOUT = [
  { label: 'Living', area: '320 sqft' },
  { label: 'Kitchen', area: '180 sqft' },
  { label: 'Dining', area: '140 sqft' },
  { label: 'Bed 1', area: '220 sqft' },
  { label: 'Bed 2', area: '160 sqft' },
  { label: 'Bath', area: '90 sqft' },
  { label: 'Bed 3', area: '150 sqft' },
]

type Props = {
  listing: Listing | null
  onClose: () => void
}

export default function ListingPopup({ listing, onClose }: Props) {
  useEffect(() => {
    if (!listing) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [listing, onClose])

  if (!listing) return null

  return (
    <div
      className="listing-popup__backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="listing-popup-title"
    >
      <div className="listing-popup">
        <button
          type="button"
          className="listing-popup__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <div className="listing-popup__image-wrap">
          <img src={listing.image} alt={listing.address} className="listing-popup__image" />
          <span className={`listing-popup__badge listing-popup__badge--${listing.type}`}>
            {listing.type === 'rent' ? 'For rent' : 'For sale'}
          </span>
        </div>

        <div className="listing-popup__body">
          <h2 id="listing-popup-title" className="listing-popup__address">
            {listing.address}
          </h2>
          <p className="listing-popup__location">
            {listing.city}, {listing.state} {listing.zip}
          </p>
          <p className="listing-popup__price">{formatPrice(listing)}</p>
          <ul className="listing-popup__meta">
            <li>{listing.beds} beds</li>
            <li>{listing.baths} baths</li>
            <li>{listing.sqft.toLocaleString()} sqft</li>
          </ul>
          {listing.description && (
            <p className="listing-popup__description">{listing.description}</p>
          )}

          <div className="listing-popup__layout">
            <h3 className="listing-popup__layout-title">Sample layout</h3>
            <p className="listing-popup__layout-hint">
              Approximate room distribution for a {listing.sqft.toLocaleString()} sqft home.
            </p>
            <div className="listing-popup__layout-grid">
              {SAMPLE_LAYOUT.map((room) => (
                <div key={room.label} className="listing-popup__layout-room">
                  <span className="listing-popup__layout-room-label">{room.label}</span>
                  <span className="listing-popup__layout-room-area">{room.area}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="listing-popup__actions">
            <Link
              to={`/listings/${listing.id}`}
              className="btn btn--primary"
              onClick={onClose}
            >
              View full details
            </Link>
            <button type="button" className="btn listing-popup__btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
