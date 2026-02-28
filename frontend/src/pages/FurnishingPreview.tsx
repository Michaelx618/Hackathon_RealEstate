import { useRef, useState } from 'react'

type FurnishingLineItem = {
  name: string
  category?: string
  quantity: number
  unitPrice: number | null
  subtotal: number | null
  currency: string
  dimensions?: string
  source: 'link' | 'description'
  link?: string
  notes?: string
  estimatedPrice: boolean
}

type SourceProduct = {
  link: string
  title?: string
  price?: number
  currency?: string
  imageUrl?: string
  dimensions?: string
  description?: string
  status: 'ok' | 'error'
  error?: string
}

type FurnishingResult = {
  previewImageDataUrl?: string
  stagingPrompt: string
  summary: string
  assumptions: string[]
  items: FurnishingLineItem[]
  totalPrice: number
  currency: string
  missingPriceCount: number
  sourceProducts: SourceProduct[]
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
      // Skip malformed links.
    }
  }

  return [...unique].slice(0, 8)
}

function formatMoney(value: number | null, currency: string): string {
  if (typeof value !== 'number') return 'N/A'
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export default function FurnishingPreview() {
  const [roomPreview, setRoomPreview] = useState<string | null>(null)
  const [roomImage, setRoomImage] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [productLinksText, setProductLinksText] = useState('')
  const [currency, setCurrency] = useState('CAD')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FurnishingResult | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const onSelectFile = async (fileList: FileList | null) => {
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
      setRoomPreview(preview)
      setRoomImage(encoded)
      setError(null)
      setResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image.')
    }
  }

  const generatePreview = async () => {
    if (!roomImage) {
      setError('Please upload your unit photo first.')
      return
    }

    const productLinks = parseLinks(productLinksText)

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/furnishing/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomImage,
          requestText: description.trim() || undefined,
          productLinks,
          currency,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data?.error as string | undefined) || `Request failed (${res.status})`)
      }

      const data = await res.json() as FurnishingResult
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while generating preview.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page page--furnish">
      <h1 className="page__title">Furniture + appliance preview</h1>
      <p className="page__lead">
        Upload your room photo, describe what you want, or paste product links. We generate a staged preview and itemized budget.
      </p>

      <section className="furnish-panel">
        <label className="furnish-panel__label">Unit photo</label>
        <div
          className="furnish-upload"
          onClick={() => inputRef.current?.click()}
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
            onSelectFile(e.dataTransfer.files)
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              onSelectFile(e.target.files)
              e.currentTarget.value = ''
            }}
            className="furnish-upload__input"
          />
          {roomPreview ? (
            <img src={roomPreview} alt="Uploaded room" className="furnish-upload__preview" />
          ) : (
            <span className="furnish-upload__placeholder">Drop your room photo here or click to browse</span>
          )}
        </div>

        <label className="furnish-panel__label">
          What furniture/appliances do you want?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="advisor-chat__input"
            rows={4}
            placeholder="Example: L-shape gray sofa, oak coffee table, TV console, floor lamp, queen bed, 65-inch TV, compact washer/dryer..."
          />
        </label>

        <label className="furnish-panel__label">
          Product links (optional)
          <textarea
            value={productLinksText}
            onChange={(e) => setProductLinksText(e.target.value)}
            className="advisor-chat__input"
            rows={4}
            placeholder="Paste one link per line. We'll read product title, price, and available dimensions."
          />
        </label>

        <label className="furnish-panel__label">
          Budget currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="advisor-upload__select">
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </label>

        {error && <p className="advisor-upload__error">{error}</p>}

        <button type="button" className="btn btn--primary" onClick={generatePreview} disabled={!roomImage || loading}>
          {loading ? 'Generating preview...' : 'Generate staged preview + total price'}
        </button>
      </section>

      {result && (
        <section className="furnish-result">
          <div className="furnish-result__summary">
            <strong>Total:</strong> {formatMoney(result.totalPrice, result.currency)}
            {result.missingPriceCount > 0 && ` (${result.missingPriceCount} item(s) estimated or missing price)`}
          </div>

          <p className="furnish-result__text">{result.summary}</p>

          <div className="furnish-images">
            {roomPreview && (
              <figure className="furnish-images__card">
                <figcaption>Original unit photo</figcaption>
                <img src={roomPreview} alt="Original unit" />
              </figure>
            )}
            {result.previewImageDataUrl ? (
              <figure className="furnish-images__card">
                <figcaption>AI staged preview</figcaption>
                <img src={result.previewImageDataUrl} alt="AI staged preview" />
              </figure>
            ) : (
              <div className="furnish-images__card furnish-images__card--empty">
                <strong>Preview unavailable</strong>
                <span>Itemized furniture list is still calculated below.</span>
              </div>
            )}
          </div>

          <div className="furnish-table-wrap">
            <table className="furnish-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Subtotal</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item, index) => (
                  <tr key={`${item.name}-${index}`}>
                    <td>
                      <div className="furnish-item-name">{item.name}</div>
                      {item.dimensions && <div className="furnish-item-meta">Size: {item.dimensions}</div>}
                      {item.notes && <div className="furnish-item-meta">{item.notes}</div>}
                    </td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.unitPrice, item.currency)}</td>
                    <td>{formatMoney(item.subtotal, item.currency)}</td>
                    <td>
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noreferrer">Product link</a>
                      ) : (
                        <span>{item.source}</span>
                      )}
                      {item.estimatedPrice && <div className="furnish-item-meta">Estimated price</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.assumptions.length > 0 && (
            <div className="furnish-assumptions">
              <h3>Assumptions</h3>
              <ul>
                {result.assumptions.map((assumption, i) => (
                  <li key={`${assumption}-${i}`}>{assumption}</li>
                ))}
              </ul>
            </div>
          )}

          {result.sourceProducts.length > 0 && (
            <div className="furnish-links">
              <h3>Link parsing status</h3>
              <ul>
                {result.sourceProducts.map((product, i) => (
                  <li key={`${product.link}-${i}`}>
                    <a href={product.link} target="_blank" rel="noreferrer">{product.title || product.link}</a>
                    {' - '}
                    {product.status === 'ok' ? 'parsed' : `error: ${product.error || 'unknown error'}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.notes.length > 0 && (
            <div className="furnish-links">
              <h3>System notes</h3>
              <ul>
                {result.notes.map((note, i) => (
                  <li key={`${note}-${i}`}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
