import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import DashboardPage from '../components/DashboardPage';
import DrivesPage from '../components/DrivesPage';
import DevicesPage from '../components/DevicesPage';
import DownloadingProPage from '../components/DownloadingProPage';
import SearchPage from '../components/SearchPage';
import HistoryPage from '../components/HistoryPage';
import { getSessionFromRequest } from '../lib/auth';
import { getDrivesWithClients, formatDrivesForFrontend, getHistory } from '../lib/supabase';

export async function getServerSideProps(context) {
  const session = getSessionFromRequest(context.req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  try {
    const [rawDrives, rawHistory] = await Promise.all([
      getDrivesWithClients(),
      getHistory(50),
    ]);
    const drives = formatDrivesForFrontend(rawDrives);
    return {
      props: {
        username: session.username,
        initialDrives: drives,
        initialActivities: rawHistory,
      },
    };
  } catch (err) {
    console.error('SSR data fetch error:', err);
    return {
      props: {
        username: session.username,
        initialDrives: [],
        initialActivities: [],
      },
    };
  }
}

const VALID_PAGES = ['dashboard', 'drives', 'devices', 'downloading', 'search', 'history'];

function getPageFromHash() {
  if (typeof window === 'undefined') return 'dashboard';
  const hash = window.location.hash.replace('#', '');
  return VALID_PAGES.includes(hash) ? hash : 'dashboard';
}

export default function Home({ username, initialDrives, initialActivities }) {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [drives, setDrives] = useState(initialDrives || []);
  const [activities, setActivities] = useState(initialActivities || []);
  const [searchQuery, setSearchQuery] = useState('');
  const REFRESH_INTERVAL = 300; // 5 minutes
  const [refreshCountdown, setRefreshCountdown] = useState(REFRESH_INTERVAL);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  // projects state passed down to Sidebar for active-count badge
  const [projects, setProjects] = useState([]);

  // Restore page from URL hash on mount + listen for hash changes
  useEffect(() => {
    const page = getPageFromHash();
    if (page !== 'dashboard') {
      setCurrentPage(page);
    }
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#dashboard');
    }

    const onHashChange = () => {
      setCurrentPage(getPageFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [drivesRes, historyRes] = await Promise.all([
        fetch('/api/drives'),
        fetch('/api/history'),
      ]);
      const drivesData = await drivesRes.json();
      const historyData = await historyRes.json();
      setDrives(Array.isArray(drivesData) ? drivesData : []);
      setActivities(Array.isArray(historyData) ? historyData : []);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
    setRefreshCountdown(REFRESH_INTERVAL);
  }, [REFRESH_INTERVAL]);

  useEffect(() => {
    const tick = setInterval(() => {
      setRefreshCountdown(prev => {
        if (prev <= 1) {
          fetchData();
          return REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [fetchData, REFRESH_INTERVAL]);

  const handleNavigate = (page) => {
    if (page !== 'search') {
      setSearchQuery('');
    }
    setCurrentPage(page);
    window.location.hash = page;
  };

  const handleQuickSearch = (query) => {
    setSearchQuery(query);
  };

  return (
    <>
      <Head>
        <title>Bilal - Drive Man</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='5' y='15' width='90' height='70' rx='10' fill='%231a1a2e'/><rect x='12' y='22' width='76' height='40' rx='5' fill='%2384CC16'/><circle cx='30' cy='72' r='5' fill='%2384CC16'/><circle cx='45' cy='72' r='5' fill='%2384CC16'/><rect x='60' y='68' width='22' height='8' rx='3' fill='%2384CC16'/></svg>" />
      </Head>

      <div className="app">
        <Sidebar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          projects={projects}
        />

        <Header
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onQuickSearch={handleQuickSearch}
          refreshCountdown={refreshCountdown}
          lastRefreshed={lastRefreshed}
          refreshInterval={REFRESH_INTERVAL}
          onRefreshNow={() => { fetchData(); setRefreshCountdown(REFRESH_INTERVAL); }}
        />

        <main className="main" key={currentPage}>
          {currentPage === 'dashboard' && (
            <DashboardPage
              drives={drives}
              activities={activities}
              onNavigate={handleNavigate}
            />
          )}

          {currentPage === 'drives' && (
            <DrivesPage drives={drives} />
          )}

          {currentPage === 'devices' && (
            <DevicesPage drives={drives} />
          )}

          {currentPage === 'downloading' && (
            <DownloadingProPage
              drives={drives}
              onProjectsChange={setProjects}
            />
          )}

          {currentPage === 'search' && (
            <SearchPage initialQuery={searchQuery} drives={drives} />
          )}

          {currentPage === 'history' && (
            <HistoryPage activities={activities} />
          )}
        </main>
      </div>
    </>
  );
}
