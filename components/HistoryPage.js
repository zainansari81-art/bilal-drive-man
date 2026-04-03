import { useState, useEffect } from 'react';

const eventLabels = {
  connected: 'Drive Connected',
  disconnected: 'Drive Disconnected',
  added: 'Folder Added',
  removed: 'Folder Removed',
  size_changed: 'Size Changed',
  drive_connected: 'Drive Connected',
  drive_disconnected: 'Drive Disconnected',
  folder_added: 'Folder Added',
  folder_removed: 'Folder Removed',
  folder_returned: 'Folder Returned',
  scan_triggered: 'Scan Triggered',
  data_deleted: 'Data Deleted',
};

const eventColors = {
  connected: '#22c55e',
  disconnected: '#ef4444',
  added: '#22c55e',
  removed: '#ef4444',
  size_changed: '#f97316',
  drive_connected: '#22c55e',
  drive_disconnected: '#ef4444',
  folder_added: '#22c55e',
  folder_removed: '#ef4444',
  folder_returned: '#3b82f6',
  scan_triggered: '#8b5cf6',
  data_deleted: '#ef4444',
};

export default function HistoryPage() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(data => setActivities(Array.isArray(data) ? data : []))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px 0', color: '#8c8ca1' }}>Loading history...</div>;
  }

  if (activities.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
        <p style={{ fontSize: 18 }}>No history yet.</p>
        <p style={{ fontSize: 14 }}>Activity will appear here when drives are connected, scanned, or modified.</p>
      </div>
    );
  }

  return (
    <div>
      {activities.map((a, i) => {
        const color = eventColors[a.type] || '#8c8ca1';
        return (
          <div className="history-row scroll-reveal" key={i} style={{ transitionDelay: `${Math.min(i * 40, 400)}ms` }}>
            <span className="history-badge" style={{ background: color }}>
              {eventLabels[a.type] || a.type}
            </span>
            <span className="history-drive">{a.drive}</span>
            {a.folder && <span className="history-folder">{a.folder}</span>}
            {a.details && <span className="history-details" style={{ color: '#8c8ca1', fontSize: 12 }}>{a.details}</span>}
            <span className="history-time">{a.time}</span>
          </div>
        );
      })}
    </div>
  );
}
