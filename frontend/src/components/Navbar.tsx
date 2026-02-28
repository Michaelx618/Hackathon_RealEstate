import { Link } from 'react-router-dom'

export default function Navbar() {
  return (
    <nav className="navbar">
      <Link to="/" className="navbar__brand">
        HomeKey
      </Link>
      <ul className="navbar__links">
        <li><Link to="/">Home</Link></li>
        <li><Link to="/listings">Listings</Link></li>
        <li><Link to="/about">About</Link></li>
        <li><Link to="/contact">Contact</Link></li>
      </ul>
    </nav>
  )
}
