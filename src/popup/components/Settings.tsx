import { useState, useEffect } from 'react';
import { User, Bell, Palette, Clock, FlaskConical, Loader2 } from 'lucide-react';
import { getSettings, setSettings, getProfile, setProfile } from '@shared/utils/storage';
import { createMessage } from '@shared/types/messages';
import type { Settings as SettingsType, UserProfile } from '@shared/types';

interface PlannerResult {
  success: boolean;
  strategy?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  errors?: string[];
  error?: string;
  duration?: number;
}

export function Settings() {
  const [settings, setLocalSettings] = useState<SettingsType | null>(null);
  const [profile, setLocalProfile] = useState<UserProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Dev tools state
  const [isPlanning, setIsPlanning] = useState(false);
  const [plannerResult, setPlannerResult] = useState<PlannerResult | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [s, p] = await Promise.all([getSettings(), getProfile()]);
    setLocalSettings(s);
    setLocalProfile(p);
  };

  const handleSettingChange = async <K extends keyof SettingsType>(
    key: K,
    value: SettingsType[K]
  ) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setLocalSettings(updated);
    setIsSaving(true);
    await setSettings(updated);
    setIsSaving(false);
  };

  const handleProfileChange = async <K extends keyof UserProfile>(
    key: K,
    value: UserProfile[K]
  ) => {
    if (!profile) return;
    const updated = { ...profile, [key]: value };
    setLocalProfile(updated);
  };

  const saveProfile = async () => {
    if (!profile) return;
    setIsSaving(true);
    await setProfile(profile);
    setIsSaving(false);
  };

  // Dev tools: Test StrategyPlanner on current tab
  const handleTestPlanner = async () => {
    setIsPlanning(true);
    setPlannerResult(null);
    
    try {
      const response = await chrome.runtime.sendMessage(
        createMessage('TEST_STRATEGY_PLANNER', { task: 'Understand this page and explain how to extract all items from it.' })
      );
      setPlannerResult(response as PlannerResult);
    } catch (err) {
      setPlannerResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsPlanning(false);
    }
  };

  if (!settings || !profile) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {/* Profile Section */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-3">
          <User className="w-4 h-4 text-[var(--color-accent)]" />
          Profile
        </h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="First Name"
              value={profile.firstName}
              onChange={(e) => handleProfileChange('firstName', e.target.value)}
              onBlur={saveProfile}
              className="px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)] text-sm
                focus:border-[var(--color-accent)] focus:outline-none transition-colors"
            />
            <input
              type="text"
              placeholder="Last Name"
              value={profile.lastName}
              onChange={(e) => handleProfileChange('lastName', e.target.value)}
              onBlur={saveProfile}
              className="px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)] text-sm
                focus:border-[var(--color-accent)] focus:outline-none transition-colors"
            />
          </div>
          <input
            type="email"
            placeholder="Email"
            value={profile.email}
            onChange={(e) => handleProfileChange('email', e.target.value)}
            onBlur={saveProfile}
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]
              text-[var(--color-text)] placeholder-[var(--color-text-muted)] text-sm
              focus:border-[var(--color-accent)] focus:outline-none transition-colors"
          />
          <input
            type="tel"
            placeholder="Phone"
            value={profile.phone}
            onChange={(e) => handleProfileChange('phone', e.target.value)}
            onBlur={saveProfile}
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]
              text-[var(--color-text)] placeholder-[var(--color-text-muted)] text-sm
              focus:border-[var(--color-accent)] focus:outline-none transition-colors"
          />
        </div>
      </section>

      {/* Preferences Section */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-3">
          <Bell className="w-4 h-4 text-[var(--color-accent)]" />
          Preferences
        </h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] cursor-pointer">
            <span className="text-sm text-[var(--color-text)]">Auto-capture jobs</span>
            <input
              type="checkbox"
              checked={settings.autoCapture}
              onChange={(e) => handleSettingChange('autoCapture', e.target.checked)}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
          </label>
          <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] cursor-pointer">
            <span className="text-sm text-[var(--color-text)]">Show notifications</span>
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(e) => handleSettingChange('notifications', e.target.checked)}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
          </label>
        </div>
      </section>

      {/* Theme Section */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-3">
          <Palette className="w-4 h-4 text-[var(--color-accent)]" />
          Theme
        </h2>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((theme) => (
            <button
              key={theme}
              onClick={() => handleSettingChange('theme', theme)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors
                ${settings.theme === theme
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:border-[var(--color-accent)]'
                }`}
            >
              {theme}
            </button>
          ))}
        </div>
      </section>

      {/* Rate Limiting */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-3">
          <Clock className="w-4 h-4 text-[var(--color-accent)]" />
          Rate Limiting
        </h2>
        <div className="p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--color-text)]">Delay between captures</span>
            <span className="text-sm text-[var(--color-text-muted)]">{settings.captureDelay / 1000}s</span>
          </label>
          <input
            type="range"
            min="1000"
            max="5000"
            step="500"
            value={settings.captureDelay}
            onChange={(e) => handleSettingChange('captureDelay', Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </div>
      </section>

      {/* Dev Tools Section */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-3">
          <FlaskConical className="w-4 h-4 text-amber-500" />
          Dev Tools
          <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">DEV</span>
        </h2>
        
        <div className="space-y-3">
          {/* Test StrategyPlanner Button */}
          <button
            onClick={handleTestPlanner}
            disabled={isPlanning}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm
              bg-amber-500/10 border border-amber-500/30 text-amber-400
              hover:bg-amber-500/20 hover:border-amber-500/50
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all"
          >
            {isPlanning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Planning Strategy...
              </>
            ) : (
              <>
                <FlaskConical className="w-4 h-4" />
                Test StrategyPlanner on Current Tab
              </>
            )}
          </button>

          {/* Planner Result */}
          {plannerResult && (
            <div className={`p-3 rounded-lg border ${
              plannerResult.success 
                ? 'bg-emerald-500/10 border-emerald-500/30' 
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-semibold ${
                  plannerResult.success ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {plannerResult.success ? 'Strategy Planning Complete' : 'Strategy Planning Failed'}
                </span>
                {plannerResult.duration && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {(plannerResult.duration / 1000).toFixed(1)}s
                  </span>
                )}
              </div>

              {/* Tool Calls */}
              {plannerResult.toolCalls && plannerResult.toolCalls.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] text-[var(--color-text-muted)] uppercase mb-1">Tool Calls</p>
                  <div className="space-y-1">
                    {plannerResult.toolCalls.map((call, idx) => (
                      <div key={idx} className="text-xs font-mono bg-black/20 rounded p-1.5">
                        <span className="text-amber-400">{call.tool}</span>
                        <span className="text-[var(--color-text-muted)]">(</span>
                        <span className="text-emerald-400">{JSON.stringify(call.args)}</span>
                        <span className="text-[var(--color-text-muted)]">)</span>
                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">
                          → {call.result.slice(0, 100)}...
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Strategy */}
              {plannerResult.strategy && (
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)] uppercase mb-1">Strategy</p>
                  <div className="text-xs text-[var(--color-text)] bg-black/20 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {plannerResult.strategy}
                  </div>
                </div>
              )}

              {/* Error */}
              {plannerResult.error && (
                <p className="text-xs text-red-400">{plannerResult.error}</p>
              )}

              {/* Errors array */}
              {plannerResult.errors && plannerResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] text-red-400 uppercase mb-1">Warnings</p>
                  {plannerResult.errors.map((err, idx) => (
                    <p key={idx} className="text-xs text-red-300">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Saving indicator */}
      {isSaving && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-[var(--color-accent)] text-white text-xs font-medium">
          Saving...
        </div>
      )}
    </div>
  );
}



