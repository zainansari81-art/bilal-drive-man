import { useState, useEffect } from 'react';
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

export default function Home() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [drives, setDrives] = useState([]);
  const [activities, setActivities] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = async () => {
    try {
      const [drivesRes, historyRes] = await Promise.all([
        fetch('/api/drives'),
        fetch('/api/history'),
      ]);
      const drivesData = await drivesRes.json();
      const historyData = await historyRes.json();
      setDrives(drivesData);
      setActivities(historyData);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
        />

        <main className="main">
          <Header
            currentPage={currentPage}
            onNavigate={handleNavigate}
            onQuickSearch={handleQuickSearch}
          />

          <div className="content">
            {/* Dashboard */}
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

            {/* Drives */}
            {currentPage === 'drives' && (
              <DrivesPage drives={drives} />
            )}

            {/* Search */}
            {currentPage === 'search' && (
              <SearchPage initialQuery={searchQuery} />
            )}

            {/* History */}
            {currentPage === 'history' && (
              <HistoryPage />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
