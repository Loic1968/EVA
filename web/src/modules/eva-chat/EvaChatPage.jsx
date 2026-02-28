import { useEvaChat } from './useEvaChat';
import EvaMessageList from './EvaMessageList';
import EvaInputBox from './EvaInputBox';

export default function EvaChatPage() {
  const {
    messages,
    input,
    setInput,
    loading,
    error,
    sendMessage,
    stop,
    clearError,
  } = useEvaChat();

  return (
    <div className="flex flex-col min-h-[calc(100vh-10rem)] max-w-3xl mx-auto">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700/40">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">EVA Chat</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pure conversation mode. Type and chat naturally.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">
            <p>Say hello. Try: &quot;Hello EVA&quot; or &quot;What did I ask you?&quot;</p>
          </div>
        ) : (
          <EvaMessageList messages={messages} />
        )}

        {error && (
          <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/20 flex items-center justify-between gap-2">
            <span className="text-sm text-amber-800 dark:text-amber-200">{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <EvaInputBox
          input={input}
          setInput={setInput}
          loading={loading}
          onSend={sendMessage}
          onStop={stop}
        />
      </div>
    </div>
  );
}
