import { useParams, Link } from 'react-router-dom'

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="page">
      <Link to="/listings" className="section__link">← Back to listings</Link>
      <h1>Listing #{id}</h1>
      <p>Listing detail page coming soon.</p>
    </div>
  )
}
