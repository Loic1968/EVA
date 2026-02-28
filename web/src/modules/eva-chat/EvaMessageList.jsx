import { useRef, useEffect } from 'react';

function MessageBubble({ role, content, isStreaming, error }) {
  const isUser = role === 'user';
  return (
    <div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
      data-role={role}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0 ${
          isUser
            ? 'bg-[var(--eva-accent)] text-white'
            : 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200'
        }`}
      >
        {isUser ? 'U' : 'E'}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-[var(--eva-accent-bg)] text-eva-accent dark:bg-[var(--eva-accent-bg)]'
            : 'bg-slate-100 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
        }`}
      >
        {error ? (
          <span className="text-amber-600 dark:text-amber-400">{error}</span>
        ) : content ? (
          <span className="eva-message whitespace-pre-wrap">
            {content}
            {isStreaming && <span className="animate-pulse">▌</span>}
          </span>
        ) : isStreaming ? (
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-eva-accent animate-pulse" />
            <span className="w-2 h-2 rounded-full bg-eva-accent animate-pulse [animation-delay:0.2s]" />
            <span className="w-2 h-2 rounded-full bg-eva-accent animate-pulse [animation-delay:0.4s]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function EvaMessageList({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto space-y-4 py-4">
      {messages.map((m, i) => (
        <MessageBubble
          key={i}
          role={m.role}
          content={m.content}
          isStreaming={m.isStreaming}
          error={m.error}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
