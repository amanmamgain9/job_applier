import { useState, useEffect } from 'react';
import { FileText, ChevronRight, Clock, CheckCircle, XCircle, Zap, MessageSquare, MousePointer, ArrowLeft, Download } from 'lucide-react';
import type { SessionReport, StepLog, ActionLog } from '@/services/automation/types';
import { createMessage } from '@shared/types/messages';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getActionIcon(action: string) {
  if (action.includes('llm') || action.includes('LLM')) {
    return <MessageSquare className="w-3.5 h-3.5" />;
  }
  if (action.includes('click') || action.includes('input')) {
    return <MousePointer className="w-3.5 h-3.5" />;
  }
  return <Zap className="w-3.5 h-3.5" />;
}

function getStatusColor(status: 'start' | 'ok' | 'fail'): string {
  switch (status) {
    case 'ok': return 'text-emerald-400';
    case 'fail': return 'text-red-400';
    default: return 'text-amber-400';
  }
}

function getStatusBg(status: 'start' | 'ok' | 'fail'): string {
  switch (status) {
    case 'ok': return 'bg-emerald-500/10 border-emerald-500/30';
    case 'fail': return 'bg-red-500/10 border-red-500/30';
    default: return 'bg-amber-500/10 border-amber-500/30';
  }
}

// Action Log Item
function ActionItem({ action, isLast }: { action: ActionLog; isLast: boolean }) {
  return (
    <div className="relative flex gap-3 pb-3">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--color-border)]" />
      )}
      
      {/* Icon */}
      <div className={`relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${getStatusBg(action.status)}`}>
        <span className={getStatusColor(action.status)}>
          {getActionIcon(action.action)}
        </span>
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--color-text)]">{action.action}</span>
          <span className={`text-[10px] uppercase font-semibold ${getStatusColor(action.status)}`}>
            {action.status}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
            {formatTime(action.timestamp)}
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
          {action.details}
        </p>
        {action.error && (
          <p className="text-xs text-red-400 mt-0.5 truncate">
            {action.error}
          </p>
        )}
      </div>
    </div>
  );
}

// Step Log Item
function StepItem({ step, isExpanded, onToggle }: { step: StepLog; isExpanded: boolean; onToggle: () => void }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* Step Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-elevated)] transition-colors"
      >
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
          step.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {step.step}
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm text-[var(--color-text)] truncate">{step.goal || `Step ${step.step}`}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {step.actions.length} actions
          </p>
        </div>
        <ChevronRight className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>
      
      {/* Actions List */}
      {isExpanded && step.actions.length > 0 && (
        <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
          {step.actions.map((action, idx) => (
            <ActionItem key={idx} action={action} isLast={idx === step.actions.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// Report Detail View
function ReportDetail({ report, onBack }: { report: SessionReport; onBack: () => void }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (stepNum: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepNum)) {
        next.delete(stepNum);
      } else {
        next.add(stepNum);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSteps(new Set(report.steps.map(s => s.step)));
  };

  const collapseAll = () => {
    setExpandedSteps(new Set());
  };

  const exportAsJson = () => {
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const filename = `report-${report.searchQuery?.replace(/[^a-z0-9]/gi, '-') || 'session'}-${new Date(report.startedAt).toISOString().split('T')[0]}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-card)] transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)]" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--color-text)] truncate">
              {report.searchQuery || 'Discovery Session'}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {formatDate(report.startedAt)} • {formatDuration(report.duration)}
            </p>
          </div>
          <div className={`px-2 py-1 rounded-full text-xs font-medium ${
            report.success ? 'bg-emerald-500/20 text-emerald-400' : 
            report.stoppedReason === 'running' ? 'bg-amber-500/20 text-amber-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {report.success ? 'Success' : report.stoppedReason === 'running' ? 'Running' : 'Failed'}
          </div>
          <button
            onClick={exportAsJson}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-card)] transition-colors"
            title="Export as JSON"
          >
            <Download className="w-5 h-5 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 p-3">
        <div className="p-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-center">
          <p className="text-lg font-bold text-[var(--color-accent)]">{report.jobsFound}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Jobs</p>
        </div>
        <div className="p-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-center">
          <p className="text-lg font-bold text-[var(--color-text)]">{report.totalSteps}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Steps</p>
        </div>
        <div className="p-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-center">
          <p className="text-lg font-bold text-[var(--color-text)]">{report.totalActions}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Actions</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-3 pb-2">
        <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
          Timeline
        </h3>
        <div className="flex gap-1">
          <button
            onClick={expandAll}
            className="px-2 py-1 text-[10px] rounded bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 text-[10px] rounded bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Steps Timeline */}
      <div className="px-3 pb-4 space-y-2">
        {report.steps.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
            No steps recorded
          </div>
        ) : (
          report.steps.map((step) => (
            <StepItem
              key={step.step}
              step={step}
              isExpanded={expandedSteps.has(step.step)}
              onToggle={() => toggleStep(step.step)}
            />
          ))
        )}
      </div>

      {/* Error if any */}
      {report.error && (
        <div className="mx-3 mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-xs font-semibold text-red-400 mb-1">Error</p>
          <p className="text-xs text-red-300">{report.error}</p>
        </div>
      )}
    </div>
  );
}

// Report List Item
function ReportListItem({ report, onClick }: { report: SessionReport; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] 
        hover:border-[var(--color-accent)]/50 transition-all text-left group"
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${report.success ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
          {report.success ? (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)] truncate group-hover:text-[var(--color-accent)] transition-colors">
            {report.searchQuery || 'Discovery Session'}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-muted)]">
            <Clock className="w-3 h-3" />
            <span>{formatDate(report.startedAt)}</span>
            <span>•</span>
            <span>{formatDuration(report.duration)}</span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-[var(--color-accent)]">{report.jobsFound} jobs</span>
            <span className="text-xs text-[var(--color-text-muted)]">{report.totalSteps} steps</span>
            <span className="text-xs text-[var(--color-text-muted)]">{report.totalActions} actions</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors" />
      </div>
    </button>
  );
}

// Main Reports Component
export function Reports() {
  const [reports, setReports] = useState<SessionReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<SessionReport | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await chrome.runtime.sendMessage(
        createMessage('GET_SESSION_REPORT', undefined)
      );
      if (response?.allReports) {
        // Sort by most recent first
        const sorted = [...response.allReports].sort((a, b) => b.startedAt - a.startedAt);
        setReports(sorted);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (selectedReport) {
    return <ReportDetail report={selectedReport} onBack={() => setSelectedReport(null)} />;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-4">
        <FileText className="w-4 h-4 text-[var(--color-accent)]" />
        Scan Reports
        {reports.length > 0 && (
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">
            {reports.length} session{reports.length !== 1 ? 's' : ''}
          </span>
        )}
      </h2>

      {reports.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto text-[var(--color-text-muted)] opacity-50 mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">No scan reports yet</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Run a job scan to see detailed logs here
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <ReportListItem
              key={report.id}
              report={report}
              onClick={() => setSelectedReport(report)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

