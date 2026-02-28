import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="page">
      <h1 className="page__title">Page not found</h1>
      <p className="page__lead">The page you’re looking for doesn’t exist.</p>
      <Link to="/" className="btn btn--primary">Back to home</Link>
    </div>
  )
}
