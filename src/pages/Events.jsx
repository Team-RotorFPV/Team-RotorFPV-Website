import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useLocation } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Images, X } from 'lucide-react';
import { db } from '../firebase';
import ShinyText from '../components/ShinyText';
import Seo from '../components/Seo';
import useEventNow from '../hooks/useEventNow';
import { getEventCallToAction, getEventGroups, getEventLifecycle } from '../lib/eventSchedule';
import './Events.css';

const formatDate = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  ...options
}).format(new Date(`${value}T00:00:00Z`));

const formatDateRange = (event) => {
  const endDate = event.endDate || event.startDate;
  return event.startDate === endDate
    ? formatDate(event.startDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : `${formatDate(event.startDate)} – ${formatDate(endDate)}`;
};

const formatTimeRange = (event) => (event.startTime && event.endTime
  ? `${event.startTime} – ${event.endTime} IST`
  : 'All day');

// Event Schedules are India-local, so pin the offset when turning one into an instant.
const scheduleInstant = (date, time) => new Date(`${date}T${time}:00+05:30`);

const formatCountdown = (target, now) => {
  const totalSeconds = Math.max(0, Math.floor((target - now) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m ${totalSeconds % 60}s`;
};

const getCountdown = (event, lifecycle, now) => {
  if (lifecycle === 'upcoming') {
    return { label: 'Starts in', value: formatCountdown(scheduleInstant(event.startDate, event.startTime || '00:00'), now) };
  }
  if (lifecycle === 'ongoing') {
    const end = scheduleInstant(event.endDate || event.startDate, event.endTime || '23:59');
    return { label: 'Ends in', value: formatCountdown(end, now) };
  }
  return null;
};

const LIFECYCLE_LABELS = { ongoing: 'Live now', upcoming: 'Upcoming', past: 'Past' };

const StatusBadge = ({ lifecycle }) => (
  <span className={`event-status-badge ${lifecycle}`}>
    {lifecycle === 'ongoing' && <span className="event-live-dot" aria-hidden="true" />}
    {LIFECYCLE_LABELS[lifecycle]}
  </span>
);

const DateTile = ({ date }) => (
  <div className="event-date-tile" aria-hidden="true">
    <span className="event-date-day">{formatDate(date, { day: '2-digit' })}</span>
    <span className="event-date-month">{formatDate(date, { month: 'short' })}</span>
  </div>
);

// Posters often carry their own text, so show them uncropped over a blurred copy.
const EventPoster = ({ src, alt, className = '' }) => (
  <div className={`event-poster ${className}`}>
    <div className="event-poster-backdrop" style={{ backgroundImage: `url("${src}")` }} aria-hidden="true" />
    <img src={src} alt={alt} className="event-poster-image" loading="lazy" decoding="async" />
  </div>
);

const EventCallToAction = ({ callToAction }) => callToAction && (
  <a className="event-cta" href={callToAction.url} target="_blank" rel="noopener noreferrer">
    {callToAction.label}
    <ArrowUpRight size={16} aria-hidden="true" />
  </a>
);

const EventMeta = ({ event }) => (
  <ul className="event-meta">
    <li><CalendarDays size={15} aria-hidden="true" />{formatDateRange(event)}</li>
    <li><Clock size={15} aria-hidden="true" />{formatTimeRange(event)}</li>
  </ul>
);

const FeaturedEventCard = ({ event, lifecycle, now, onClick, highlighted }) => {
  const callToAction = getEventCallToAction(event, now);
  const countdown = getCountdown(event, lifecycle, now);

  return (
    <article id={`event-${event.id}`} className={`event-feature ${lifecycle} ${highlighted ? 'event-card-highlighted' : ''}`}>
      <button type="button" className="event-feature-media" onClick={onClick} aria-label={`View details for ${event.name}`}>
        <EventPoster src={event.image} alt={event.name} />
      </button>
      <div className="event-feature-body">
        <div className="event-feature-top">
          <StatusBadge lifecycle={lifecycle} />
          {countdown && (
            <span className="event-countdown">
              <span className="event-countdown-label">{countdown.label}</span>
              <span className="event-countdown-value">{countdown.value}</span>
            </span>
          )}
        </div>
        <h3 className="event-feature-title">{event.name}</h3>
        <EventMeta event={event} />
        {event.description && <p className="event-feature-desc">{event.description}</p>}
        <div className="event-actions">
          <EventCallToAction callToAction={callToAction} />
          <button type="button" className="event-details-link" onClick={onClick}>
            View details <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};

const EventCard = ({ event, lifecycle, onClick, highlighted }) => (
  <article id={`event-${event.id}`} className={`event-card ${highlighted ? 'event-card-highlighted' : ''}`}>
    <button type="button" className="event-card-button" onClick={onClick} aria-label={`View details for ${event.name}`}>
      <div className="event-card-media">
        <EventPoster src={event.image} alt={event.name} />
        <DateTile date={event.startDate} />
        {event.galleryImages?.length > 0 && (
          <span className="event-photo-count">
            <Images size={13} aria-hidden="true" />
            {event.galleryImages.length + 1}
          </span>
        )}
      </div>
      <div className="event-card-body">
        <StatusBadge lifecycle={lifecycle} />
        <h4 className="event-card-title">{event.name}</h4>
        <p className="event-card-schedule">{formatDateRange(event)}</p>
        {event.description && <p className="event-card-desc">{event.description}</p>}
        <span className="event-details-link" aria-hidden="true">
          View details <ChevronRight size={16} />
        </span>
      </div>
    </button>
  </article>
);

const EventModal = ({ event, lifecycle, now, onClose }) => {
  const [index, setIndex] = useState(0);
  const images = [...new Set([event.image, ...(event.galleryImages || [])].filter(Boolean))];
  const longDesc = event.longDescription?.trim() ? event.longDescription : (event.description || '');
  const callToAction = getEventCallToAction(event, now);
  const countdown = getCountdown(event, lifecycle, now);

  useEffect(() => {
    const onKey = (keyEvent) => {
      if (keyEvent.key === 'Escape') onClose();
      else if (keyEvent.key === 'ArrowRight') setIndex((current) => (current + 1) % images.length);
      else if (keyEvent.key === 'ArrowLeft') setIndex((current) => (current - 1 + images.length) % images.length);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [images.length, onClose]);

  const go = (direction) => setIndex((current) => (current + direction + images.length) % images.length);

  return (
    <div className="event-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={event.name}>
      <div className="event-modal" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <button className="event-modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="event-modal-gallery">
          {images.map((source, imageIndex) => (
            <div key={source} className={`event-modal-slide ${imageIndex === index ? 'active' : ''}`}>
              <EventPoster src={source} alt={`${event.name} ${imageIndex + 1}`} />
            </div>
          ))}
          {images.length > 1 && (
            <>
              <button className="gallery-nav prev" onClick={() => go(-1)} aria-label="Previous image"><ChevronLeft size={22} /></button>
              <button className="gallery-nav next" onClick={() => go(1)} aria-label="Next image"><ChevronRight size={22} /></button>
              <span className="gallery-counter">{index + 1} / {images.length}</span>
            </>
          )}
        </div>
        {images.length > 1 && (
          <div className="event-modal-thumbs">
            {images.map((source, imageIndex) => (
              <button
                key={source}
                className={`event-modal-thumb ${imageIndex === index ? 'active' : ''}`}
                onClick={() => setIndex(imageIndex)}
                aria-label={`Go to image ${imageIndex + 1}`}
              >
                <img src={source} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
        <div className="event-modal-body">
          <div className="event-feature-top">
            <StatusBadge lifecycle={lifecycle} />
            {countdown && (
              <span className="event-countdown">
                <span className="event-countdown-label">{countdown.label}</span>
                <span className="event-countdown-value">{countdown.value}</span>
              </span>
            )}
          </div>
          <h3 className="event-modal-title">{event.name}</h3>
          <EventMeta event={event} />
          <div className="event-modal-text">
            {longDesc.split('\n').filter((line) => line.trim() !== '').map((line, lineIndex) => (
              <p key={lineIndex} className="event-modal-desc">{line}</p>
            ))}
          </div>
          {callToAction && <div className="event-actions"><EventCallToAction callToAction={callToAction} /></div>}
        </div>
      </div>
    </div>
  );
};

const GROUPS = [
  { lifecycle: 'ongoing', title: 'Happening Now', featured: true },
  { lifecycle: 'upcoming', title: 'Coming Up', featured: true },
  { lifecycle: 'past', title: 'Past Events', featured: false }
];

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ongoing', label: 'Live' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' }
];

const EventGroup = ({ title, events, lifecycle, featured, now, onSelect, highlightedEventId }) => events.length > 0 && (
  <section className="events-group" aria-labelledby={`${lifecycle}-events`}>
    <div className="events-group-header">
      <h3 id={`${lifecycle}-events`} className="events-subheading">{title}</h3>
      <span className="events-group-count">{events.length}</span>
    </div>
    <div className={featured ? 'events-feature-list' : 'events-grid'}>
      {events.map((event) => {
        const Card = featured ? FeaturedEventCard : EventCard;
        return (
          <Card
            key={event.id}
            event={event}
            lifecycle={lifecycle}
            now={now}
            onClick={() => onSelect(event)}
            highlighted={event.id === highlightedEventId}
          />
        );
      })}
    </div>
  </section>
);

const Events = () => {
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [highlightedEventId, setHighlightedEventId] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const now = useEventNow();
  const location = useLocation();
  const highlightTimerRef = useRef(null);
  const groups = getEventGroups(events, now);
  const selectedLifecycle = selectedEvent ? getEventLifecycle(selectedEvent, now) : null;

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
      setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
      setLoadError(false);
      setLoaded(true);
    }, (error) => {
      console.error('Error fetching events:', error);
      setLoadError(true);
      setLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const eventId = new URLSearchParams(location.search).get('event');
    if (!eventId || !events.some((event) => event.id === eventId)) return undefined;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedEventId(eventId);
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedEventId(null), 2400);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(highlightTimerRef.current);
    };
  }, [events, location.search]);

  const counts = {
    all: groups.ongoing.length + groups.upcoming.length + groups.past.length,
    ongoing: groups.ongoing.length,
    upcoming: groups.upcoming.length,
    past: groups.past.length
  };
  const hasEvents = counts.all > 0;
  const visibleGroups = GROUPS.filter((group) => filter === 'all' || filter === group.lifecycle);

  return (
    <div className="events-page">
      <Seo description="Ongoing, upcoming, and past events from Team RotorFPV — drone racing competitions, workshops, and showcases at VIT." />
      <div className="events-content">
        <header className="events-hero">
          <p className="events-eyebrow">Team RotorFPV</p>
          <h2 className="events-title"><ShinyText text="Events" speed={3} /></h2>
          {hasEvents && (
            <div className="events-filters" role="tablist" aria-label="Filter events">
              {FILTERS.filter((option) => option.value === 'all' || counts[option.value] > 0).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.value}
                  className={`events-filter ${option.value} ${filter === option.value ? 'active' : ''}`}
                  onClick={() => setFilter(option.value)}
                >
                  {option.value === 'ongoing' && <span className="event-live-dot" aria-hidden="true" />}
                  {option.label}
                  <span className="events-filter-count">{counts[option.value]}</span>
                </button>
              ))}
            </div>
          )}
        </header>

        {!loaded && (
          <div className="events-grid" aria-hidden="true">
            {[0, 1, 2].map((key) => <div key={key} className="event-card event-card-skeleton" />)}
          </div>
        )}

        {visibleGroups.map((group) => (
          <EventGroup
            key={group.lifecycle}
            title={group.title}
            events={groups[group.lifecycle]}
            lifecycle={group.lifecycle}
            featured={group.featured}
            now={now}
            onSelect={setSelectedEvent}
            highlightedEventId={highlightedEventId}
          />
        ))}

        {loaded && !hasEvents && (
          <div className="events-empty">
            <CalendarDays size={36} aria-hidden="true" />
            <p>{loadError ? "Couldn't load events right now. Please refresh to try again." : 'No events to show yet. Check back soon!'}</p>
          </div>
        )}
      </div>
      {selectedEvent && selectedLifecycle && <EventModal event={selectedEvent} lifecycle={selectedLifecycle} now={now} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
};

export default Events;
