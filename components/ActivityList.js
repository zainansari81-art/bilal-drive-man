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
};

const iconMap = {
  connected: { symbol: '\u25B2', cls: 'green' },
  disconnected: { symbol: '\u25BC', cls: 'red' },
  added: { symbol: '+', cls: 'green' },
  removed: { symbol: '\u2212', cls: 'red' },
  size_changed: { symbol: '\u2194', cls: 'orange' },
  drive_connected: { symbol: '\u25B2', cls: 'green' },
  drive_disconnected: { symbol: '\u25BC', cls: 'red' },
  folder_added: { symbol: '+', cls: 'green' },
  folder_removed: { symbol: '\u2212', cls: 'red' },
  folder_returned: { symbol: '\u21BA', cls: 'blue' },
  scan_triggered: { symbol: '\u21BB', cls: 'orange' },
};

export default function ActivityList({ activities }) {
  const items = (activities || []).slice(0, 8);

  if (items.length === 0) {
    return (
      <div className="list-card">
        <div className="list-header">
          <div className="list-title">{'\u29D6'} Recent Activity</div>
        </div>
        <div style={{ textAlign: 'center', padding: '30px 0', color: '#8c8ca1', fontSize: 13 }}>
          No activity yet
        </div>
      </div>
    );
  }

  return (
    <div className="list-card">
      <div className="list-header">
        <div className="list-title">{'\u29D6'} Recent Activity</div>
      </div>
      <div>
        {items.map((a, i) => {
          const info = iconMap[a.type] || { symbol: '?', cls: 'blue' };
          return (
            <div className="activity-row" key={i}>
              <div className={`activity-icon-box ${info.cls}`}>{info.symbol}</div>
              <div className="activity-info">
                <div className="activity-title">{eventLabels[a.type] || a.type} - {a.drive}</div>
                {a.folder && <div className="activity-detail">{a.folder}</div>}
              </div>
              <div className="activity-time">{a.time}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
