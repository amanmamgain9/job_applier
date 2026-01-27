import { JobCard } from './JobCard';
import { EmptyState } from './EmptyState';
import { Loader } from './ui/Loader';
import type { Job } from '@shared/types';

interface JobQueueProps {
  jobs: Job[];
  isLoading: boolean;
  activeTab: string;
  onApprove: (jobId: string) => void;
  onReject: (jobId: string) => void;
  onApply: (jobId: string) => void;
}

export function JobQueue({
  jobs,
  isLoading,
  activeTab,
  onApprove,
  onReject,
  onApply,
}: JobQueueProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (jobs.length === 0) {
    return <EmptyState tab={activeTab} />;
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {jobs.map((job, index) => (
        <JobCard
          key={job.id}
          job={job}
          index={index}
          activeTab={activeTab}
          onApprove={() => onApprove(job.id)}
          onReject={() => onReject(job.id)}
          onApply={() => onApply(job.id)}
        />
      ))}
    </div>
  );
}





