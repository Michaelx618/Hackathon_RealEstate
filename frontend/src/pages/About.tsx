import { Link } from 'react-router-dom'

export default function About() {
  return (
    <div className="page page--about">
      <h1 className="page__title">About HomeKey</h1>
      <p className="page__lead">
        We help people find and sell homes with transparency, care, and less stress.
      </p>

      <section className="about-block">
        <h2>Our mission</h2>
        <p>
          HomeKey was built to make buying, selling, and renting simpler. We combine local expertise with modern tools so you can search listings, compare neighborhoods, and connect with agents in one place. Whether you’re a first-time buyer or a seasoned investor, we’re here to help you move with confidence.
        </p>
      </section>

      <section className="about-block">
        <h2>What we do</h2>
        <ul className="about-list">
          <li><strong>Listings</strong> — Browse for-sale and for-rent properties with up-to-date info and photos.</li>
          <li><strong>Neighborhoods</strong> — Learn about schools, transit, and local trends before you commit.</li>
          <li><strong>Agents & support</strong> — Get in touch with our team for questions, tours, and offers.</li>
        </ul>
      </section>

      <section className="about-block about-stats">
        <h2>By the numbers</h2>
        <div className="stats">
          <div className="stats__item">
            <span className="stats__value">10k+</span>
            <span className="stats__label">Listings</span>
          </div>
          <div className="stats__item">
            <span className="stats__value">50+</span>
            <span className="stats__label">Cities</span>
          </div>
          <div className="stats__item">
            <span className="stats__value">100+</span>
            <span className="stats__label">Agent partners</span>
          </div>
        </div>
      </section>

      <section className="about-block">
        <h2>Get in touch</h2>
        <p>
          Have questions or want to list your property? Visit our <Link to="/contact">Contact</Link> page or reach out at <a href="mailto:hello@homekey.com">hello@homekey.com</a>.
        </p>
      </section>
    </div>
  )
}
