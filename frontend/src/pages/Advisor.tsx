import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

/** Extract first "Estimated cost: ..." line from text for the cost highlight card. */
function extractEstimatedCost(text: string): string | null {
  const patterns = [
    /\*\*Estimated cost:\*\*\s*([^\n*]+)/i,
    /Estimated cost:\s*([^\n]+)/i,
    /\*\*Cost[^:*]*:\*\*\s*([^\n*]+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

/** Extract Phase 1, Phase 2, ... from assistant text for the timeline graph. */
function extractPhases(text: string): { phase: number; label: string }[] {
  const phases: { phase: number; label: string }[] = []
  const re = /\*\*Phase\s*(\d+):\*\*\s*([^\n*]+)/gi
  let m
  while ((m = re.exec(text)) !== null) {
    phases.push({ phase: Number(m[1]), label: m[2].trim() })
  }
  if (phases.length > 0) return phases
  const altRe = /(?:^|\n)(?:Phase\s*)?(\d+)[.:]\s*([^\n]+)/gi
  while ((m = altRe.exec(text)) !== null) {
    const num = Number(m[1])
    if (num >= 1 && num <= 10) phases.push({ phase: num, label: m[2].trim() })
  }
  return phases.slice(0, 6)
}

export default function Advisor() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [firstMessage, setFirstMessage] = useState('')
  const [propertyType, setPropertyType] = useState('Single-family house')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const loc = searchParams.get('location')
    if (loc) setLocation(decodeURIComponent(loc))
  }, [searchParams])
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  const allAssistantText = [...messages, ...(streamingContent ? [{ role: 'assistant' as const, content: streamingContent }] : [])]
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n')
  const estimatedCostLine = extractEstimatedCost(allAssistantText)
  const phases = extractPhases(allAssistantText)

  const MAX_FILE_SIZE_MB = 10
  const MAX_IMAGE_DIMENSION = 1200
  const JPEG_QUALITY = 0.82

  /** Resize and compress image to reduce payload and API cost; keeps preview full-size. */
  function processImage(file: File, onDone: (dataUrl: string) => void) {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
          onDone(dataUrl)
          return
        }
        const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          onDone(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const processed = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        onDone(processed)
      }
      img.onerror = () => onDone(dataUrl)
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (e.g. JPEG, PNG).')
      return
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Image must be under ${MAX_FILE_SIZE_MB} MB.`)
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImagePreview(dataUrl)
    }
    reader.readAsDataURL(file)
    processImage(file, (processed) => setImageBase64(processed))
  }

  const startSession = async () => {
    if (!imageBase64) {
      setError('Please upload a floor plan image first.')
      return
    }
    setLoading(true)
    setError(null)
    setStreamingContent('')
    try {
      const res = await fetch('/api/advisor/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageBase64,
          firstMessage: firstMessage.trim() || undefined,
          propertyType: propertyType || undefined,
          location: location.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = data?.error as string | undefined
        if (res.status === 503 && (msg?.includes('OPENAI_API_KEY') || msg?.includes('not configured'))) {
          throw new Error('The advisor isn’t configured yet (API key missing). Your team will add it for hosting.')
        }
        throw new Error(msg || `Request failed: ${res.status}`)
      }
      const sid = res.headers.get('X-Session-Id')
      if (sid) setSessionId(sid)
      const parts = []
      if (propertyType) parts.push(`[${propertyType}]`)
      if (location.trim()) parts.push(`Location: ${location.trim()}`)
      const userLabel = parts.length ? parts.join(' ') + ' ' : ''
      const userText = firstMessage.trim() ? `${userLabel}${firstMessage.trim()}` : `${userLabel}Here's my floor plan. Please analyze it.`
      setMessages([{ role: 'user', content: userText }])
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        let content = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          content += decoder.decode(value, { stream: true })
          setStreamingContent(content)
          scrollToBottom()
        }
        setMessages((prev) => [...prev, { role: 'assistant', content }])
        setStreamingContent('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !sessionId) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setStreamingContent('')
    setLoading(true)
    setError(null)
    scrollToBottom()
    try {
      const res = await fetch('/api/advisor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = data?.error as string | undefined
        if (res.status === 503 && (msg?.includes('OPENAI_API_KEY') || msg?.includes('not configured'))) {
          throw new Error('The advisor isn’t configured yet (API key missing). Your team will add it for hosting.')
        }
        throw new Error(msg || `Request failed: ${res.status}`)
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        let content = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          content += decoder.decode(value, { stream: true })
          setStreamingContent(content)
          scrollToBottom()
        }
        setMessages((prev) => [...prev, { role: 'assistant', content }])
        setStreamingContent('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setSessionId(null)
    setMessages([])
    setImagePreview(null)
    setImageBase64(null)
    setFirstMessage('')
    setPropertyType('Single-family house')
    setLocation('')
    setStreamingContent('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="page page--advisor">
      <h1 className="page__title">Design & renovation advisor</h1>
      <p className="page__lead">
        Planning to convert your house to an Airbnb, add a suite, or create rental units? Upload your floor plan and get tailored renovation ideas, layout changes, cost estimates, and permit guidance—then chat for more detail.
      </p>
      <p className="advisor-disclaimer">
        Advice is for planning only. Not legal or professional advice; always confirm permits and local rules with your city or a professional.
      </p>

      {!sessionId && (
        <section className="advisor-features" aria-label="How it works">
          <h2 className="advisor-features__title">Built for conversions & renovations</h2>
          <ul className="advisor-features__list">
            <li><strong>Convert to Airbnb or suites</strong> — Get layout and design ideas for turning your house into short-term rental or adding a separate suite or unit.</li>
            <li><strong>Property-type aware</strong> — Same floor plan, different advice for a condo vs single-family (HOA, bylaws, ADU potential).</li>
            <li><strong>From photo to plan</strong> — One upload → renovation ideas, layout changes, cost ballparks, and permit reminders.</li>
            <li><strong>Legal-aware, not legal advice</strong> — We flag permits and zoning and remind you to check with local authorities.</li>
            <li><strong>Cost in plain language</strong> — Estimated cost ranges in every reply so you can plan ahead.</li>
          </ul>
        </section>
      )}

      {!sessionId ? (
        <section className="advisor-upload">
          <label className="advisor-upload__label">
            Address, city, or ZIP
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 123 Main St, San Francisco or 94102"
              className="advisor-upload__text"
              aria-label="Address, city, or ZIP"
            />
          </label>
          <label className="advisor-upload__label">
            Property type
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="advisor-upload__select"
              aria-label="Property type"
            >
              <option value="Single-family house">Single-family house</option>
              <option value="Townhouse">Townhouse</option>
              <option value="Apartment">Apartment</option>
              <option value="Condo">Condo</option>
              <option value="Suite">Suite</option>
              <option value="Multi-family">Multi-family</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <div
            className="advisor-upload__zone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('advisor-upload__zone--drag'); }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('advisor-upload__zone--drag'); }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('advisor-upload__zone--drag')
              const file = e.dataTransfer.files[0]
              if (file?.type.startsWith('image/') && file.size <= MAX_FILE_SIZE_MB * 1024 * 1024) {
                const reader = new FileReader()
                reader.onload = () => {
                  setImagePreview(reader.result as string)
                }
                reader.readAsDataURL(file)
                processImage(file, (processed) => setImageBase64(processed))
              } else if (file?.type.startsWith('image/')) {
                setError(`Image must be under ${MAX_FILE_SIZE_MB} MB.`)
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="advisor-upload__input"
              aria-label="Upload floor plan"
            />
            {imagePreview ? (
              <img src={imagePreview} alt="Floor plan preview" className="advisor-upload__preview" />
            ) : (
              <span className="advisor-upload__placeholder">Drop a floor plan image here or click to browse</span>
            )}
          </div>
          <label className="advisor-upload__label">
            Optional: What’s your goal?
            <input
              type="text"
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="e.g. Convert to Airbnb, add a suite, create two units"
              className="advisor-upload__text"
            />
          </label>
          {error && <p className="advisor-upload__error">{error}</p>}
          <button
            type="button"
            className="btn btn--primary"
            onClick={startSession}
            disabled={!imageBase64 || loading}
          >
            {loading ? 'Analyzing…' : 'Analyze layout'}
          </button>
        </section>
      ) : (
        <section className="advisor-chat">
          {estimatedCostLine && (
            <div className="advisor-cost-card" role="status">
              <span className="advisor-cost-card__label">Estimated cost</span>
              <span className="advisor-cost-card__value">{estimatedCostLine}</span>
            </div>
          )}
          {phases.length > 0 && (
            <div className="advisor-timeline" role="region" aria-label="Renovation plan phases">
              <h3 className="advisor-timeline__title">Renovation plan</h3>
              <div className="advisor-timeline__graph">
                {phases.map((p, i) => (
                  <div key={p.phase} className="advisor-timeline__phase">
                    <span className="advisor-timeline__phase-num">Phase {p.phase}</span>
                    <span className="advisor-timeline__phase-label">{p.label}</span>
                    {i < phases.length - 1 && <span className="advisor-timeline__connector" aria-hidden />}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="advisor-chat__messages">
            {messages.map((m, i) => (
              <div key={i} className={`advisor-chat__msg advisor-chat__msg--${m.role}`}>
                <span className="advisor-chat__role">{m.role === 'user' ? 'You' : 'Advisor'}</span>
                <div className="advisor-chat__content">{m.content}</div>
              </div>
            ))}
            {streamingContent && (
              <div className="advisor-chat__msg advisor-chat__msg--assistant">
                <span className="advisor-chat__role">Advisor</span>
                <div className="advisor-chat__content">{streamingContent}</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {error && <p className="advisor-chat__error">{error}</p>}
          <div className="advisor-chat__input-wrap">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask for more details on renovation, cost, or design…"
              className="advisor-chat__input"
              rows={2}
              disabled={loading}
            />
            <div className="advisor-chat__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
              >
                {loading ? 'Thinking…' : 'Send'}
              </button>
              {allAssistantText && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(allAssistantText).then(() => alert('Plan copied to clipboard.'))
                  }}
                >
                  Copy plan
                </button>
              )}
              <button type="button" className="btn btn--secondary" onClick={reset}>
                New layout
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
