import { useParams, Link } from 'react-router-dom'
import { getListingById } from '../data/listings'

function formatPrice(listing: { price: number; type: string }) {
  if (listing.type === 'rent') return `$${listing.price.toLocaleString()}/mo`
  if (listing.price >= 1_000_000) return `$${(listing.price / 1_000_000).toFixed(2)}M`
  return `$${listing.price.toLocaleString()}`
}

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>()
  const listing = id ? getListingById(Number(id)) : undefined

  if (!listing) {
    return (
      <div className="page">
        <Link to="/listings" className="section__link">← Back to listings</Link>
        <h1>Listing not found</h1>
        <p>This property may have been removed or the link is incorrect.</p>
      </div>
    )
  }

  return (
    <div className="page page--detail">
      <Link to="/listings" className="section__link">← Back to listings</Link>
      <div className="detail">
        <div className="detail__image-wrap">
          <img src={listing.image} alt={listing.address} className="detail__image" />
          <span className={`detail__badge detail__badge--${listing.type}`}>
            {listing.type === 'rent' ? 'For rent' : 'For sale'}
          </span>
        </div>
        <div className="detail__content">
          <h1 className="detail__address">{listing.address}</h1>
          <p className="detail__location">{listing.city}, {listing.state} {listing.zip}</p>
          <p className="detail__price">{formatPrice(listing)}</p>
          <ul className="detail__meta">
            <li>{listing.beds} beds</li>
            <li>{listing.baths} baths</li>
            <li>{listing.sqft.toLocaleString()} sqft</li>
          </ul>
          {listing.description && (
            <p className="detail__description">{listing.description}</p>
          )}
          <button type="button" className="btn btn--primary">Schedule a tour</button>
        </div>
      </div>
    </div>
  )
}
