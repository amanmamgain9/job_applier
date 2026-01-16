import { ExternalLink, Check, X, Send, MapPin, Building2, DollarSign } from 'lucide-react';
import { clsx } from 'clsx';
import { formatRelativeTime, formatSalary } from '@shared/utils';
import { LOCATION_LABELS } from '@shared/constants';
import type { Job } from '@shared/types';

interface JobCardProps {
  job: Job;
  index: number;
  activeTab: string;
  onApprove: () => void;
  onReject: () => void;
  onApply: () => void;
}

export function JobCard({
  job,
  index,
  activeTab,
  onApprove,
  onReject,
  onApply,
}: JobCardProps) {
  const openJob = () => {
    window.open(job.url, '_blank');
  };

  return (
    <div
      className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] 
        p-3.5 animate-slide-up hover:border-[var(--color-accent)]/30 transition-all duration-200"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Company logo placeholder */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0">
          {job.companyLogo ? (
            <img src={job.companyLogo} alt={job.company} className="w-full h-full rounded-lg object-cover" />
          ) : (
            <Building2 className="w-5 h-5 text-slate-400" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--color-text)] truncate leading-tight">
            {job.title}
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] truncate">
            {job.company}
          </p>
        </div>
        
        <button
          onClick={openJob}
          className="p-1.5 rounded-lg hover:bg-[var(--color-bg-elevated)] transition-colors"
          aria-label="Open in LinkedIn"
        >
          <ExternalLink className="w-4 h-4 text-[var(--color-text-muted)]" />
        </button>
      </div>
      
      {/* Meta info */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
          <MapPin className="w-3 h-3" />
          {job.location} · {LOCATION_LABELS[job.locationType]}
        </span>
        
        {job.salary && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400">
            <DollarSign className="w-3 h-3" />
            {formatSalary(job.salary)}
          </span>
        )}
        
        {job.easyApply && (
          <span className="px-2 py-1 rounded-md bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium">
            Easy Apply
          </span>
        )}
      </div>
      
      {/* Posted time */}
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Posted {formatRelativeTime(job.postedAt)}
      </p>
      
      {/* Actions */}
      <div className="flex gap-2">
        {activeTab === 'queue' && (
          <>
            <button
              onClick={onReject}
              className="flex-1 py-2 px-3 rounded-lg font-medium text-sm
                bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]
                hover:bg-red-500/10 hover:text-red-400 transition-colors
                flex items-center justify-center gap-1.5"
            >
              <X className="w-4 h-4" />
              Skip
            </button>
            <button
              onClick={onApprove}
              className="flex-1 py-2 px-3 rounded-lg font-medium text-sm
                bg-[var(--color-accent)] text-white
                hover:bg-indigo-500 transition-colors
                flex items-center justify-center gap-1.5 shadow-lg shadow-[var(--color-accent-glow)]"
            >
              <Check className="w-4 h-4" />
              Approve
            </button>
          </>
        )}
        
        {activeTab === 'approved' && (
          <button
            onClick={onApply}
            className="flex-1 py-2 px-3 rounded-lg font-medium text-sm
              bg-gradient-to-r from-emerald-500 to-teal-500 text-white
              hover:from-emerald-600 hover:to-teal-600 transition-colors
              flex items-center justify-center gap-1.5"
          >
            <Send className="w-4 h-4" />
            Apply Now
          </button>
        )}
        
        {activeTab === 'applied' && (
          <span
            className={clsx(
              'flex-1 py-2 px-3 rounded-lg font-medium text-sm text-center',
              job.status === 'applied'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            )}
          >
            {job.status === 'applied' ? '✓ Applied' : '✗ Failed'}
          </span>
        )}
      </div>
    </div>
  );
}

