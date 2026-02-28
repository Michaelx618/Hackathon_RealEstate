import { useEffect, useMemo, useRef, useState } from 'react'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type FurnishingOption = {
  optionId: string
  source: 'ikea' | 'link'
  name: string
  url: string
  imageUrl?: string
  unitPrice: number | null
  currency: string
  dimensionsText?: string
  widthCm?: number
  depthCm?: number
  heightCm?: number
  itemNo?: string
  typeName?: string
}

type FurnishingSlot = {
  slotId: string
  label: string
  category: string
  searchQuery: string
  quantity: number
  constraints?: string
  selectedOptionId?: string
  options: FurnishingOption[]
}

type FurnishingSelectedItem = {
  slotId: string
  slotLabel: string
  quantity: number
  optionId: string
  name: string
  url: string
  imageUrl?: string
  unitPrice: number | null
  currency: string
  subtotal: number | null
  dimensionsText?: string
  widthCm?: number
  depthCm?: number
  heightCm?: number
  itemNo?: string
}

type RoomProfile = {
  estimatedWidthM?: number
  estimatedDepthM?: number
  estimatedAreaSqm?: number
  source: 'floorplan' | 'image' | 'default'
  notes: string[]
}

type SpacingAnalysis = {
  estimatedAreaSqm?: number
  usedAreaSqm?: number
  coverageRatio?: number
  fitStatus: 'good' | 'moderate' | 'tight' | 'unknown'
  notes: string[]
}

type FurnishingResponse = {
  sessionId: string
  assistantMessage: string
  previewImageDataUrl?: string
  slots: FurnishingSlot[]
  selectedItems: FurnishingSelectedItem[]
  totalPrice: number
  currency: string
  missingPriceCount: number
  spacing: SpacingAnalysis
  roomProfile: RoomProfile
  notes: string[]
}

const MAX_FILE_SIZE_MB = 12
const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.85

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.onload = () => {
      const src = reader.result as string
      const image = new Image()
      image.onerror = () => resolve(src)
      image.onload = () => {
        let width = image.width
        let height = image.height
        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
          resolve(src)
          return
        }

        const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          resolve(src)
          return
        }

        context.drawImage(image, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      image.src = src
    }
    reader.readAsDataURL(file)
  })
}

function parseLinks(raw: string): string[] {
  const unique = new Set<string>()
  const chunks = raw
    .split(/[\n,\s]+/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    try {
      const url = new URL(chunk)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        unique.add(url.toString())
      }
    } catch {
      // Skip invalid links.
    }
  }

  return [...unique].slice(0, 10)
}

function formatMoney(value: number | null, currency: string): string {
  if (typeof value !== 'number') return 'N/A'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatDims(item: {
  dimensionsText?: string
  widthCm?: number
  depthCm?: number
  heightCm?: number
}): string | null {
  if (item.dimensionsText) return item.dimensionsText
  if (item.widthCm && item.depthCm) {
    return `${item.widthCm} cm x ${item.depthCm} cm${item.heightCm ? ` x ${item.heightCm} cm` : ''}`
  }
  return null
}

function normalizeFitLabel(status: SpacingAnalysis['fitStatus']): string {
  if (status === 'good') return 'Good fit'
  if (status === 'moderate') return 'Moderate fit'
  if (status === 'tight') return 'Tight fit'
  return 'Unknown fit'
}

function getPreviewUnavailableReason(result: FurnishingResponse | null): string | null {
  if (!result) return null
  const firstMatch = result.notes.find((note) =>
    /image preview unavailable|image generation failed|quota/i.test(note),
  )
  if (!firstMatch) return null
  const compact = firstMatch.replace(/\s+/g, ' ').trim()
  if (compact.length <= 220) return compact
  return `${compact.slice(0, 217)}...`
}

const apiBase = import.meta.env.VITE_API_URL ?? ''

export default function FurnishingPreview() {
  const [roomPreview, setRoomPreview] = useState<string | null>(null)
  const [roomImage, setRoomImage] = useState<string | null>(null)
  const [floorPlanPreview, setFloorPlanPreview] = useState<string | null>(null)
  const [floorPlanImage, setFloorPlanImage] = useState<string | null>(null)

  const [location, setLocation] = useState('')
  const [initialRequest, setInitialRequest] = useState('')
  const [linksText, setLinksText] = useState('')

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [result, setResult] = useState<FurnishingResponse | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roomInputRef = useRef<HTMLInputElement>(null)
  const floorPlanInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const canStart = Boolean(roomImage && location.trim())

  const currentCurrency = result?.currency || 'USD'
  const previewUnavailableReason = useMemo(() => getPreviewUnavailableReason(result), [result])

  const sortedSlots = useMemo(() => result?.slots ?? [], [result])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const onSelectImage = async (
    fileList: FileList | null,
    target: 'room' | 'floorPlan',
  ) => {
    if (!fileList || fileList.length === 0) return
    const file = fileList[0]

    if (!file.type.startsWith('image/')) {
      setError('Upload must be an image file.')
      return
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Image must be smaller than ${MAX_FILE_SIZE_MB} MB.`)
      return
    }

    try {
      const preview = await readAsDataUrl(file)
      const encoded = await compressImage(file)
      setError(null)

      if (target === 'room') {
        setRoomPreview(preview)
        setRoomImage(encoded)
      } else {
        setFloorPlanPreview(preview)
        setFloorPlanImage(encoded)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image.')
    }
  }

  const startSession = async () => {
    if (!roomImage) {
      setError('Please upload your unit photo first.')
      return
    }
    if (!location.trim()) {
      setError('Please enter your property address/location.')
      return
    }

    const firstMessage = initialRequest.trim() || 'Please plan and stage this room with practical furniture options.'
    const productLinks = parseLinks(linksText)

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${apiBase}/api/furnishing/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomImage,
          floorPlanImage: floorPlanImage || undefined,
          location: location.trim(),
          firstMessage,
          productLinks,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data?.error as string | undefined) || `Request failed (${res.status})`)
      }

      const data = await res.json() as FurnishingResponse
      const sid = data.sessionId || res.headers.get('X-Session-Id')
      if (!sid) throw new Error('Session ID missing in response.')

      setSessionId(sid)
      setResult(data)
      setMessages([
        { role: 'user', content: firstMessage },
        { role: 'assistant', content: data.assistantMessage },
      ])
      setChatInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start furnishing session.')
    } finally {
      setLoading(false)
    }
  }

  const sendChat = async () => {
    const sid = sessionId
    const text = chatInput.trim()
    if (!sid || !text) return

    setChatInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${apiBase}/api/furnishing/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, message: text }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data?.error as string | undefined) || `Request failed (${res.status})`)
      }

      const data = await res.json() as FurnishingResponse
      setResult(data)
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistantMessage }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.')
    } finally {
      setLoading(false)
    }
  }

  const selectOption = async (slot: FurnishingSlot, option: FurnishingOption) => {
    const sid = sessionId
    if (!sid) return

    setMessages((prev) => [...prev, { role: 'user', content: `Use ${option.name} for ${slot.label}.` }])
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${apiBase}/api/furnishing/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          action: {
            type: 'select_option',
            slotId: slot.slotId,
            optionId: option.optionId,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data?.error as string | undefined) || `Request failed (${res.status})`)
      }

      const data = await res.json() as FurnishingResponse
      setResult(data)
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistantMessage }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch furniture option.')
    } finally {
      setLoading(false)
    }
  }

  const resetSession = () => {
    setSessionId(null)
    setMessages([])
    setResult(null)
    setChatInput('')
    setError(null)
  }

  return (
    <div className="page page--furnish">
      <h1 className="page__title">Design & furnish preview</h1>
      <p className="page__lead">
        Upload your room, optionally upload floor plan, then chat to iteratively pick real IKEA products with sizing, links, spacing checks, and total budget.
      </p>

      {!sessionId && (
        <section className="furnish-panel">
          <label className="furnish-panel__label">Property address/location (required for localized pricing)</label>
          <input
            type="text"
            className="advisor-chat__input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Example: 125 Main St, Seattle, WA"
          />

          <label className="furnish-panel__label">Unit photo (required)</label>
          <div
            className="furnish-upload"
            onClick={() => roomInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.classList.add('furnish-upload--drag')
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('furnish-upload--drag')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('furnish-upload--drag')
              onSelectImage(e.dataTransfer.files, 'room')
            }}
          >
            <input
              ref={roomInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                onSelectImage(e.target.files, 'room')
                e.currentTarget.value = ''
              }}
              className="furnish-upload__input"
            />
            {roomPreview ? (
              <img src={roomPreview} alt="Uploaded unit" className="furnish-upload__preview" />
            ) : (
              <span className="furnish-upload__placeholder">Drop your room photo here or click to browse</span>
            )}
          </div>

          <label className="furnish-panel__label">Floor plan (optional, improves spacing analysis)</label>
          <div
            className="furnish-upload"
            onClick={() => floorPlanInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.classList.add('furnish-upload--drag')
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('furnish-upload--drag')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('furnish-upload--drag')
              onSelectImage(e.dataTransfer.files, 'floorPlan')
            }}
          >
            <input
              ref={floorPlanInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                onSelectImage(e.target.files, 'floorPlan')
                e.currentTarget.value = ''
              }}
              className="furnish-upload__input"
            />
            {floorPlanPreview ? (
              <img src={floorPlanPreview} alt="Uploaded floor plan" className="furnish-upload__preview" />
            ) : (
              <span className="furnish-upload__placeholder">Optional: upload floor plan image</span>
            )}
          </div>

          <label className="furnish-panel__label">What do you want? (chat starter)</label>
          <textarea
            value={initialRequest}
            onChange={(e) => setInitialRequest(e.target.value)}
            className="advisor-chat__input"
            rows={4}
            placeholder="Example: Modern cozy living room, 3-seat sofa, coffee table, TV stand, floor lamp, rug."
          />

          <label className="furnish-panel__label">Direct product links (optional)</label>
          <textarea
            value={linksText}
            onChange={(e) => setLinksText(e.target.value)}
            className="advisor-chat__input"
            rows={3}
            placeholder="Paste links (IKEA links recommended)."
          />

          {error && <p className="advisor-upload__error">{error}</p>}

          <button type="button" className="btn btn--primary" onClick={startSession} disabled={!canStart || loading}>
            {loading ? 'Starting...' : 'Start furnishing chat'}
          </button>
        </section>
      )}

      {sessionId && result && (
        <section className="furnish-result">
          <div className="furnish-result__toolbar">
            <div className="furnish-result__summary">
              <strong>Total:</strong> {formatMoney(result.totalPrice, currentCurrency)}
              {result.missingPriceCount > 0 && ` (${result.missingPriceCount} item(s) missing price)`}
            </div>
            <button type="button" className="btn btn--secondary" onClick={resetSession} disabled={loading}>
              Start new session
            </button>
          </div>

          <div className="furnish-result__meta">
            <span>Room estimate: {result.roomProfile.estimatedAreaSqm ? `${result.roomProfile.estimatedAreaSqm.toFixed(1)} sqm` : 'N/A'}</span>
            <span>Spacing: {normalizeFitLabel(result.spacing.fitStatus)}</span>
            {typeof result.spacing.coverageRatio === 'number' && (
              <span>Coverage: {(result.spacing.coverageRatio * 100).toFixed(1)}%</span>
            )}
          </div>

          <div className="furnish-images">
            {roomPreview && (
              <figure className="furnish-images__card">
                <figcaption>Original room</figcaption>
                <img src={roomPreview} alt="Original room" />
              </figure>
            )}
            {result.previewImageDataUrl ? (
              <figure className="furnish-images__card">
                <figcaption>Updated staged preview</figcaption>
                <img src={result.previewImageDataUrl} alt="Staged preview" />
              </figure>
            ) : (
              <div className="furnish-images__card furnish-images__card--empty">
                <strong>Preview unavailable</strong>
                <span>{previewUnavailableReason || 'Product list and spacing checks are still available below.'}</span>
              </div>
            )}
          </div>

          <div className="furnish-table-wrap">
            <table className="furnish-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Subtotal</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {result.selectedItems.map((item) => {
                  const dims = formatDims(item)
                  return (
                    <tr key={`${item.slotId}-${item.optionId}`}>
                      <td>
                        <div className="furnish-item-name">{item.name}</div>
                        <div className="furnish-item-meta">{item.slotLabel}</div>
                        {dims && <div className="furnish-item-meta">Size: {dims}</div>}
                      </td>
                      <td>{item.quantity}</td>
                      <td>{formatMoney(item.unitPrice, item.currency)}</td>
                      <td>{formatMoney(item.subtotal, item.currency)}</td>
                      <td><a href={item.url} target="_blank" rel="noreferrer">Open product</a></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {sortedSlots.length > 0 && (
            <div className="furnish-slots">
              <h3>Similar options from IKEA</h3>
              {sortedSlots.map((slot) => (
                <article key={slot.slotId} className="furnish-slot">
                  <header className="furnish-slot__header">
                    <div>
                      <strong>{slot.label}</strong>
                      <div className="furnish-item-meta">
                        Query: {slot.searchQuery} | Qty: {slot.quantity}
                      </div>
                      {slot.constraints && <div className="furnish-item-meta">Constraint: {slot.constraints}</div>}
                    </div>
                  </header>

                  <div className="furnish-slot__options">
                    {slot.options.map((option) => {
                      const selected = slot.selectedOptionId === option.optionId
                      const dims = formatDims(option)
                      return (
                        <div
                          key={option.optionId}
                          className={`furnish-option${selected ? ' furnish-option--selected' : ''}`}
                        >
                          {option.imageUrl ? (
                            <img src={option.imageUrl} alt={option.name} className="furnish-option__image" />
                          ) : (
                            <div className="furnish-option__image furnish-option__image--placeholder">No image</div>
                          )}
                          <div className="furnish-option__body">
                            <div className="furnish-option__name">{option.name}</div>
                            <div className="furnish-item-meta">{formatMoney(option.unitPrice, option.currency)}</div>
                            {dims && <div className="furnish-item-meta">{dims}</div>}
                            <div className="furnish-option__actions">
                              <a href={option.url} target="_blank" rel="noreferrer">Product link</a>
                              <button
                                type="button"
                                className="btn btn--secondary"
                                disabled={loading || selected}
                                onClick={() => selectOption(slot, option)}
                              >
                                {selected ? 'Selected' : 'Choose this'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}

          {(result.spacing.notes.length > 0 || result.roomProfile.notes.length > 0 || result.notes.length > 0) && (
            <div className="furnish-links">
              <h3>Spacing and system notes</h3>
              <ul>
                {result.spacing.notes.map((note, index) => (
                  <li key={`spacing-${index}`}>{note}</li>
                ))}
                {result.roomProfile.notes.map((note, index) => (
                  <li key={`room-${index}`}>{note}</li>
                ))}
                {result.notes.map((note, index) => (
                  <li key={`system-${index}`}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="advisor-chat">
            <h3>Continue in chat</h3>
            <div className="advisor-chat__messages">
              {messages.map((message, idx) => (
                <div
                  key={`${message.role}-${idx}`}
                  className={`advisor-chat__msg ${message.role === 'user' ? 'advisor-chat__msg--user' : 'advisor-chat__msg--assistant'}`}
                >
                  <div className="advisor-chat__role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
                  <div className="advisor-chat__content">{message.content}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="advisor-chat__input-wrap">
              <textarea
                className="advisor-chat__input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={3}
                placeholder="Example: replace sofa with a smaller one under 220cm wide, and add a side table."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void sendChat()
                  }
                }}
              />
              <div className="advisor-chat__actions">
                <button type="button" className="btn btn--primary" onClick={sendChat} disabled={loading || !chatInput.trim()}>
                  {loading ? 'Updating...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {!sessionId && error && <p className="advisor-upload__error">{error}</p>}
    </div>
  )
}
