import { useState, useEffect } from 'react';
import { User, Bell, Palette, Clock } from 'lucide-react';
import { getSettings, setSettings, getProfile, setProfile } from '@shared/utils/storage';
import type { Settings as SettingsType, UserProfile } from '@shared/types';

export function Settings() {
  const [settings, setLocalSettings] = useState<SettingsType | null>(null);
  const [profile, setLocalProfile] = useState<UserProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

      {/* Saving indicator */}
      {isSaving && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-[var(--color-accent)] text-white text-xs font-medium">
          Saving...
        </div>
      )}
    </div>
  );
}

