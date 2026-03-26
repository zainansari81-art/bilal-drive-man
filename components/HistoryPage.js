import { useState, useEffect } from 'react';

const eventLabels = {
  connected: 'Drive Connected',
  disconnected: 'Drive Disconnected',
  added: 'Folder Added',
  removed: 'Folder Removed',
  size_changed: 'Size Changed',
};

const eventColors = {
  connected: '#22c55e',
  disconnected: '#ef4444',
  added: '#22c55e',
  removed: '#ef4444',
  size_changed: '#f97316',
};

export default function HistoryPage() {
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(data => setActivities(data))
      .catch(() => {});
  }, []);

  return (
    <div>
      {activities.map((a, i) => {
        const color = eventColors[a.type] || '#8c8ca1';
        return (
          <div className="history-row" key={i}>
            <span className="history-badge" style={{ background: color }}>
              {eventLabels[a.type] || a.type}
            </span>
            <span className="history-drive">{a.drive}</span>
            {a.folder && <span className="history-folder">{a.folder}</span>}
            <span className="history-time">{a.time}</span>
          </div>
        );
      })}
    </div>
  );
}
