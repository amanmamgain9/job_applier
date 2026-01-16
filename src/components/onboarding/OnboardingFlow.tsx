import { useOnboarding } from './hooks/useOnboarding';
import { CVUpload } from './CVUpload';
import { PreferencesChat } from './PreferencesChat';

export function OnboardingFlow() {
  const {
    step,
    cv,
    preferences,
    isLoading,
    error,
    uploadCV,
    confirmCV,
    sendMessage,
    completeOnboarding,
  } = useOnboarding();

  if (isLoading && !cv) {
    return (
      <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center p-8">
      {step === 'cv' && (
        <CVUpload
          onUpload={uploadCV}
          onConfirm={confirmCV}
          parsedCV={cv?.parsed}
          isLoading={isLoading}
          error={error}
        />
      )}
      {step === 'preferences' && cv && (
        <PreferencesChat
          cvFileName={cv.fileName}
          messages={preferences.rawChat}
          onSendMessage={sendMessage}
          onComplete={completeOnboarding}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

export { useOnboarding };
