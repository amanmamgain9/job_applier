import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { ChatMessage } from './types';

const INITIAL_MESSAGE: ChatMessage = {
  id: 'initial',
  role: 'assistant',
  content: "Great! I've got your CV. What kind of jobs are you looking for?",
  timestamp: new Date(),
};

interface Props {
  cvFileName: string;
  messages: ChatMessage[];
  onSendMessage: (content: string) => Promise<void>;
  onComplete: () => void;
  isLoading: boolean;
}

export function PreferencesChat({
  cvFileName,
  messages,
  onSendMessage,
  onComplete,
  isLoading,
}: Props) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const allMessages = [INITIAL_MESSAGE, ...messages];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const content = input.trim();
    setInput('');
    await onSendMessage(content);
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Job Preferences</h1>
        <p className="text-zinc-500 text-sm">
          Using: <span className="text-zinc-400">{cvFileName}</span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-1">
        {allMessages.map((m) => (
          <div
            key={m.id}
            className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}
          >
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                m.role === 'assistant' ? 'bg-emerald-500/20' : 'bg-zinc-700'
              )}
            >
              {m.role === 'assistant' ? (
                <Sparkles className="w-4 h-4 text-emerald-400" />
              ) : (
                <User className="w-4 h-4 text-zinc-300" />
              )}
            </div>
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-3',
                m.role === 'assistant'
                  ? 'bg-zinc-800/50 text-zinc-200'
                  : 'bg-emerald-600 text-white'
              )}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {m.content}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="bg-zinc-800/50 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:150ms]" />
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <div className="flex gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe your ideal job..."
            rows={1}
            className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 resize-none"
          />
          <Button onClick={handleSend} disabled={!input.trim() || isLoading}>
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {messages.length >= 2 && (
          <div className="mt-4 text-center">
            <Button variant="secondary" onClick={onComplete} size="lg">
              Ready to Start Searching →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
