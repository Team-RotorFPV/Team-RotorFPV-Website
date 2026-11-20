import React, { useRef, useState, useEffect, useMemo } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import VariableProximity from '../components/VariableProximity';
import ShinyText from '../components/ShinyText';
import LogoLoop from '../components/LogoLoop';
import Seo from '../components/Seo';
import useEventNow from '../hooks/useEventNow';
import { getHomepageEventAnnouncements } from '../lib/eventSchedule';
import { API_URL } from '../lib/apiUrl';
import './Home.css';

const DEFAULT_VIDEO = '/TRFPV_Assets/Teamvideo.mp4';

const isMediaUrl = (value) => {
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized.includes('res.cloudinary.com')
    || normalized.includes('/video/upload/')
    || normalized.endsWith('.mp4')
    || normalized.endsWith('.webm')
    || normalized.endsWith('.mov');
};

const getAboutText = (value, fallback) => {
  if (typeof value !== 'string') return fallback;

  const text = value.trim();
  return text && !isMediaUrl(text) ? text : fallback;
};

const getVideoUrl = (value) => {
  if (typeof value !== 'string') return DEFAULT_VIDEO;

  const url = value.trim();
  return url ? url : DEFAULT_VIDEO;
};

const DEFAULT_ABOUT =
  "Team Rotor FPV is VIT's premier first-person-view drone racing and engineering team. We design, build, and fly high-performance racing drones from the ground up — pushing the limits of aerodynamics, electronics, and control systems. United by a passion for flight, we compete at national and international stages while fostering hands-on technical education for the next generation of engineers.";

const EMPTY_CONTACT_FORM = {
  queryType: '',
  name: '',
  organization: '',
  phone: '',
  email: '',
  message: '',
  honeypot: ''
};

const Home = () => {
  const containerRef = useRef(null);
  const [videoSrc, setVideoSrc] = useState(DEFAULT_VIDEO);
  const [aboutText, setAboutText] = useState(DEFAULT_ABOUT);
  const [events, setEvents] = useState([]);
  const [formData, setFormData] = useState(EMPTY_CONTACT_FORM);
  const [status, setStatus] = useState({ loading: false, success: false, error: '' });
  const now = useEventNow();

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'home'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setVideoSrc(getVideoUrl(data.backgroundVideoUrl));
        setAboutText(getAboutText(data.aboutUs, DEFAULT_ABOUT));
      } else {
        setVideoSrc(DEFAULT_VIDEO);
        setAboutText(DEFAULT_ABOUT);
      }
    }, (error) => {
      console.error("Error fetching home settings:", error);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
      setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
    }, (error) => {
      console.error('Error fetching homepage events:', error);
    });
    return () => unsubscribe();
  }, []);

  const handleVideoError = () => {
    if (videoSrc !== DEFAULT_VIDEO) setVideoSrc(DEFAULT_VIDEO);
  };

  // The hero quote fades out as the user scrolls into the page. We drive it with
  // a 0→1 progress var so the actual animation lives in CSS.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const distance = window.innerHeight * 0.6; // fully faded after ~60vh
      const progress = Math.min(1, Math.max(0, window.scrollY / distance));
      el.style.setProperty('--hero-scroll', progress.toString());
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, success: false, error: '' });

    try {
      const response = await fetch(`${API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus({ loading: false, success: true, error: '' });
        setFormData(EMPTY_CONTACT_FORM);
        setTimeout(() => setStatus(prev => ({ ...prev, success: false })), 5000);
      } else {
        setStatus({ loading: false, success: false, error: data.error || 'Failed to send message.' });
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setStatus({ loading: false, success: false, error: 'Network error. Please try again later.' });
    }
  };

  const tickerItems = useMemo(() => getHomepageEventAnnouncements(events, now).map((announcement) => {
    if (announcement.type === 'ongoing') {
      return {
        ariaLabel: `Ongoing event: ${announcement.event.name}. View event details.`,
        node: (
          <Link to={`/events?event=${encodeURIComponent(announcement.event.id)}`} className="home-event-ticker-link ongoing">
            <strong>ONGOING</strong><span className="home-event-ticker-separator" aria-hidden="true">·</span><span>{announcement.event.name}</span><span className="home-event-ticker-arrow" aria-hidden="true">→</span>
          </Link>
        )
      };
    }

    return {
      ariaLabel: `${announcement.callToAction.label}: ${announcement.event.name}`,
      node: (
        <a href={announcement.callToAction.url} target="_blank" rel="noopener noreferrer" className="home-event-ticker-link">
          <span>{announcement.event.name}</span><strong>{announcement.callToAction.label.toUpperCase()}</strong><span className="home-event-ticker-arrow" aria-hidden="true">→</span>
        </a>
      )
    };
  }), [events, now]);

  return (
    <>
      <Seo description="Team RotorFPV is VIT's premier FPV drone racing and engineering team — we design, build, and fly high-performance racing drones and compete nationally and internationally." />
      <div className="home-container" ref={containerRef}>
        <div className="video-background">
          <video key={videoSrc} autoPlay loop muted playsInline onError={handleVideoError}>
            <source src={videoSrc} />
          </video>
          <div className="video-overlay"></div>
        </div>

        {tickerItems.length > 0 && (
          <div className="home-event-ticker">
            <LogoLoop
              logos={tickerItems}
              speed={45}
              direction="left"
              logoHeight={14}
              gap={64}
              hoverSpeed={0}
              fadeOut
              fadeOutColor="rgba(0, 0, 0, 0.32)"
              ariaLabel="Current Team RotorFPV events"
              renderItem={(item) => item.node}
            />
          </div>
        )}

        <div className="hero-content">
          <h1 className="brand-font hero-quote">
            <VariableProximity
              label='"Build . Fly . Crash . Repeat"'
              className="variable-proximity-demo"
              fromFontVariationSettings="'wght' 200, 'opsz' 9"
              toFontVariationSettings="'wght' 500, 'opsz' 40"
              containerRef={containerRef}
              radius={120}
              falloff="exponential"
            />
          </h1>
        </div>
      </div>

      <section id="about-us" className="about-section">
        <div className="about-content">
          <h2 className="about-title">
            <ShinyText text="About Us" speed={3} />
          </h2>
          {aboutText
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line, idx) => (
              <p key={idx} className="about-paragraph">{line}</p>
            ))}
        </div>
      </section>

      <section id="contact" className="home-contact-section">
        <div className="contact-page-wrapper">
          {/* Left Side */}
          <div className="contact-left">
            <div className="contact-left-content">
              <span className="subtitle-small">GET IN TOUCH</span>
              <h2 className="contact-heading">
                Connect <br />
                <span className="italic-text">with us.</span>
              </h2>
              <p className="contact-description">
                Want to join, sponsor us, or send a meme?<br />
                Write to us.
              </p>

              <hr className="contact-divider" />

              <div className="contact-info-row">
                <span className="info-label">EMAIL</span>
                <a href="mailto:teamrotorfpv@vit.ac.in" className="info-value">
                  teamrotorfpv@vit.ac.in
                </a>
              </div>
            </div>
          </div>

          {/* Right Side */}
          <div className="contact-right">
            <div className="contact-right-content glass-form-card">
              <form className="contact-form" onSubmit={handleSubmit}>

                {/* Honeypot field - hidden from users but bots will fill it */}
                <div style={{ display: 'none' }}>
                  <label>Leave this field blank</label>
                  <input type="text" name="honeypot" value={formData.honeypot} onChange={handleChange} tabIndex="-1" autoComplete="off" />
                </div>

                <div className="form-group">
                  <label>Query Type <span className="required">*</span></label>
                  <select name="queryType" value={formData.queryType} onChange={handleChange} required>
                    <option value="" disabled>Select a query type</option>
                    <option value="General Query">General Query</option>
                    <option value="Partnership">Partnership</option>
                    <option value="Feedback">Feedback</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Name <span className="required">*</span></label>
                  <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Your Name" required />
                </div>

                {formData.queryType === 'Partnership' && (
                  <div className="form-group">
                    <label>Organization Name</label>
                    <input type="text" name="organization" value={formData.organization} onChange={handleChange} placeholder="Your Organization" />
                  </div>
                )}

                <div className="form-group">
                  <label>Phone</label>
                  <input type="text" name="phone" value={formData.phone} onChange={handleChange} placeholder="Your Phone Number" />
                </div>

                <div className="form-group">
                  <label>Email <span className="required">*</span></label>
                  <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Your Email" required />
                </div>

                <div className="form-group">
                  <label>Additional Details <span className="required">*</span></label>
                  <textarea name="message" value={formData.message} onChange={handleChange} placeholder="Enter details here..." rows="4" required maxLength="2000"></textarea>
                </div>

                {status.error && <div className="form-error-message" style={{ color: '#ff4d4d', marginBottom: '1rem', fontSize: '0.9rem' }}>{status.error}</div>}
                {status.success && <div className="form-success-message" style={{ color: '#4caf50', marginBottom: '1rem', fontSize: '0.9rem' }}>Message sent successfully! We'll get back to you soon.</div>}

                <button type="submit" className="submit-btn" disabled={status.loading}>
                  {status.loading ? 'Sending...' : 'Submit'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Home;
