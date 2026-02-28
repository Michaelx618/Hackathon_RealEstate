import { Link } from 'react-router-dom'

const featuredListings = [
  { id: 1, address: '124 Oak Street', city: 'San Francisco', price: 1_250_000, beds: 4, baths: 3, sqft: 2400, image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop' },
  { id: 2, address: '88 Marina Blvd', city: 'San Francisco', price: 2_100_000, beds: 5, baths: 4, sqft: 3200, image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop' },
  { id: 3, address: '456 Pine Ave', city: 'Oakland', price: 895_000, beds: 3, baths: 2, sqft: 1800, image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop' },
]

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero__content">
          <h1 className="hero__title">Find your next home</h1>
          <p className="hero__subtitle">
            Browse thousands of listings. Buy or rent with confidence.
          </p>
          <div className="hero__search">
            <input type="text" placeholder="City, neighborhood, or ZIP" className="hero__input" />
            <select className="hero__select" aria-label="Listing type">
              <option>For Sale</option>
              <option>For Rent</option>
            </select>
            <button type="button" className="hero__btn">Search</button>
          </div>
        </div>
      </section>

      <section className="section featured">
        <h2 className="section__title">Featured listings</h2>
        <div className="listings">
          {featuredListings.map((listing) => (
            <Link to={`/listings/${listing.id}`} key={listing.id} className="listing-card">
              <div className="listing-card__image-wrap">
                <img src={listing.image} alt={listing.address} className="listing-card__image" />
                <span className="listing-card__price">
                  ${(listing.price / 1_000_000).toFixed(2)}M
                </span>
              </div>
              <div className="listing-card__body">
                <h3 className="listing-card__address">{listing.address}</h3>
                <p className="listing-card__city">{listing.city}</p>
                <ul className="listing-card__meta">
                  <li>{listing.beds} beds</li>
                  <li>{listing.baths} baths</li>
                  <li>{listing.sqft.toLocaleString()} sqft</li>
                </ul>
              </div>
            </Link>
          ))}
        </div>
        <Link to="/listings" className="section__link">View all listings →</Link>
      </section>

      <section className="section cta">
        <h2 className="section__title">Sell or rent with us</h2>
        <p className="cta__text">
          List your property and reach millions of buyers and renters.
        </p>
        <button type="button" className="btn btn--primary">Get started</button>
      </section>
    </>
  )
}
