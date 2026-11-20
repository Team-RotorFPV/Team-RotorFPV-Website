import React, { useState } from 'react';
import { fetchLogs } from '../../lib/adminApi';
import useAsyncData from '../../hooks/useAsyncData';

const LogsTab = () => {
  const { data: logsData, loading, error: loadError, reload: loadLogs } = useAsyncData(fetchLogs);
  const logs = logsData || [];
  const error = loadError ? "Failed to load logs. You might not have permission." : null;
  const [filter, setFilter] = useState('all');

  const FILTERS = [
    { key: 'all', label: 'All Logs' },
    { key: 'activity', label: 'Website Changes' },
    { key: 'audit', label: 'Admin & Inventory' },
    { key: 'contact', label: 'Contact Messages' }
  ];

  // Completely remove page views from the frontend feed
  const logsWithoutVisits = logs.filter(log => log.type !== 'visit');
  const filteredLogs = logsWithoutVisits.filter(log => filter === 'all' ? true : log.type === filter);






  if (loading) {
    return (
      <div className="admin-grid">
        <div className="admin-span-full">
          <div className="admin-glass-panel flex-center" style={{ minHeight: '300px' }}>
            <div className="loading-spinner">Loading logs…</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-grid">
        <div className="admin-span-full">
          <div className="admin-glass-panel form-panel">
            <h2>Activity Logs</h2>
            <p className="empty-state" style={{ color: 'var(--tr-red)' }}>{error}</p>
            <button onClick={loadLogs} className="admin-btn primary">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-grid">
      <div className="admin-span-full">
        <div className="admin-glass-panel list-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ margin: 0 }}>Activity Logs</h2>
            <button onClick={loadLogs} className="admin-btn secondary small" style={{ width: 'auto' }}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="admin-input"
              style={{ width: '100%', maxWidth: '300px' }}
            >
              {FILTERS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>
          
          <div className="achievements-list" style={{ gap: '1rem', display: 'flex', flexDirection: 'column' }}>
            {filteredLogs.length === 0 ? (
              <p className="empty-state">No logs found in this category.</p>
            ) : (
              filteredLogs.map(log => (
                <div key={log.id} className="admin-achievement-card" style={{ padding: '1rem', display: 'block', borderLeft: `4px solid ${log.type === 'audit' ? 'var(--tr-red)' : 'var(--tr-primary)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong style={{ textTransform: 'capitalize' }}>{log.type} Log</strong>
                      <span className="status-badge" style={{ background: 'rgba(255,255,255,0.1)' }}>{log.action}</span>
                    </div>
                    <span className="order-badge" style={{ fontSize: '0.8rem' }}>
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--text-dim)' }}>User / IP:</span>
                    <span>{log.user || 'System'}</span>
                    
                    <span style={{ color: 'var(--text-dim)' }}>Target:</span>
                    <span>{log.target}</span>
                    
                    <span style={{ color: 'var(--text-dim)' }}>Details:</span>
                    <span style={{ color: 'var(--text-light)' }}>{log.details}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogsTab;
