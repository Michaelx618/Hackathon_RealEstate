import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type SupportingDocument = {
  name: string
  mimeType: string
  dataUrl?: string
  textContent?: string
  sizeBytes: number
}

function extractFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

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

function bytesLabel(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function parsePositiveNumber(raw: string): number | undefined {
  const clean = raw.replace(/,/g, '').trim()
  if (!clean) return undefined
  const parsed = Number(clean)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string) || '')
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsText(file)
  })
}

const MAX_FILE_SIZE_MB = 10
const MAX_IMAGE_DIMENSION = 1400
const JPEG_QUALITY = 0.82

function processImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onerror = () => resolve(dataUrl)
      img.onload = () => {
        let { width, height } = img
        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
          resolve(dataUrl)
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
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

async function fileToSupportingDoc(file: File): Promise<SupportingDocument | null> {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(`${file.name} is over ${MAX_FILE_SIZE_MB} MB.`)
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const textLike = file.type.startsWith('text/') || ['txt', 'csv', 'md', 'json', 'tsv'].includes(extension)

  if (file.type.startsWith('image/')) {
    const dataUrl = await processImage(file)
    return {
      name: file.name,
      mimeType: file.type || 'image/jpeg',
      dataUrl,
      sizeBytes: file.size,
    }
  }

  if (file.type === 'application/pdf') {
    const dataUrl = await readAsDataUrl(file)
    return {
      name: file.name,
      mimeType: file.type,
      dataUrl,
      sizeBytes: file.size,
    }
  }

  if (textLike) {
    const textContent = (await readAsText(file)).slice(0, 12000)
    return {
      name: file.name,
      mimeType: file.type || 'text/plain',
      textContent,
      sizeBytes: file.size,
    }
  }

  return null
}

export default function Advisor() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const [currentImagePreview, setCurrentImagePreview] = useState<string | null>(null)
  const [currentImageBase64, setCurrentImageBase64] = useState<string | null>(null)
  const [targetImagePreview, setTargetImagePreview] = useState<string | null>(null)
  const [targetImageBase64, setTargetImageBase64] = useState<string | null>(null)

  const [supportingDocs, setSupportingDocs] = useState<SupportingDocument[]>([])
  const [documentNotes, setDocumentNotes] = useState('')

  const [firstMessage, setFirstMessage] = useState('')
  const [propertyType, setPropertyType] = useState('Single-family house')
  const [renovationLevel, setRenovationLevel] = useState('Mid-range remodel')
  const [location, setLocation] = useState('')
  const [landAreaSqft, setLandAreaSqft] = useState('')
  const [interiorAreaSqft, setInteriorAreaSqft] = useState('')
  const [desiredRentableSqft, setDesiredRentableSqft] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')

  const [searchParams] = useSearchParams()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const currentImageInputRef = useRef<HTMLInputElement>(null)
  const targetImageInputRef = useRef<HTMLInputElement>(null)
  const docsInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const loc = searchParams.get('location')
    if (loc) setLocation(decodeURIComponent(loc))
  }, [searchParams])

  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  const allAssistantText = [...messages, ...(streamingContent ? [{ role: 'assistant' as const, content: streamingContent }] : [])]
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n')

  const phases = extractPhases(allAssistantText)

  const matchedSize = extractFirst(allAssistantText, [
    /\*\*Matched size used for estimate:\*\*\s*([^\n]+)/i,
    /Matched size used for estimate:\s*([^\n]+)/i,
  ])
  const constructionCost = extractFirst(allAssistantText, [
    /\*\*Construction cost:\*\*\s*([^\n]+)/i,
    /\*\*Estimated cost:\*\*\s*([^\n*]+)/i,
    /Construction cost:\s*([^\n]+)/i,
  ])
  const outOfPocket = extractFirst(allAssistantText, [
    /\*\*Total out-of-pocket:\*\*\s*([^\n]+)/i,
    /Total out-of-pocket:\s*([^\n]+)/i,
  ])
  const monthlyRent = extractFirst(allAssistantText, [
    /\*\*Estimated monthly rent:\*\*\s*([^\n]+)/i,
    /Estimated monthly rent:\s*([^\n]+)/i,
  ])
  const annualGross = extractFirst(allAssistantText, [
    /\*\*Estimated annual gross rent:\*\*\s*([^\n]+)/i,
    /Estimated annual gross rent:\s*([^\n]+)/i,
  ])
  const payback = extractFirst(allAssistantText, [
    /\*\*Simple payback:\*\*\s*([^\n]+)/i,
    /Simple payback:\s*([^\n]+)/i,
  ])

  const metricCards = [
    { label: 'Matched Size', value: matchedSize },
    { label: 'Construction Cost', value: constructionCost },
    { label: 'Total Out-of-Pocket', value: outOfPocket },
    { label: 'Monthly Rent', value: monthlyRent },
    { label: 'Annual Gross Rent', value: annualGross },
    { label: 'Simple Payback', value: payback },
  ].filter((item) => Boolean(item.value))

  const handleCurrentImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Current-state upload must be an image file.')
      return
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Current image must be under ${MAX_FILE_SIZE_MB} MB.`)
      return
    }
    setError(null)
    const preview = await readAsDataUrl(file)
    const processed = await processImage(file)
    setCurrentImagePreview(preview)
    setCurrentImageBase64(processed)
  }

  const handleTargetImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Target outcome upload must be an image file.')
      return
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Target image must be under ${MAX_FILE_SIZE_MB} MB.`)
      return
    }
    setError(null)
    const preview = await readAsDataUrl(file)
    const processed = await processImage(file)
    setTargetImagePreview(preview)
    setTargetImageBase64(processed)
  }

  const handleSupportingFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const incoming = Array.from(files).slice(0, 8)
    try {
      const parsed = await Promise.all(incoming.map((file) => fileToSupportingDoc(file)))
      const accepted = parsed.filter((doc): doc is SupportingDocument => Boolean(doc))
      if (accepted.length === 0) {
        setError('No supported files found. Use image, PDF, or text documents.')
        return
      }
      setSupportingDocs((prev) => [...prev, ...accepted].slice(0, 8))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process supporting files.')
    }
  }

  const removeSupportingDoc = (index: number) => {
    setSupportingDocs((prev) => prev.filter((_, i) => i !== index))
  }

  const startSession = async () => {
    if (!currentImageBase64) {
      setError('Please upload a current floor plan or property image first.')
      return
    }

    const land = parsePositiveNumber(landAreaSqft)
    const interior = parsePositiveNumber(interiorAreaSqft)
    const rentable = parsePositiveNumber(desiredRentableSqft)

    setLoading(true)
    setError(null)
    setStreamingContent('')

    try {
      const res = await fetch('/api/advisor/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: currentImageBase64,
          currentImage: currentImageBase64,
          targetImage: targetImageBase64 || undefined,
          supportingDocs: supportingDocs.map((doc) => ({
            name: doc.name,
            mimeType: doc.mimeType,
            dataUrl: doc.dataUrl,
            textContent: doc.textContent,
          })),
          documentNotes: documentNotes.trim() || undefined,
          firstMessage: firstMessage.trim() || undefined,
          propertyType: propertyType || undefined,
          renovationLevel: renovationLevel || undefined,
          location: location.trim() || undefined,
          landAreaSqft: land,
          interiorAreaSqft: interior,
          desiredRentableSqft: rentable,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = data?.error as string | undefined
        if (res.status === 503 && (msg?.includes('OPENAI_API_KEY') || msg?.includes('not configured'))) {
          throw new Error('The advisor is not configured yet (OPENAI_API_KEY missing).')
        }
        throw new Error(msg || `Request failed: ${res.status}`)
      }

      const sid = res.headers.get('X-Session-Id')
      if (sid) setSessionId(sid)

      const tags: string[] = []
      if (propertyType) tags.push(propertyType)
      if (location.trim()) tags.push(location.trim())
      if (renovationLevel) tags.push(renovationLevel)
      const prefix = tags.length > 0 ? `[${tags.join(' | ')}] ` : ''
      const userText = firstMessage.trim() || 'Estimate construction cost, total out-of-pocket, and rental return.'
      setMessages([{ role: 'user', content: `${prefix}${userText}` }])

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
          throw new Error('The advisor is not configured yet (OPENAI_API_KEY missing).')
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
    setCurrentImagePreview(null)
    setCurrentImageBase64(null)
    setTargetImagePreview(null)
    setTargetImageBase64(null)
    setSupportingDocs([])
    setDocumentNotes('')
    setFirstMessage('')
    setPropertyType('Single-family house')
    setRenovationLevel('Mid-range remodel')
    setLocation('')
    setLandAreaSqft('')
    setInteriorAreaSqft('')
    setDesiredRentableSqft('')
    setStreamingContent('')
    setError(null)
    if (currentImageInputRef.current) currentImageInputRef.current.value = ''
    if (targetImageInputRef.current) targetImageInputRef.current.value = ''
    if (docsInputRef.current) docsInputRef.current.value = ''
  }

  return (
    <div className="page page--advisor">
      <h1 className="page__title">Construction cost + return advisor</h1>
      <p className="page__lead">
        Upload the current property image or floor plan, optionally add supporting documents and a target-outcome image,
        then get construction cost, total out-of-pocket, and rental return estimates.
      </p>
      <p className="advisor-disclaimer">
        Documents are optional but improve estimate accuracy. This tool is for planning only and is not legal,
        engineering, or financial advice.
      </p>

      {!sessionId && (
        <section className="advisor-features" aria-label="How it works">
          <h2 className="advisor-features__title">How this estimate is built</h2>
          <ul className="advisor-features__list">
            <li><strong>Current + target image comparison</strong> to estimate work scope and renovation complexity.</li>
            <li><strong>Optional docs</strong> (PDF/text/image) to cross-check floor area and land data.</li>
            <li><strong>Out-of-pocket calculation</strong> covering construction plus permit/soft-cost assumptions.</li>
            <li><strong>Rental return estimate</strong> using public market rent benchmarks and matched rentable area.</li>
            <li><strong>Zoning-aware checks</strong> with Toronto zoning map reference when relevant.</li>
          </ul>
          <div className="advisor-sources">
            <strong>Public data references:</strong>{' '}
            <a href="https://map.toronto.ca/maps/map.jsp?app=ZBL_CONSULT" target="_blank" rel="noreferrer">Toronto Zoning Map</a>
            {' | '}
            <a href="https://www.toronto.ca/services-payments/building-construction/building-fees/building-permit-fees/" target="_blank" rel="noreferrer">Toronto Permit Fees</a>
            {' | '}
            <a href="https://rentals.ca/national-rent-report" target="_blank" rel="noreferrer">Rentals.ca Rent Report</a>
            {' | '}
            <a href="https://urbanation.ca/news/q2-2025-condominium-rental-market-survey" target="_blank" rel="noreferrer">Urbanation Rent Survey</a>
          </div>
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
              placeholder="e.g. Toronto, ON"
              className="advisor-upload__text"
              aria-label="Address, city, or ZIP"
            />
          </label>

          <div className="advisor-upload__subgrid">
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

            <label className="advisor-upload__label">
              Renovation level
              <select
                value={renovationLevel}
                onChange={(e) => setRenovationLevel(e.target.value)}
                className="advisor-upload__select"
                aria-label="Renovation level"
              >
                <option value="Cosmetic refresh">Cosmetic refresh</option>
                <option value="Mid-range remodel">Mid-range remodel</option>
                <option value="Full gut + reconfiguration">Full gut + reconfiguration</option>
              </select>
            </label>
          </div>

          <label className="advisor-upload__label">Current property image / floor plan (required)</label>
          <div
            className="advisor-upload__zone"
            onClick={() => currentImageInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('advisor-upload__zone--drag') }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('advisor-upload__zone--drag') }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('advisor-upload__zone--drag')
              const file = e.dataTransfer.files[0]
              if (file) handleCurrentImageFile(file)
            }}
          >
            <input
              ref={currentImageInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleCurrentImageFile(file)
              }}
              className="advisor-upload__input"
              aria-label="Upload current property image"
            />
            {currentImagePreview ? (
              <img src={currentImagePreview} alt="Current property preview" className="advisor-upload__preview" />
            ) : (
              <span className="advisor-upload__placeholder">Drop current image here or click to browse</span>
            )}
          </div>

          <label className="advisor-upload__label">Target outcome image (optional)</label>
          <div
            className="advisor-upload__zone"
            onClick={() => targetImageInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('advisor-upload__zone--drag') }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('advisor-upload__zone--drag') }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('advisor-upload__zone--drag')
              const file = e.dataTransfer.files[0]
              if (file) handleTargetImageFile(file)
            }}
          >
            <input
              ref={targetImageInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleTargetImageFile(file)
              }}
              className="advisor-upload__input"
              aria-label="Upload target image"
            />
            {targetImagePreview ? (
              <img src={targetImagePreview} alt="Target outcome preview" className="advisor-upload__preview" />
            ) : (
              <span className="advisor-upload__placeholder">Optional: upload a reference outcome image</span>
            )}
          </div>

          <label className="advisor-upload__label">
            Supporting documents (optional)
            <input
              ref={docsInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,text/*,application/pdf,application/json"
              onChange={(e) => handleSupportingFiles(e.target.files)}
              className="advisor-upload__text"
              aria-label="Upload supporting documents"
            />
          </label>

          {supportingDocs.length > 0 && (
            <div className="advisor-docs">
              {supportingDocs.map((doc, index) => (
                <div key={`${doc.name}-${index}`} className="advisor-docs__item">
                  <div>
                    <strong>{doc.name}</strong>
                    <span>{doc.mimeType} • {bytesLabel(doc.sizeBytes)}</span>
                  </div>
                  <button type="button" className="btn btn--secondary" onClick={() => removeSupportingDoc(index)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="advisor-upload__subgrid">
            <label className="advisor-upload__label">
              Land size (sqft, optional)
              <input
                type="text"
                value={landAreaSqft}
                onChange={(e) => setLandAreaSqft(e.target.value)}
                placeholder="e.g. 4000"
                className="advisor-upload__text"
              />
            </label>
            <label className="advisor-upload__label">
              Interior size (sqft, optional)
              <input
                type="text"
                value={interiorAreaSqft}
                onChange={(e) => setInteriorAreaSqft(e.target.value)}
                placeholder="e.g. 1400"
                className="advisor-upload__text"
              />
            </label>
            <label className="advisor-upload__label">
              Desired rentable area (sqft, optional)
              <input
                type="text"
                value={desiredRentableSqft}
                onChange={(e) => setDesiredRentableSqft(e.target.value)}
                placeholder="e.g. 900"
                className="advisor-upload__text"
              />
            </label>
          </div>

          <label className="advisor-upload__label">
            Notes from documents (optional)
            <textarea
              value={documentNotes}
              onChange={(e) => setDocumentNotes(e.target.value)}
              placeholder="Any known room dimensions, lot details, permit constraints, etc."
              className="advisor-chat__input"
              rows={3}
            />
          </label>

          <label className="advisor-upload__label">
            What do you want to build?
            <input
              type="text"
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="e.g. Add a legal basement suite and optimize for long-term rental"
              className="advisor-upload__text"
            />
          </label>

          {error && <p className="advisor-upload__error">{error}</p>}
          <button
            type="button"
            className="btn btn--primary"
            onClick={startSession}
            disabled={!currentImageBase64 || loading}
          >
            {loading ? 'Calculating…' : 'Calculate project economics'}
          </button>
        </section>
      ) : (
        <section className="advisor-chat">
          {metricCards.length > 0 && (
            <div className="advisor-metrics" role="status" aria-label="Financial summary cards">
              {metricCards.map((metric) => (
                <div className="advisor-metric-card" key={metric.label}>
                  <span className="advisor-metric-card__label">{metric.label}</span>
                  <span className="advisor-metric-card__value">{metric.value}</span>
                </div>
              ))}
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Ask for scenario changes, sensitivity checks, or more precise assumptions..."
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
                    navigator.clipboard.writeText(allAssistantText).then(() => alert('Estimate copied to clipboard.'))
                  }}
                >
                  Copy estimate
                </button>
              )}
              <button type="button" className="btn btn--secondary" onClick={reset}>
                New project
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
