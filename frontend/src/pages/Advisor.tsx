import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type ImageBatch = {
  previews: string[]
  encoded: string[]
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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

const MAX_FILE_SIZE_MB = 10
const MAX_IMAGE_DIMENSION = 1400
const JPEG_QUALITY = 0.82
const MAX_IMAGES_PER_BOX = 8

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

async function processImageFiles(files: File[], label: string): Promise<ImageBatch> {
  const previews: string[] = []
  const encoded: string[] = []

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      throw new Error(`${label} upload only accepts image files.`)
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      throw new Error(`${file.name} is over ${MAX_FILE_SIZE_MB} MB.`)
    }

    previews.push(await readAsDataUrl(file))
    encoded.push(await processImage(file))
  }

  return { previews, encoded }
}

export default function Advisor() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const [currentImagePreviews, setCurrentImagePreviews] = useState<string[]>([])
  const [currentImagesBase64, setCurrentImagesBase64] = useState<string[]>([])
  const [targetImagePreviews, setTargetImagePreviews] = useState<string[]>([])
  const [targetImagesBase64, setTargetImagesBase64] = useState<string[]>([])

  const [currentHouseStatus, setCurrentHouseStatus] = useState('')
  const [firstMessage, setFirstMessage] = useState('')
  const [location, setLocation] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')

  const [searchParams] = useSearchParams()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const currentImageInputRef = useRef<HTMLInputElement>(null)
  const targetImageInputRef = useRef<HTMLInputElement>(null)

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

  const addCurrentImages = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return

    const slotsLeft = MAX_IMAGES_PER_BOX - currentImagesBase64.length
    if (slotsLeft <= 0) {
      setError(`Current image box can store up to ${MAX_IMAGES_PER_BOX} images.`)
      return
    }

    try {
      const selected = Array.from(fileList).slice(0, slotsLeft)
      const batch = await processImageFiles(selected, 'Current house')
      setCurrentImagePreviews((prev) => [...prev, ...batch.previews])
      setCurrentImagesBase64((prev) => [...prev, ...batch.encoded])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process current house images.')
    }
  }

  const addTargetImages = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return

    const slotsLeft = MAX_IMAGES_PER_BOX - targetImagesBase64.length
    if (slotsLeft <= 0) {
      setError(`Modified plan image box can store up to ${MAX_IMAGES_PER_BOX} images.`)
      return
    }

    try {
      const selected = Array.from(fileList).slice(0, slotsLeft)
      const batch = await processImageFiles(selected, 'Modified plan')
      setTargetImagePreviews((prev) => [...prev, ...batch.previews])
      setTargetImagesBase64((prev) => [...prev, ...batch.encoded])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process modified plan images.')
    }
  }

  const startSession = async () => {
    if (currentImagesBase64.length === 0) {
      setError('Please upload at least one current house photo first.')
      return
    }
    if (!firstMessage.trim()) {
      setError('Please describe your needs and expected outcome.')
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
          image: currentImagesBase64[0],
          currentImage: currentImagesBase64[0],
          currentImages: currentImagesBase64,
          targetImage: targetImagesBase64[0] || undefined,
          targetImages: targetImagesBase64.length > 0 ? targetImagesBase64 : undefined,
          currentHouseStatus: currentHouseStatus.trim() || undefined,
          firstMessage: firstMessage.trim() || undefined,
          propertyType: 'House / Townhouse',
          location: location.trim() || undefined,
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

      const header = `[House / Townhouse | Current images: ${currentImagesBase64.length} | Target images: ${targetImagesBase64.length}]`
      const status = currentHouseStatus.trim() ? `Current status: ${currentHouseStatus.trim()}\n` : ''
      const userText = `${status}Goal: ${firstMessage.trim()}`
      setMessages([{ role: 'user', content: `${header}\n${userText}` }])

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
    setCurrentImagePreviews([])
    setCurrentImagesBase64([])
    setTargetImagePreviews([])
    setTargetImagesBase64([])
    setCurrentHouseStatus('')
    setFirstMessage('')
    setLocation('')
    setStreamingContent('')
    setError(null)
    if (currentImageInputRef.current) currentImageInputRef.current.value = ''
    if (targetImageInputRef.current) targetImageInputRef.current.value = ''
  }

  return (
    <div className="page page--advisor">
      <h1 className="page__title">House renovation cost + return advisor</h1>
      <p className="page__lead">
        Upload multiple images for your house right now and multiple images for the modified target outcome.
      </p>
      <p className="advisor-disclaimer">
        Scope is restricted to houses, townhouses, duplexes, and similar house-type properties. Condos and apartments are not supported.
      </p>

      {!sessionId && (
        <section className="advisor-features" aria-label="How it works">
          <h2 className="advisor-features__title">Input requirements</h2>
          <ul className="advisor-features__list">
            <li><strong>Box 1:</strong> upload one or more current house photos/floor plans.</li>
            <li><strong>Box 2:</strong> upload one or more modified target sketches/floor plans.</li>
            <li><strong>Box 3:</strong> describe current house status.</li>
            <li><strong>Box 4:</strong> describe your needs and expected outcome.</li>
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
          <label className="advisor-upload__label">Current house photos (upload multiple)</label>
          <div
            className="advisor-upload__zone"
            onClick={() => currentImageInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('advisor-upload__zone--drag') }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('advisor-upload__zone--drag') }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('advisor-upload__zone--drag')
              addCurrentImages(e.dataTransfer.files)
            }}
          >
            <input
              ref={currentImageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addCurrentImages(e.target.files)
                e.currentTarget.value = ''
              }}
              className="advisor-upload__input"
              aria-label="Upload current house photos"
            />
            {currentImagePreviews.length > 0 ? (
              <>
                <div className="advisor-upload__gallery">
                  {currentImagePreviews.map((preview, idx) => (
                    <img key={`${preview.slice(0, 30)}-${idx}`} src={preview} alt={`Current house ${idx + 1}`} className="advisor-upload__thumb" />
                  ))}
                </div>
                <span className="advisor-upload__count">{currentImagePreviews.length} image(s) uploaded</span>
              </>
            ) : (
              <span className="advisor-upload__placeholder">Drop current house photos here or click to browse</span>
            )}
          </div>

          <label className="advisor-upload__label">Modified target images (upload multiple, optional)</label>
          <div
            className="advisor-upload__zone"
            onClick={() => targetImageInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('advisor-upload__zone--drag') }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('advisor-upload__zone--drag') }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('advisor-upload__zone--drag')
              addTargetImages(e.dataTransfer.files)
            }}
          >
            <input
              ref={targetImageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addTargetImages(e.target.files)
                e.currentTarget.value = ''
              }}
              className="advisor-upload__input"
              aria-label="Upload modified target images"
            />
            {targetImagePreviews.length > 0 ? (
              <>
                <div className="advisor-upload__gallery">
                  {targetImagePreviews.map((preview, idx) => (
                    <img key={`${preview.slice(0, 30)}-${idx}`} src={preview} alt={`Target plan ${idx + 1}`} className="advisor-upload__thumb" />
                  ))}
                </div>
                <span className="advisor-upload__count">{targetImagePreviews.length} image(s) uploaded</span>
              </>
            ) : (
              <span className="advisor-upload__placeholder">Drop modified sketches/floor plans here or click to browse</span>
            )}
          </div>

          <label className="advisor-upload__label">
            Current house status (optional)
            <textarea
              value={currentHouseStatus}
              onChange={(e) => setCurrentHouseStatus(e.target.value)}
              placeholder="Describe the current condition (layout issues, old systems, damaged areas, etc.)."
              className="advisor-chat__input"
              rows={3}
            />
          </label>

          <label className="advisor-upload__label">
            Describe your needs and expected outcome (required)
            <textarea
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="Describe what you want to build, layout goals, and rental plan."
              className="advisor-chat__input"
              rows={4}
            />
          </label>

          {error && <p className="advisor-upload__error">{error}</p>}
          <button
            type="button"
            className="btn btn--primary"
            onClick={startSession}
            disabled={currentImagesBase64.length === 0 || !firstMessage.trim() || loading}
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
