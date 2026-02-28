import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (saved) return saved
    } catch (e) {}
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  })

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    try { localStorage.setItem('theme', theme) } catch (e) {}
  }, [theme])

  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  return (
    <nav className="navbar">
      <Link to="/" className="navbar__brand">
        HomeKey
      </Link>
      <ul className="navbar__links">
        <li><Link to="/">Home</Link></li>
        <li><Link to="/listings">Listings</Link></li>
        <li><Link to="/advisor">Design & renovate</Link></li>
        <li><Link to="/about">About</Link></li>
        <li><Link to="/contact">Contact</Link></li>
      </ul>

      <div className="navbar__settings" ref={ref}>
        <button
          className="settings__button"
          aria-label="Open settings"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}
        >
          ⚙️
        </button>

        {menuOpen && (
          <div className="settings__menu" role="menu">
            <label className="settings__item">
              <span>Dark mode</span>
              <div className="switch">
                <input
                  type="checkbox"
                  checked={theme === 'dark'}
                  onChange={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
                />
                <span className="slider" />
              </div>
            </label>
          </div>
        )}
      </div>
    </nav>
  )
}
