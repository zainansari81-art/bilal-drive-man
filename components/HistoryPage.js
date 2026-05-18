import { useState, useEffect } from 'react';
import { Empty } from './atoms';

const TAG = {
  drive_connected:    { tag: 'Drive on',    cls: 'signal' },
  drive_disconnected: { tag: 'Drive off',   cls: 'alert'  },
  folder_added:       { tag: 'Added',       cls: 'signal' },
  folder_removed:     { tag: 'Removed',     cls: 'amber'  },
  size_changed:       { tag: 'Resized',     cls: 'amber'  },
  scan_triggered:     { tag: 'Scan',        cls: 'info'   },
  notion_sync:        { tag: 'Notion sync', cls: 'info'   },
  project_phase:      { tag: 'Phase',       cls: 'mauve'  },
  project_done:       { tag: 'Done',        cls: 'signal' },
  project_failed:     { tag: 'Failed',      cls: 'alert'  },
  data_deleted:       { tag: 'Deleted',     cls: 'alert'  },
  // legacy aliases
  connected:          { tag: 'Drive on',    cls: 'signal' },
  disconnected:       { tag: 'Drive off',   cls: 'alert'  },
  added:              { tag: 'Added',       cls: 'signal' },
  removed:            { tag: 'Removed',     cls: 'amber'  },
  folder_returned:    { tag: 'Returned',    cls: 'info'   },
};

export default function HistoryPage({ activities: initialActivities }) {
  const [activities, setActivities] = useState(initialActivities || []);
  const [loading, setLoading] = useState(!initialActivities || initialActivities.length === 0);

  useEffect(() => {
    // Always refresh from the API so the page has the latest events
    fetch('/api/history')
      .then(r => r.json())
      .then(data => setActivities(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title"><h1>History</h1></div>
        <div className="page-sub">
          Every drive event, transfer phase, and Notion sync — newest first.
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
          Loading history…
        </div>
      ) : activities.length === 0 ? (
        <Empty
          title="No history yet"
          sub="Activity will appear here when drives are connected, scanned, or modified."
        />
      ) : (
        <div className="panel flush">
          {activities.map((a, i) => {
            const c = TAG[a.type] || { tag: a.type, cls: 'info' };
            return (
              <div className="history-row" key={i}>
                <span className="ts">{a.time}</span>
                <span className={`tag ${c.cls}`}>{c.tag}</span>
                <span>
                  <span className="obj">{a.drive}</span>
                  {a.folder && a.folder !== '—' && (
                    <span style={{ color: 'var(--ink-mute)' }}> · <span className="obj">{a.folder}</span></span>
                  )}
                </span>
                <span className="det">{a.details || ''}</span>
                <span className="right">{a.actor || ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
