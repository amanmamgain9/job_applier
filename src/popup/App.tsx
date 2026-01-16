import { useState } from 'react';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { JobQueue } from './components/JobQueue';
import { Settings } from './components/Settings';
import { ScanJobsButton } from './components/ScanJobsButton';
import { useJobs } from './hooks/useJobs';

type Tab = 'queue' | 'approved' | 'applied' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('queue');
  const { jobs, isLoading, updateStatus, refreshJobs } = useJobs();

  const getFilteredJobs = () => {
    switch (activeTab) {
      case 'queue':
        return jobs.filter(j => j.status === 'pending');
      case 'approved':
        return jobs.filter(j => j.status === 'approved');
      case 'applied':
        return jobs.filter(j => j.status === 'applied' || j.status === 'failed');
      default:
        return [];
    }
  };

  const counts = {
    queue: jobs.filter(j => j.status === 'pending').length,
    approved: jobs.filter(j => j.status === 'approved').length,
    applied: jobs.filter(j => j.status === 'applied' || j.status === 'failed').length,
  };

  const handleApprove = (jobId: string) => {
    updateStatus(jobId, 'approved');
  };

  const handleReject = (jobId: string) => {
    updateStatus(jobId, 'rejected');
  };

  const handleApply = (jobId: string) => {
    // TODO: Trigger auto-apply flow
    updateStatus(jobId, 'applied');
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg)]">
      <Header onRefresh={refreshJobs} />
      
      {activeTab !== 'settings' ? (
        <>
          <ScanJobsButton />
          <TabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            counts={counts}
          />
          <JobQueue
            jobs={getFilteredJobs()}
            isLoading={isLoading}
            activeTab={activeTab}
            onApprove={handleApprove}
            onReject={handleReject}
            onApply={handleApply}
          />
          {activeTab === 'approved' && counts.approved > 0 && (
            <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
              <button
                className="w-full py-2.5 px-4 rounded-lg font-semibold text-white
                  bg-gradient-to-r from-[var(--color-accent)] to-indigo-500
                  hover:from-indigo-500 hover:to-[var(--color-accent)]
                  transition-all duration-300 shadow-lg shadow-[var(--color-accent-glow)]"
              >
                Apply to All ({counts.approved})
              </button>
            </div>
          )}
        </>
      ) : (
        <Settings />
      )}
      
      {/* Settings toggle at bottom */}
      <button
        onClick={() => setActiveTab(activeTab === 'settings' ? 'queue' : 'settings')}
        className="absolute bottom-3 right-3 p-2 rounded-full bg-[var(--color-bg-card)] 
          border border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]
          transition-colors"
        aria-label="Settings"
      >
        <svg
          className="w-5 h-5 text-[var(--color-text-muted)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {activeTab === 'settings' ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
          )}
          {activeTab !== 'settings' && (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          )}
        </svg>
      </button>
    </div>
  );
}

