import { useState, useRef, useCallback } from 'react';
import { api } from '../../api';

export function useEvaChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);
    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const chatMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = '';
    setMessages((prev) => [...prev, { role: 'assistant', content: '', isStreaming: true }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await api.evaChat(chatMessages, { signal: controller.signal });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.delta) {
                assistantContent += payload.delta;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'assistant') {
                    next[next.length - 1] = { ...last, content: assistantContent, isStreaming: true };
                  }
                  return next;
                });
              }
              if (payload.error) throw new Error(payload.error);
            } catch (e) {
              if (e.name === 'AbortError') throw e;
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          next[next.length - 1] = { ...last, content: assistantContent, isStreaming: false };
        }
        return next;
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Something went wrong');
      setMessages((prev) =>
        prev.filter((m) => !(m.role === 'assistant' && m.isStreaming))
      );
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: null, error: err.message, isStreaming: false },
      ]);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [messages, input, loading]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    input,
    setInput,
    loading,
    error,
    sendMessage,
    stop,
    clearError,
  };
}
