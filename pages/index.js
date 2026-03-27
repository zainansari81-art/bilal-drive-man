import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import StatCards from '../components/StatCards';
import BarChart from '../components/BarChart';
import DonutChart from '../components/DonutChart';
import DrivesList from '../components/DrivesList';
import ActivityList from '../components/ActivityList';
import DrivesPage from '../components/DrivesPage';
import SearchPage from '../components/SearchPage';
import HistoryPage from '../components/HistoryPage';
import { getSessionFromRequest } from '../lib/auth';
import { getDrivesWithClients, formatDrivesForFrontend, getHistory } from '../lib/supabase';

export async function getServerSideProps(context) {
  const session = getSessionFromRequest(context.req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  // Fetch data server-side for instant page load
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

export default function Home({ username, initialDrives, initialActivities }) {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [drives, setDrives] = useState(initialDrives || []);
  const [activities, setActivities] = useState(initialActivities || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

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
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }, []);

  useEffect(() => {
    // Auto-refresh every 30 seconds (data already loaded from server)
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleNavigate = (page) => {
    if (page !== 'search') {
      setSearchQuery('');
    }
    setCurrentPage(page);
  };

  const handleQuickSearch = (query) => {
    setSearchQuery(query);
  };

  const handleScan = async () => {
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      }
    } catch (err) {
      console.error('Scan failed:', err);
    }
  };

  return (
    <>
      <Head>
        <title>Bilal - Drive Man</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💾</text></svg>" />
      </Head>

      <div className="app-layout">
        <Sidebar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          driveCount={drives.length}
          onScan={handleScan}
          username={username}
        />

        <main className="main">
          <Header
            currentPage={currentPage}
            onNavigate={handleNavigate}
            onQuickSearch={handleQuickSearch}
          />

          <div className="content">
            {currentPage === 'dashboard' && (
              <div>
                <StatCards drives={drives} />
                <div className="charts-row">
                  <BarChart drives={drives} />
                  <DonutChart drives={drives} />
                </div>
                <div className="bottom-row">
                  <DrivesList drives={drives} />
                  <ActivityList activities={activities} />
                </div>
              </div>
            )}

            {currentPage === 'drives' && (
              <DrivesPage drives={drives} />
            )}

            {currentPage === 'search' && (
              <SearchPage initialQuery={searchQuery} />
            )}

            {currentPage === 'history' && (
              <HistoryPage />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
