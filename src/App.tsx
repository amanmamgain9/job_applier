import { useState } from 'react';
import { OnboardingFlow, useOnboarding } from '@/components/onboarding/OnboardingFlow';
import { FileText, MessageSquare, Settings, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// Import popup components for the dashboard
import { ScanJobsButton } from '@/popup/components/ScanJobsButton';
import { TabBar } from '@/popup/components/TabBar';
import { JobQueue } from '@/popup/components/JobQueue';
import { Reports } from '@/popup/components/Reports';
import { useJobs } from '@/popup/hooks/useJobs';

type Tab = 'queue' | 'approved' | 'applied' | 'reports' | 'settings';

function Dashboard() {
  const { cv, preferences, reset } = useOnboarding();
  const { jobs, isLoading, updateStatus, refreshJobs } = useJobs();
  const [activeTab, setActiveTab] = useState<Tab>('queue');
  const [profileExpanded, setProfileExpanded] = useState(false);

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

  const handleApprove = (jobId: string) => updateStatus(jobId, 'approved');
  const handleReject = (jobId: string) => updateStatus(jobId, 'rejected');
  const handleApply = (jobId: string) => updateStatus(jobId, 'applied');

  return (
    <div className="min-h-screen bg-[#0a0a0b]">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-[#0f0f10] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">
            Job<span className="text-indigo-400">Applier</span>
          </h1>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={refreshJobs}>
              Refresh
            </Button>
            <Button 
              variant={activeTab === 'reports' ? 'secondary' : 'ghost'} 
              size="sm" 
              onClick={() => setActiveTab(activeTab === 'reports' ? 'queue' : 'reports')}
            >
              <BarChart3 className="w-4 h-4" />
              <span className="ml-1.5">Reports</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setActiveTab('settings')}>
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {activeTab === 'reports' ? (
          /* Reports View - Full Width */
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden min-h-[600px]">
            <Reports />
          </div>
        ) : (
          /* Dashboard View - Grid Layout */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left sidebar - Profile summary */}
            <div className="lg:col-span-1 space-y-4">
              {/* Collapsible Profile Section */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                <button 
                  onClick={() => setProfileExpanded(!profileExpanded)}
                  className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="text-left">
                      <h2 className="font-semibold text-white text-sm">Your Profile</h2>
                      <p className="text-xs text-zinc-500">{cv?.fileName}</p>
                    </div>
                  </div>
                  {profileExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-500" />
                  )}
                </button>
                
                {profileExpanded && (
                  <div className="px-4 pb-4 border-t border-zinc-800/50">
                    {/* CV Summary */}
                    {cv?.parsed && (
                      <div className="pt-4 space-y-3">
                        <div>
                          <p className="text-xs text-zinc-500 uppercase tracking-wide">Name</p>
                          <p className="text-sm text-white">{cv.parsed.name}</p>
                        </div>
                        {cv.parsed.skills.length > 0 && (
                          <div>
                            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Skills</p>
                            <div className="flex flex-wrap gap-1">
                              {cv.parsed.skills.slice(0, 6).map((skill, i) => (
                                <span key={i} className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-300 rounded">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Preferences */}
                    <div className="pt-4 mt-4 border-t border-zinc-800/50">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="w-4 h-4 text-blue-400" />
                        <p className="text-xs text-zinc-500 uppercase tracking-wide">Preferences</p>
                      </div>
                      <div className="space-y-1">
                        {preferences.rawChat
                          .filter((m) => m.role === 'user')
                          .slice(0, 2)
                          .map((m) => (
                            <p key={m.id} className="text-xs text-zinc-400 line-clamp-1">
                              "{m.content}"
                            </p>
                          ))}
                      </div>
                    </div>
                    
                    <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={reset}>
                      Reset Profile
                    </Button>
                  </div>
                )}
              </div>

              {/* Scan Jobs Button */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                <ScanJobsButton />
              </div>
            </div>

            {/* Main content - Job Queue */}
            <div className="lg:col-span-2">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                <TabBar
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  counts={counts}
                />
                
                <div className="min-h-[400px] max-h-[600px] overflow-y-auto">
                  <JobQueue
                    jobs={getFilteredJobs()}
                    isLoading={isLoading}
                    activeTab={activeTab}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onApply={handleApply}
                  />
                </div>

                {activeTab === 'approved' && counts.approved > 0 && (
                  <div className="p-4 border-t border-zinc-800 bg-zinc-900/80">
                    <Button size="lg" className="w-full">
                      Apply to All ({counts.approved})
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const { step, isLoading } = useOnboarding();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (step === 'complete') {
    return <Dashboard />;
  }

  return <OnboardingFlow />;
}
