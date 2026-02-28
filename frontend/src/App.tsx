import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import Listings from './pages/Listings'
import ListingDetail from './pages/ListingDetail'
import About from './pages/About'
import Contact from './pages/Contact'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navbar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/listings" element={<Listings />} />
            <Route path="/listings/:id" element={<ListingDetail />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
