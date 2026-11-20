import React, { useState, useEffect } from 'react';

/* Brand icons (react-icons) */
import { FaInstagram, FaLinkedin, FaYoutube, FaGithub, FaFacebook, FaWhatsapp, FaDiscord, FaSpotify, FaTwitch } from 'react-icons/fa';
import { FaXTwitter, FaThreads, FaTelegram as FaTelegramBrand } from 'react-icons/fa6';

/* Generic icons (lucide-react) */
import {
  Mail, Globe, Link as LinkIcon, Phone, MapPin, Music,
  ShoppingBag, FileText, Calendar, Users, Rss, Disc, ExternalLink,
} from 'lucide-react';

import './Footer.css';

/* ── Icon mapping (matches SocialsTab + socials link tree app) ── */
const ICON_MAP = {
  instagram: FaInstagram,
  youtube: FaYoutube,
  linkedin: FaLinkedin,
  twitter: FaXTwitter,
  x: FaXTwitter,
  github: FaGithub,
  facebook: FaFacebook,
  whatsapp: FaWhatsapp,
  discord: FaDiscord,
  telegram: FaTelegramBrand,
  spotify: FaSpotify,
  twitch: FaTwitch,
  threads: FaThreads,
  mail: Mail,
  email: Mail,
  globe: Globe,
  website: Globe,
  link: LinkIcon,
  phone: Phone,
  location: MapPin,
  music: Music,
  shop: ShoppingBag,
  store: ShoppingBag,
  blog: FileText,
  document: FileText,
  calendar: Calendar,
  events: Calendar,
  team: Users,
  community: Users,
  rss: Rss,
  podcast: Disc,
  external: ExternalLink,
};

const Footer = () => {
  const [socialLinks, setSocialLinks] = useState([]);

  useEffect(() => {
    const fetchLinks = async () => {
      try {
        // Footer is on every page and in the main chunk, so Firebase is loaded
        // on demand; a static import pulled all of Firestore into first paint.
        const [{ db }, { collection, getDocs, query, orderBy }] = await Promise.all([
          import('../firebase'),
          import('firebase/firestore'),
        ]);
        const q = query(collection(db, 'social_links'), orderBy('order', 'asc'));
        const snapshot = await getDocs(q);
        const data = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(link => link.enabled !== false);
        setSocialLinks(data);
      } catch (err) {
        console.error('Footer: failed to fetch social links:', err);
      }
    };
    fetchLinks();
  }, []);

  return (
    <footer className="footer glass">
      <div className="container footer-container">
        <p className="copyright">&copy; {new Date().getFullYear()} Team RotorFPV</p>
        <div className="social-links">
          {socialLinks.map((link) => {
            const Icon = ICON_MAP[link.icon?.toLowerCase()] || LinkIcon;
            return (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.title}
              >
                <Icon size={20} />
              </a>
            );
          })}
        </div>
      </div>
    </footer>
  );
};

export default Footer;
