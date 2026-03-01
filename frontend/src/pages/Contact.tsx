import { FormEvent, useState } from 'react'

export default function Contact() {
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="page page--contact">
      <h1 className="page__title">Contact us</h1>
      <p className="page__lead">
        Questions about a listing, want to sell or rent your property, or need help? Send us a message.
      </p>

      <div className="contact__grid">
        <section className="contact__form-wrap">
          {submitted ? (
            <div className="contact__success">
              <p>Thanks for reaching out. We’ll get back to you within 1–2 business days.</p>
            </div>
          ) : (
            <form className="contact-form" onSubmit={handleSubmit}>
              <label className="contact-form__label">
                Name
                <input type="text" name="name" required className="contact-form__input" placeholder="Your name" />
              </label>
              <label className="contact-form__label">
                Email
                <input type="email" name="email" required className="contact-form__input" placeholder="you@example.com" />
              </label>
              <label className="contact-form__label">
                Subject
                <select name="subject" className="contact-form__input" required>
                  <option value="">Choose one</option>
                  <option value="general">General question</option>
                  <option value="listing">About a listing</option>
                  <option value="sell">I want to sell</option>
                  <option value="rent">I want to rent out</option>
                </select>
              </label>
              <label className="contact-form__label">
                Message
                <textarea name="message" rows={5} required className="contact-form__input contact-form__textarea" placeholder="Your message..." />
              </label>
              <button type="submit" className="btn btn--primary">Send message</button>
            </form>
          )}
        </section>

        <aside className="contact__info">
          <h3>Other ways to reach us</h3>
          <dl className="contact-details">
            <dt>Email</dt>
            <dd><a href="mailto:hello@reinnovate.com">hello@reinnovate.com</a></dd>
            <dt>Phone</dt>
            <dd><a href="tel:+14155551234">(415) 555-1234</a></dd>
            <dt>Office</dt>
            <dd>123 Market St, Suite 400<br />San Francisco, CA 94103</dd>
            <dt>Hours</dt>
            <dd>Mon–Fri 9am–6pm PT</dd>
          </dl>
        </aside>
      </div>
    </div>
  )
}
