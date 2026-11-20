import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { logAdminAction } from '../../lib/adminApi';

/* Brand icons (react-icons) */
import { FaInstagram, FaYoutube, FaLinkedin, FaGithub, FaFacebook, FaWhatsapp, FaDiscord, FaSpotify, FaTwitch } from 'react-icons/fa';
import { FaXTwitter, FaThreads, FaTelegram as FaTelegramBrand } from 'react-icons/fa6';

/* Generic icons (lucide-react) */
import {
  Mail, Globe, Link as LinkIcon, Phone, MapPin, Music,
  ShoppingBag, FileText, Calendar, Users, Rss, Disc,
  ExternalLink, Eye, EyeOff,
} from 'lucide-react';

/* ── All supported icons ── */
const ICON_OPTIONS = [
  { key: 'instagram',  label: 'Instagram',      component: FaInstagram },
  { key: 'youtube',    label: 'YouTube',         component: FaYoutube },
  { key: 'linkedin',   label: 'LinkedIn',        component: FaLinkedin },
  { key: 'twitter',    label: 'Twitter / X',     component: FaXTwitter },
  { key: 'github',     label: 'GitHub',          component: FaGithub },
  { key: 'facebook',   label: 'Facebook',        component: FaFacebook },
  { key: 'whatsapp',   label: 'WhatsApp',        component: FaWhatsapp },
  { key: 'discord',    label: 'Discord',         component: FaDiscord },
  { key: 'telegram',   label: 'Telegram',        component: FaTelegramBrand },
  { key: 'spotify',    label: 'Spotify',         component: FaSpotify },
  { key: 'twitch',     label: 'Twitch',          component: FaTwitch },
  { key: 'threads',    label: 'Threads',         component: FaThreads },
  { key: 'mail',       label: 'Email',           component: Mail },
  { key: 'globe',      label: 'Website',         component: Globe },
  { key: 'link',       label: 'Link',            component: LinkIcon },
  { key: 'phone',      label: 'Phone',           component: Phone },
  { key: 'location',   label: 'Location',        component: MapPin },
  { key: 'music',      label: 'Music',           component: Music },
  { key: 'shop',       label: 'Shop',            component: ShoppingBag },
  { key: 'blog',       label: 'Blog / Document', component: FileText },
  { key: 'calendar',   label: 'Calendar',        component: Calendar },
  { key: 'team',       label: 'Team',            component: Users },
  { key: 'rss',        label: 'RSS',             component: Rss },
  { key: 'podcast',    label: 'Podcast',         component: Disc },
  { key: 'external',   label: 'External Link',   component: ExternalLink },
];

const ICON_MAP = Object.fromEntries(ICON_OPTIONS.map(o => [o.key, o.component]));

const EMPTY_FORM = { title: '', url: '', icon: 'link', order: 10, enabled: true };

const SocialsTab = () => {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  /* Real-time sync */
  useEffect(() => {
    const q = query(collection(db, 'social_links'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setLinks(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => {
      console.error('Error fetching social_links:', error);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      title: item.title || '',
      url: item.url || '',
      icon: item.icon || 'link',
      order: item.order ?? 10,
      enabled: item.enabled !== false,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (item) => {
    if (window.confirm(`Delete "${item.title}"?`)) {
      try {
        await deleteDoc(doc(db, 'social_links', item.id));
        await logAdminAction('DELETE', 'SocialLink', `Deleted social link: ${item.title}`);
      } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete. You might not have permission.');
      }
    }
  };

  const handleToggleEnabled = async (item) => {
    try {
      const newEnabled = item.enabled === false ? true : false;
      await updateDoc(doc(db, 'social_links', item.id), { enabled: newEnabled });
      await logAdminAction('UPDATE', 'SocialLink',
        `${newEnabled ? 'Enabled' : 'Disabled'} social link: ${item.title}`);
    } catch (error) {
      console.error('Toggle error:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const dataToSave = {
      title: formData.title.trim(),
      url: formData.url.trim(),
      icon: formData.icon,
      order: Number(formData.order),
      enabled: formData.enabled,
    };

    if (!dataToSave.title || !dataToSave.url) {
      alert('Title and URL are required.');
      return;
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, 'social_links', editingId), dataToSave);
        await logAdminAction('UPDATE', 'SocialLink', `Updated social link: ${dataToSave.title}`);
      } else {
        await addDoc(collection(db, 'social_links'), dataToSave);
        await logAdminAction('CREATE', 'SocialLink', `Created social link: ${dataToSave.title}`);
      }
      resetForm();
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save. You might not have permission.');
    }
  };

  const SelectedIcon = ICON_MAP[formData.icon] || LinkIcon;

  return (
    <div className="admin-grid">
      {/* ── Left: Form ── */}
      <div className="admin-left-column">
        <div className="admin-glass-panel form-panel">
          <h2>{editingId ? 'Edit Social Link' : 'Add Social Link'}</h2>
          <form onSubmit={handleSubmit} className="admin-form">

            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                placeholder="e.g. Instagram"
              />
            </div>

            <div className="form-group">
              <label>URL</label>
              <input
                type="url"
                name="url"
                value={formData.url}
                onChange={handleChange}
                required
                placeholder="https://instagram.com/teamrotorfpv"
              />
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>Icon</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: 'rgba(100, 255, 218, 0.08)',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}>
                    <SelectedIcon size={20} />
                  </div>
                  <select
                    name="icon"
                    value={formData.icon}
                    onChange={handleChange}
                    style={{ flex: 1 }}
                  >
                    {ICON_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label>Order</label>
                <input
                  type="number"
                  name="order"
                  value={formData.order}
                  onChange={handleChange}
                  required
                  min="0"
                />
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="enabled"
                  checked={formData.enabled}
                  onChange={handleChange}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                />
                Visible on link tree &amp; footer
              </label>
            </div>

            <div className="form-actions">
              {editingId && (
                <button type="button" onClick={resetForm} className="admin-btn cancel">
                  Cancel
                </button>
              )}
              <button type="submit" className="admin-btn primary">
                {editingId ? 'Update Link' : 'Add Link'}
              </button>
            </div>
          </form>
        </div>

        {/* Info box */}
        <div className="admin-glass-panel" style={{ marginTop: '16px', padding: '16px 20px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: 'var(--accent)' }}>💡 Tip:</strong> Links added here
            appear on both <strong>socials.teamrotorfpv.com</strong> and the
            main website footer. Use the <em>order</em> field to control sort
            (lower = first). Toggle visibility without deleting.
          </p>
        </div>
      </div>

      {/* ── Right: List ── */}
      <div className="admin-right-column">
        <div className="admin-glass-panel list-panel">
          <h2>Current Social Links</h2>
          <div className="achievements-list">
            {links.map((item) => {
              const Icon = ICON_MAP[item.icon] || LinkIcon;
              const isDisabled = item.enabled === false;
              return (
                <div
                  key={item.id}
                  className="admin-achievement-card"
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  <div className="card-info" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: 'rgba(100, 255, 218, 0.08)',
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}>
                      <Icon size={18} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {item.title}
                        <span className="order-badge">#{item.order}</span>
                        {isDisabled && (
                          <span style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 77, 79, 0.15)',
                            color: '#ff4d4f',
                          }}>
                            Hidden
                          </span>
                        )}
                      </h3>
                      <p className="card-desc" style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '300px',
                      }}>
                        {item.url}
                      </p>
                    </div>
                  </div>
                  <div className="card-actions" style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => handleToggleEnabled(item)}
                      className="admin-btn edit small"
                      title={isDisabled ? 'Enable' : 'Disable'}
                      style={{ padding: '6px' }}
                    >
                      {isDisabled ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button onClick={() => handleEdit(item)} className="admin-btn edit small">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(item)} className="admin-btn delete small">
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
            {!loading && links.length === 0 && (
              <p className="empty-state">No social links yet. Add one above.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SocialsTab;
