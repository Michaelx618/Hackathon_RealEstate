import { useState, useRef } from 'react'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export default function Advisor() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [firstMessage, setFirstMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  const MAX_FILE_SIZE_MB = 10
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
      setImageBase64(dataUrl)
    }
    reader.readAsDataURL(file)
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
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      const sid = res.headers.get('X-Session-Id')
      if (sid) setSessionId(sid)
      const userText = firstMessage.trim() || "Here's my floor plan. Please analyze it."
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
        throw new Error(data.error || `Request failed: ${res.status}`)
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
    setStreamingContent('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="page page--advisor">
      <h1 className="page__title">Renovation advisor</h1>
      <p className="page__lead">
        Upload a photo or scan of your floor plan. The advisor will suggest renovations, how to repurpose for tenants, ballpark costs, and design tips—then you can chat for more details.
      </p>

      {!sessionId ? (
        <section className="advisor-upload">
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
                  const dataUrl = reader.result as string
                  setImagePreview(dataUrl)
                  setImageBase64(dataUrl)
                }
                reader.readAsDataURL(file)
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
              placeholder="e.g. I want to rent out part of this house"
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
