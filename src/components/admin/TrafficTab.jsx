import React from 'react';
import { fetchAnalytics } from '../../lib/adminApi';
import useAsyncData from '../../hooks/useAsyncData';

// ISO-2 country code -> string. (Emojis removed per request)
const formatCountryCode = (cc) => {
  if (!cc || cc.length !== 2) return '🌐';
  return cc.toUpperCase();
};

// ISO-2 country code -> full English name, via the browser's Intl API.
let regionNames;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regionNames = null;
}
const countryName = (cc) => {
  if (!cc || cc === 'Unknown') return 'Unknown';
  try {
    return regionNames?.of(cc) || cc;
  } catch {
    return cc;
  }
};

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
};

const TrafficTab = () => {
  const { data, loading, error: loadError, reload: load } = useAsyncData(fetchAnalytics);
  const error = loadError ? (loadError.message || 'Failed to load analytics') : '';

  const stats = data
    ? [
        { label: 'Total Page Views', value: data.totalVisits },
        { label: 'Unique Visitors', value: data.uniqueVisitors, hint: 'anonymised' },
        { label: 'Last 24 Hours', value: data.last24h },
        { label: 'Last 7 Days', value: data.last7d },
      ]
    : [];

  const maxCountry = data?.byCountry?.[0]?.count || 1;

  return (
    <div className="traffic-tab admin-full">
      <div className="admin-glass-panel">
        <div className="traffic-header">
          <h2>Website Traffic</h2>
          <button onClick={load} className="admin-btn secondary small" disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && <p className="empty-state text-error">{error}</p>}

        {loading && !data && <div className="loading-spinner">Loading traffic data…</div>}

        {data && (
          <>
            <div className="traffic-stats">
              {stats.map((s) => (
                <div key={s.label} className="traffic-stat-card">
                  <span className="traffic-stat-value">{s.value.toLocaleString('en-IN')}</span>
                  <span className="traffic-stat-label">
                    {s.label}
                    {s.hint && <em> ({s.hint})</em>}
                  </span>
                </div>
              ))}
            </div>

            {data.windowCapped && (
              <p className="field-hint">
                Breakdowns below are based on the most recent {data.scannedWindow.toLocaleString('en-IN')} page
                views. Total page views above is the lifetime count.
              </p>
            )}

            <div className="traffic-grid">
              {/* Country breakdown */}
              <div className="traffic-section">
                <h3 className="traffic-subhead">Visitors by Country</h3>
                {data.byCountry.length === 0 && <p className="empty-state">No data yet.</p>}
                <div className="country-list">
                  {data.byCountry.map((c) => (
                    <div key={c.country} className="country-row">
                      <span className="country-flag">{formatCountryCode(c.country)}</span>
                      <span className="country-name">{countryName(c.country)}</span>
                      <div className="country-bar-track">
                        <div
                          className="country-bar-fill"
                          style={{ width: `${(c.count / maxCountry) * 100}%` }}
                        />
                      </div>
                      <span className="country-count">{c.count.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent visits */}
              <div className="traffic-section">
                <h3 className="traffic-subhead">Recent Visits</h3>
                {data.recent.length === 0 && <p className="empty-state">No visits recorded yet.</p>}
                <div className="visits-table-wrap">
                  {data.recent.length > 0 && (
                    <table className="visits-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Location</th>
                          <th>Visitor</th>
                          <th>Page</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent.map((v, i) => (
                          <tr key={`${v.visitor}-${v.timestamp}-${i}`}>
                            <td>{formatTime(v.timestamp)}</td>
                            <td>
                              <span className="visit-flag">{formatCountryCode(v.country)}</span>
                              {[v.region, countryName(v.country)]
                                .filter(Boolean)
                                .filter((x) => x !== 'Unknown')
                                .join(', ') || 'Unknown'}
                            </td>
                            <td className="visit-ip" title="Anonymised visitor ID (a keyed hash of the IP)">{v.visitor ? v.visitor.slice(0, 8) : '—'}</td>
                            <td className="visit-path">{v.path}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TrafficTab;
