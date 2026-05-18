import { LED, Gauge, Fuel, Runway, Src, SectionHead, Empty, fmtBytes, fmtTB, fmtPct } from './atoms';

const EVENT_CONF = {
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

export default function DashboardPage({ drives, activities, onNavigate }) {
  const totalCap = drives.reduce((s, d) => s + d.total, 0);
  const totalUsed = drives.reduce((s, d) => s + d.used, 0);
  const totalFree = drives.reduce((s, d) => s + d.free, 0);
  const connected = drives.filter(d => d.connected);
  const allCouples = drives.reduce(
    (s, d) => s + (d.clients || []).reduce((a, c) => a + c.couples.length, 0), 0
  );
  const allClients = new Set();
  drives.forEach(d => (d.clients || []).forEach(c => allClients.add(c.name)));

  const totalPct = fmtPct(totalUsed, totalCap);

  return (
    <div className="fade-in">
      {/* ── HERO ── */}
      <div className="hero-block">
        <div className="hero-stat">
          <span className="label" style={{ display: 'block', marginBottom: 12 }}>Total storage</span>
          <div className="hero-num">
            {fmtTB(totalCap)}<span className="unit">TB</span>
          </div>
          <div className="sub-row">
            <div>
              <span className="label">Used</span>
              <span className="num" style={{ fontSize: 16, marginTop: 2, color: 'var(--ink-2)', display: 'block' }}>
                {fmtTB(totalUsed)} TB · {totalPct}%
              </span>
            </div>
            <div>
              <span className="label">Free</span>
              <span className="num" style={{ fontSize: 16, marginTop: 2, color: 'var(--ink-2)', display: 'block' }}>
                {fmtTB(totalFree)} TB
              </span>
            </div>
            <div>
              <span className="label">Drives connected</span>
              <span className="num" style={{ fontSize: 16, marginTop: 2, color: 'var(--ink-2)', display: 'block', whiteSpace: 'nowrap' }}>
                {connected.length} <span style={{ color: 'var(--ink-mute)' }}>of {drives.length}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="hero-side">
          <span className="label">Today</span>
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <LED state="on" />
            <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>All systems online</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {drives.length} drives tracked
          </div>
        </div>
      </div>

      {/* ── METRIC TILES ── */}
      <div className="metrics-row">
        <div className="metric">
          <div className="head">
            <span className="ch">Couples</span>
            <LED state="on" />
          </div>
          <div className="v">{allCouples}</div>
          <div className="lbl">Across all drives</div>
          <div className="micro">From {allClients.size} clients</div>
        </div>

        <div className="metric">
          <div className="head">
            <span className="ch">Connected drives</span>
            <LED state={connected.length > 0 ? 'on' : 'off'} />
          </div>
          <div className="v">
            {connected.length}
            <span className="small"> of {drives.length}</span>
          </div>
          <div className="lbl">Drives mounted and visible</div>
        </div>

        <div className="metric">
          <div className="head">
            <span className="ch">Space used</span>
            <LED state={totalPct > 90 ? 'alert' : totalPct > 70 ? 'warn' : 'on'} />
          </div>
          <div className="v">
            {totalPct}
            <span className="small">%</span>
          </div>
          <div className="lbl">Across the fleet</div>
          <div className="micro">{fmtTB(totalUsed)} of {fmtTB(totalCap)} TB</div>
        </div>

        <div className="metric">
          <div className="head">
            <span className="ch">Recent events</span>
            <LED state="info" />
          </div>
          <div className="v">{activities.length}</div>
          <div className="lbl">In the last scan</div>
        </div>
      </div>

      {/* ── DRIVE BAY ── */}
      <SectionHead
        ch={`${connected.length} connected`}
        title="Drive bay"
        right={
          <button className="btn ghost sm" onClick={() => onNavigate('drives')}>
            View all →
          </button>
        }
      />
      <div className="panel flush">
        {connected.slice(0, 5).map((d) => {
          const pct = fmtPct(d.used, d.total);
          const clientsCount = (d.clients || []).length;
          const couplesCount = (d.clients || []).reduce((s, c) => s + c.couples.length, 0);
          return (
            <div className="bay-row" key={d.id || d.name}>
              <LED state="on" />
              <div>
                <div className="nm">{d.name}</div>
                <div className="machine">
                  {d.letter ? `${d.letter}:\\ · ` : ''}{d.sourceMachine} · {clientsCount} clients · {couplesCount} couples
                </div>
              </div>
              <div className="use">{fmtTB(d.used)} / {fmtTB(d.total)} TB</div>
              <Gauge pct={pct} sm />
              <div className="meta-2">{fmtBytes(d.free)} free</div>
              <div className="pct">{pct}<span className="pct-sign">%</span></div>
            </div>
          );
        })}
        {connected.length === 0 && (
          <Empty title="No drives connected" sub="Connect an external drive and run the scanner." />
        )}
      </div>

      {/* ── RECENT ACTIVITY ── */}
      <SectionHead
        ch="Last 24 hours"
        title="Recent activity"
        right={
          <button className="btn ghost sm" onClick={() => onNavigate('history')}>
            Full history →
          </button>
        }
      />
      <div className="panel flush">
        <div className="log">
          {activities.slice(0, 8).map((a, i) => {
            const conf = EVENT_CONF[a.type] || { tag: a.type, cls: 'info' };
            return (
              <div className="log-row" key={i}>
                <span className="ts">{a.time}</span>
                <LED
                  state={
                    conf.cls === 'alert' ? 'alert'
                    : conf.cls === 'amber' ? 'warn'
                    : conf.cls === 'info' ? 'info'
                    : conf.cls === 'mauve' ? 'mauve'
                    : 'on'
                  }
                />
                <span className={`tag ${conf.cls}`}>{conf.tag}</span>
                <span>
                  <span className="actor">{a.drive}</span>
                  {a.folder && <span style={{ color: 'var(--ink-mute)' }}> · {a.folder}</span>}
                </span>
                <span className="right">{a.actor || ''}</span>
              </div>
            );
          })}
          {activities.length === 0 && (
            <Empty title="No recent activity" sub="Activity will appear here after the next scan." />
          )}
        </div>
      </div>
    </div>
  );
}
