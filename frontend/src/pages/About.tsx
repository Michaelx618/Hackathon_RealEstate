import { Link } from 'react-router-dom'

export default function About() {
  return (
    <div className="page page--about">
      <h1 className="page__title">About HomeKey</h1>
      <p className="page__lead">
        We help people design and renovate their properties—especially when converting to Airbnb, adding suites, or turning a house into multiple rental units.
      </p>

      <section className="about-block">
        <h2>Our mission</h2>
        <p>
          HomeKey is built for homeowners and investors who want to renovate or convert their property. Whether you’re turning a basement into a suite, splitting a house for short-term rental, or planning an ADU, our AI advisor uses your floor plan and location to suggest layouts, ballpark costs, permits, and design—so you can plan with confidence before talking to contractors or lawyers.
        </p>
      </section>

      <section className="about-block">
        <h2>What we do</h2>
        <ul className="about-list">
          <li><strong>Design & renovation advisor</strong> — Upload your floor plan; get tailored ideas for converting to Airbnb, adding suites, or creating rental units, plus cost and permit guidance.</li>
          <li><strong>Location-aware advice</strong> — We use your city or ZIP to tailor permits, zoning, and cost estimates to your area.</li>
          <li><strong>Example listings</strong> — Browse sample properties for inspiration; the main tool is the renovation advisor.</li>
        </ul>
      </section>

      <section className="about-block about-stats">
        <h2>By the numbers</h2>
        <div className="stats">
          <div className="stats__item">
            <span className="stats__value">Design</span>
            <span className="stats__label">Renovation plans</span>
          </div>
          <div className="stats__item">
            <span className="stats__value">Convert</span>
            <span className="stats__label">Airbnb & suites</span>
          </div>
          <div className="stats__item">
            <span className="stats__value">Plan</span>
            <span className="stats__label">Costs & permits</span>
          </div>
        </div>
      </section>

      <section className="about-block">
        <h2>Get in touch</h2>
        <p>
          Questions about the renovation advisor or your project? Visit our <Link to="/contact">Contact</Link> page or reach out at <a href="mailto:hello@homekey.com">hello@homekey.com</a>.
        </p>
      </section>
    </div>
  )
}
