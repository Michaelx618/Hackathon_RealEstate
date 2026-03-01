import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

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

type LayoutPlacement = {
  slotId: string
  optionId: string
  label: string
  x: number
  y: number
  scale: number
}

type LayoutPlacementPayload = {
  slotId: string
  optionId: string
  x: number
  y: number
  scale: number
}

type LayoutDragState = {
  key: string
  pointerId: number
  offsetX: number
  offsetY: number
  bounds: DOMRect
}

const MAX_FILE_SIZE_MB = 12
const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.85
const MIN_LAYOUT_COORD = 0.02
const MAX_LAYOUT_COORD = 0.98
const MIN_LAYOUT_SCALE = 0.65
const MAX_LAYOUT_SCALE = 1.4

const DEFAULT_LAYOUT_POINTS: Array<{ x: number; y: number }> = [
  { x: 0.22, y: 0.25 },
  { x: 0.5, y: 0.23 },
  { x: 0.78, y: 0.26 },
  { x: 0.24, y: 0.53 },
  { x: 0.5, y: 0.52 },
  { x: 0.77, y: 0.56 },
  { x: 0.35, y: 0.8 },
  { x: 0.65, y: 0.8 },
]

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toPlacementKey(slotId: string, optionId: string): string {
  return `${slotId}::${optionId}`
}

function estimatePlacementScale(item: FurnishingSelectedItem): number {
  if (item.quantity > 1) return 0.9
  const width = item.widthCm || 0
  if (width >= 260) return 1.15
  if (width >= 180) return 1.05
  if (width > 0 && width <= 85) return 0.88
  return 1
}

function buildLayoutForItems(
  items: FurnishingSelectedItem[],
  previous: LayoutPlacement[],
): LayoutPlacement[] {
  const previousByKey = new Map(
    previous.map((placement) => [toPlacementKey(placement.slotId, placement.optionId), placement]),
  )

  return items.map((item, index) => {
    const key = toPlacementKey(item.slotId, item.optionId)
    const existing = previousByKey.get(key)
    if (existing) {
      return {
        ...existing,
        label: item.name,
        x: clamp(existing.x, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
        y: clamp(existing.y, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
        scale: clamp(existing.scale, MIN_LAYOUT_SCALE, MAX_LAYOUT_SCALE),
      }
    }

    const base = DEFAULT_LAYOUT_POINTS[index % DEFAULT_LAYOUT_POINTS.length]
    const row = Math.floor(index / DEFAULT_LAYOUT_POINTS.length)
    return {
      slotId: item.slotId,
      optionId: item.optionId,
      label: item.name,
      x: clamp(base.x, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
      y: clamp(base.y + row * 0.07, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
      scale: estimatePlacementScale(item),
    }
  })
}

function toLayoutPayload(layout: LayoutPlacement[]): LayoutPlacementPayload[] {
  return layout.map((placement) => ({
    slotId: placement.slotId,
    optionId: placement.optionId,
    x: Number(clamp(placement.x, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD).toFixed(4)),
    y: Number(clamp(placement.y, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD).toFixed(4)),
    scale: Number(clamp(placement.scale, MIN_LAYOUT_SCALE, MAX_LAYOUT_SCALE).toFixed(3)),
  }))
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
  const [previewEditorOpen, setPreviewEditorOpen] = useState(false)
  const [layoutPlacements, setLayoutPlacements] = useState<LayoutPlacement[]>([])
  const [layoutDraft, setLayoutDraft] = useState<LayoutPlacement[]>([])
  const [activePlacementKey, setActivePlacementKey] = useState<string | null>(null)

  const roomInputRef = useRef<HTMLInputElement>(null)
  const floorPlanInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const editorCanvasRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<LayoutDragState | null>(null)

  const canStart = Boolean(roomImage && location.trim())

  const currentCurrency = result?.currency || 'USD'
  const previewUnavailableReason = useMemo(() => getPreviewUnavailableReason(result), [result])

  const sortedSlots = useMemo(() => result?.slots ?? [], [result])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (!result) {
      setLayoutPlacements([])
      setLayoutDraft([])
      setPreviewEditorOpen(false)
      setActivePlacementKey(null)
      dragStateRef.current = null
      return
    }
    setLayoutPlacements((prev) => buildLayoutForItems(result.selectedItems, prev))
  }, [result])

  useEffect(() => {
    if (!previewEditorOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewEditorOpen(false)
        setActivePlacementKey(null)
        dragStateRef.current = null
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [previewEditorOpen])

  useEffect(() => {
    if (!previewEditorOpen) return
    const onPointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return
      const nextX = (event.clientX - dragState.bounds.left - dragState.offsetX) / dragState.bounds.width
      const nextY = (event.clientY - dragState.bounds.top - dragState.offsetY) / dragState.bounds.height
      setLayoutDraft((prev) => prev.map((placement) => {
        if (toPlacementKey(placement.slotId, placement.optionId) !== dragState.key) return placement
        return {
          ...placement,
          x: clamp(nextX, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
          y: clamp(nextY, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
        }
      }))
    }

    const stopDragging = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return
      dragStateRef.current = null
      setActivePlacementKey(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [previewEditorOpen])

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

  const openLayoutEditor = () => {
    if (!result?.previewImageDataUrl) return
    if (result.selectedItems.length === 0) {
      setError('Select at least one furniture item before editing placement.')
      return
    }

    const syncedLayout = buildLayoutForItems(result.selectedItems, layoutPlacements)
    setLayoutPlacements(syncedLayout)
    setLayoutDraft(syncedLayout)
    setActivePlacementKey(null)
    dragStateRef.current = null
    setError(null)
    setPreviewEditorOpen(true)
  }

  const closeLayoutEditor = () => {
    setPreviewEditorOpen(false)
    setLayoutDraft(layoutPlacements)
    setActivePlacementKey(null)
    dragStateRef.current = null
  }

  const resetDraftLayout = () => {
    if (!result) return
    setLayoutDraft(buildLayoutForItems(result.selectedItems, []))
    setActivePlacementKey(null)
    dragStateRef.current = null
  }

  const setPlacementPosition = (key: string, x: number, y: number) => {
    setLayoutDraft((prev) => prev.map((entry) => {
      if (toPlacementKey(entry.slotId, entry.optionId) !== key) return entry
      return {
        ...entry,
        x: clamp(x, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
        y: clamp(y, MIN_LAYOUT_COORD, MAX_LAYOUT_COORD),
      }
    }))
  }

  const nudgePlacement = (placement: LayoutPlacement, deltaX: number, deltaY: number) => {
    const key = toPlacementKey(placement.slotId, placement.optionId)
    setPlacementPosition(key, placement.x + deltaX, placement.y + deltaY)
  }

  const beginPlacementDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    placement: LayoutPlacement,
  ) => {
    const container = editorCanvasRef.current
    if (!container) return
    const bounds = container.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return

    const centerX = bounds.left + placement.x * bounds.width
    const centerY = bounds.top + placement.y * bounds.height
    const key = toPlacementKey(placement.slotId, placement.optionId)

    dragStateRef.current = {
      key,
      pointerId: event.pointerId,
      offsetX: event.clientX - centerX,
      offsetY: event.clientY - centerY,
      bounds,
    }
    setActivePlacementKey(key)
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveActivePlacementToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeKey = activePlacementKey
    if (!activeKey) return
    const target = event.target as HTMLElement
    if (target.closest('.furnish-editor__chip')) return

    const container = editorCanvasRef.current
    if (!container) return
    const bounds = container.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return

    const nextX = (event.clientX - bounds.left) / bounds.width
    const nextY = (event.clientY - bounds.top) / bounds.height
    setPlacementPosition(activeKey, nextX, nextY)
  }

  const regeneratePreviewWithLayout = async () => {
    const sid = sessionId
    if (!sid || !result) return

    const draftSnapshot = layoutDraft.map((placement) => ({ ...placement }))
    if (draftSnapshot.length === 0) {
      setError('No furniture placements found for regeneration.')
      return
    }

    const placements = toLayoutPayload(draftSnapshot)
    setMessages((prev) => [...prev, { role: 'user', content: 'Update the preview with the moved furniture positions.' }])
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${apiBase}/api/furnishing/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          action: {
            type: 'update_layout',
            placements,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data?.error as string | undefined) || `Request failed (${res.status})`)
      }

      const data = await res.json() as FurnishingResponse
      setResult(data)
      setLayoutPlacements(draftSnapshot)
      setLayoutDraft(draftSnapshot)
      setPreviewEditorOpen(false)
      setActivePlacementKey(null)
      dragStateRef.current = null
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistantMessage }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate furnishing preview.')
    } finally {
      setLoading(false)
    }
  }

  const resetSession = () => {
    setSessionId(null)
    setMessages([])
    setResult(null)
    setChatInput('')
    setPreviewEditorOpen(false)
    setLayoutPlacements([])
    setLayoutDraft([])
    setActivePlacementKey(null)
    dragStateRef.current = null
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
          {error && <p className="advisor-upload__error">{error}</p>}

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
                <button
                  type="button"
                  className="furnish-images__preview-btn"
                  onClick={openLayoutEditor}
                  disabled={loading || result.selectedItems.length === 0}
                  aria-label="Open larger staged preview and move furniture"
                >
                  <img src={result.previewImageDataUrl} alt="Staged preview" />
                </button>
                <p className="furnish-images__hint">Click to open full-screen editor, move furniture, then regenerate.</p>
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

      {previewEditorOpen && result?.previewImageDataUrl && (
        <div
          className="furnish-editor__backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="furnish-editor-title"
          onClick={closeLayoutEditor}
        >
          <section className="furnish-editor" onClick={(event) => event.stopPropagation()}>
            <header className="furnish-editor__header">
              <div>
                <h2 id="furnish-editor-title">Move furniture on preview</h2>
                <p>Drag each item marker to where you want it. Press Regenerate preview when done.</p>
              </div>
              <button type="button" className="furnish-editor__close" onClick={closeLayoutEditor} aria-label="Close preview editor">
                ×
              </button>
            </header>

            <div
              className={`furnish-editor__canvas${activePlacementKey ? ' furnish-editor__canvas--placing' : ''}`}
              ref={editorCanvasRef}
              onPointerDown={moveActivePlacementToPointer}
            >
              <img src={result.previewImageDataUrl} alt="Large staged preview for placement editing" />
              {layoutDraft.map((placement) => {
                const key = toPlacementKey(placement.slotId, placement.optionId)
                const selected = key === activePlacementKey
                const step = 0.01
                const acceleratedStep = 0.03
                const horizontalAnchor = placement.x < 0.18
                  ? 'left'
                  : (placement.x > 0.82 ? 'right' : 'center')
                return (
                  <button
                    key={key}
                    type="button"
                    className={`furnish-editor__chip${selected ? ' furnish-editor__chip--active' : ''} furnish-editor__chip--anchor-${horizontalAnchor}`}
                    style={{
                      left: `${(placement.x * 100).toFixed(2)}%`,
                      top: `${(placement.y * 100).toFixed(2)}%`,
                      transform: horizontalAnchor === 'left'
                        ? `translate(0, calc(-100% - 14px)) scale(${placement.scale.toFixed(2)})`
                        : (horizontalAnchor === 'right'
                            ? `translate(-100%, calc(-100% - 14px)) scale(${placement.scale.toFixed(2)})`
                            : `translate(-50%, calc(-100% - 14px)) scale(${placement.scale.toFixed(2)})`),
                    }}
                    onClick={() => setActivePlacementKey(key)}
                    onFocus={() => setActivePlacementKey(key)}
                    onPointerDown={(event) => beginPlacementDrag(event, placement)}
                    onKeyDown={(event) => {
                      const delta = event.shiftKey ? acceleratedStep : step
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault()
                        nudgePlacement(placement, -delta, 0)
                      } else if (event.key === 'ArrowRight') {
                        event.preventDefault()
                        nudgePlacement(placement, delta, 0)
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        nudgePlacement(placement, 0, -delta)
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        nudgePlacement(placement, 0, delta)
                      }
                    }}
                  >
                    <span className="furnish-editor__chip-label" title={placement.label}>{placement.label}</span>
                  </button>
                )
              })}
            </div>

            <p className="furnish-editor__tip">Tip: click a tag to select it, then click the image to place the exact anchor point.</p>

            <div className="furnish-editor__actions">
              <button type="button" className="btn btn--secondary" onClick={resetDraftLayout} disabled={loading}>
                Reset positions
              </button>
              <button type="button" className="btn btn--secondary" onClick={closeLayoutEditor} disabled={loading}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void regeneratePreviewWithLayout()} disabled={loading}>
                {loading ? 'Regenerating...' : 'Regenerate preview'}
              </button>
            </div>
          </section>
        </div>
      )}

      {!sessionId && error && <p className="advisor-upload__error">{error}</p>}
    </div>
  )
}
