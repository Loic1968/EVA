import { useRef } from 'react';

export default function EvaInputBox({ input, setInput, loading, onSend, onStop }) {
  const textareaRef = useRef(null);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleSubmit = () => {
    onSend();
  };

  return (
    <div className="flex gap-2 items-end p-4 border-t border-slate-200 dark:border-slate-700/40 bg-white dark:bg-eva-panel">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message EVA..."
        disabled={loading}
        rows={1}
        className="flex-1 min-h-[44px] max-h-32 px-4 py-3 rounded-xl resize-none
          bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-600
          text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400
          focus:ring-2 focus:ring-[var(--eva-accent)] focus:border-transparent
          disabled:opacity-60 disabled:cursor-not-allowed"
      />
      {loading ? (
        <button
          type="button"
          onClick={onStop}
          className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-medium shrink-0"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="px-4 py-3 rounded-xl font-medium shrink-0
            bg-[var(--eva-accent)] text-white hover:opacity-90
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      )}
    </div>
  );
}
