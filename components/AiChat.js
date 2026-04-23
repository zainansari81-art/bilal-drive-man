import { useState, useRef, useEffect } from 'react';

/**
 * Floating AI chat widget — appears as a pill button in the bottom-right of
 * every portal page. Click to open a panel, type a question, and Claude Opus
 * replies. The chat proxies through /api/ai-chat so the API key stays
 * server-side.
 *
 * Props:
 *   context — optional object passed to the backend for live portal context:
 *     { drives, activities }. Used so the AI can cite specific couples/folders
 *     when suggesting cleanup.
 */
export default function AiChat({ context }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        "Hi! I\u2019m the Drive-Man assistant. I can walk you through the portal or scan your drives for data older than a month that you might want to delete. What do you need?",
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to the bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Autofocus the input when the panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: 'user', content: text }];
    // Append an empty assistant bubble that we'll stream into.
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          context: context || null,
        }),
      });

      // Error path — backend returned JSON, not a stream.
      if (!res.ok) {
        let errMsg = 'AI request failed';
        try {
          const data = await res.json();
          errMsg = data.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      // Stream path — parse SSE text_delta events and append to the last bubble.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines.
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          // Each event is one or more "data: ..." lines.
          for (const line of evt.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              if (
                parsed.type === 'content_block_delta' &&
                parsed.delta?.type === 'text_delta' &&
                parsed.delta.text
              ) {
                const chunk = parsed.delta.text;
                setMessages((cur) => {
                  const copy = [...cur];
                  const last = copy[copy.length - 1];
                  if (last && last.role === 'assistant') {
                    copy[copy.length - 1] = {
                      ...last,
                      content: (last.content || '') + chunk,
                    };
                  }
                  return copy;
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error?.message || 'stream error');
              }
            } catch (parseErr) {
              // Non-JSON data lines — ignore silently (pings, etc.)
            }
          }
        }
      }
    } catch (err) {
      setError(err.message);
      setMessages((cur) => {
        const copy = [...cur];
        const last = copy[copy.length - 1];
        const fallback = 'Sorry \u2014 I hit an error reaching the AI. Please try again in a moment.';
        if (last && last.role === 'assistant' && !last.content) {
          copy[copy.length - 1] = { ...last, content: fallback };
        } else {
          copy.push({ role: 'assistant', content: fallback });
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const suggest = (text) => {
    setInput(text);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  return (
    <>
      <style>{chatCss}</style>

      {!open && (
        <button
          className="ai-chat-fab"
          onClick={() => setOpen(true)}
          title="Open AI assistant"
          aria-label="Open AI assistant"
        >
          <span className="ai-chat-fab-icon">{'\u{1F4AC}'}</span>
          <span className="ai-chat-fab-label">Ask AI</span>
        </button>
      )}

      {open && (
        <div className="ai-chat-panel" role="dialog" aria-label="AI assistant">
          <div className="ai-chat-header">
            <div className="ai-chat-title">
              <span className="ai-chat-avatar">{'\u2728'}</span>
              <div>
                <div className="ai-chat-name">Drive-Man Assistant</div>
                <div className="ai-chat-sub">Powered by Claude Sonnet</div>
              </div>
            </div>
            <button
              className="ai-chat-close"
              onClick={() => setOpen(false)}
              title="Close"
              aria-label="Close"
            >
              {'\u00D7'}
            </button>
          </div>

          <div className="ai-chat-messages" ref={scrollRef}>
            {messages.map((m, i) => {
              // Skip the trailing empty assistant bubble — the typing
              // indicator below stands in for it until first token arrives.
              const isLast = i === messages.length - 1;
              if (isLast && m.role === 'assistant' && !m.content && sending) {
                return null;
              }
              return (
                <div key={i} className={`ai-chat-msg ai-chat-msg-${m.role}`}>
                  <div className="ai-chat-bubble">
                    {m.content.split('\n').map((line, j) => (
                      <span key={j}>
                        {line}
                        {j < m.content.split('\n').length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {sending &&
              messages[messages.length - 1]?.role === 'assistant' &&
              !messages[messages.length - 1]?.content && (
                <div className="ai-chat-msg ai-chat-msg-assistant ai-chat-msg-pending">
                  <div className="ai-chat-bubble ai-chat-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
          </div>

          {messages.length <= 1 && !sending && (
            <div className="ai-chat-suggestions">
              <button
                className="ai-chat-suggestion"
                onClick={() =>
                  suggest('What data on my drives is older than a month and worth deleting?')
                }
              >
                What can I delete?
              </button>
              <button
                className="ai-chat-suggestion"
                onClick={() => suggest('How do I download a project from Notion?')}
              >
                How do I download a project?
              </button>
              <button
                className="ai-chat-suggestion"
                onClick={() => suggest('Walk me through the Drives page.')}
              >
                Tour the Drives page
              </button>
            </div>
          )}

          {error && <div className="ai-chat-error">{error}</div>}

          <div className="ai-chat-input-row">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the portal or drive cleanup..."
              rows={1}
              disabled={sending}
              className="ai-chat-input"
            />
            <button
              className="ai-chat-send"
              onClick={send}
              disabled={!input.trim() || sending}
              title="Send"
              aria-label="Send"
            >
              {'\u2191'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const chatCss = `
  .ai-chat-fab {
    position: fixed; right: 22px; bottom: 22px; z-index: 9000;
    display: flex; align-items: center; gap: 8px;
    padding: 12px 18px;
    border-radius: 999px;
    border: 1px solid #4a3070;
    background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
    color: #fff; font-size: 14px; font-weight: 600;
    cursor: pointer;
    box-shadow: 0 10px 28px rgba(124, 58, 237, 0.45);
    font-family: inherit;
    transition: transform 0.15s ease, box-shadow 0.2s ease;
  }
  .ai-chat-fab:hover { transform: translateY(-1px); box-shadow: 0 14px 32px rgba(124, 58, 237, 0.55); }
  .ai-chat-fab-icon { font-size: 17px; line-height: 1; }

  .ai-chat-panel {
    position: fixed; right: 22px; bottom: 22px; z-index: 9000;
    width: 380px; max-width: calc(100vw - 44px);
    height: 560px; max-height: calc(100vh - 80px);
    background: #0f0a1e;
    border: 1px solid #2a1a48;
    border-radius: 16px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    display: flex; flex-direction: column;
    font-family: inherit;
    overflow: hidden;
    animation: ai-chat-in 0.18s ease-out;
  }
  @keyframes ai-chat-in {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to   { opacity: 1; transform: none; }
  }

  .ai-chat-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px;
    background: linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(168,85,247,0.08) 100%);
    border-bottom: 1px solid #2a1a48;
  }
  .ai-chat-title { display: flex; align-items: center; gap: 10px; color: #fff; }
  .ai-chat-avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: linear-gradient(135deg, #7c3aed, #a855f7);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }
  .ai-chat-name { font-size: 14px; font-weight: 700; }
  .ai-chat-sub { font-size: 11px; opacity: 0.7; }
  .ai-chat-close {
    background: transparent; border: none; color: #fff;
    font-size: 22px; line-height: 1; cursor: pointer; opacity: 0.65;
    padding: 4px 8px; border-radius: 6px;
  }
  .ai-chat-close:hover { opacity: 1; background: rgba(255,255,255,0.06); }

  .ai-chat-messages {
    flex: 1; overflow-y: auto; padding: 14px 14px 8px;
    display: flex; flex-direction: column; gap: 10px;
    background: #0b0818;
  }
  .ai-chat-msg { display: flex; }
  .ai-chat-msg-user { justify-content: flex-end; }
  .ai-chat-msg-assistant { justify-content: flex-start; }
  .ai-chat-bubble {
    max-width: 78%;
    padding: 10px 13px; border-radius: 14px;
    font-size: 13.5px; line-height: 1.45;
    color: #f2eefb;
    word-wrap: break-word;
  }
  .ai-chat-msg-user .ai-chat-bubble {
    background: linear-gradient(135deg, #7c3aed, #a855f7);
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .ai-chat-msg-assistant .ai-chat-bubble {
    background: #1a0f2e;
    border: 1px solid #2a1a48;
    border-bottom-left-radius: 4px;
  }
  .ai-chat-typing { display: flex; gap: 4px; padding: 12px 14px; }
  .ai-chat-typing span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #a855f7;
    animation: ai-chat-dot 1.2s ease-in-out infinite;
  }
  .ai-chat-typing span:nth-child(2) { animation-delay: 0.15s; }
  .ai-chat-typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes ai-chat-dot {
    0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-3px); }
  }

  .ai-chat-suggestions {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 0 14px 10px;
  }
  .ai-chat-suggestion {
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid #4a3070;
    background: rgba(124, 58, 237, 0.12);
    color: #e9d9ff; font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .ai-chat-suggestion:hover { background: rgba(124, 58, 237, 0.22); }

  .ai-chat-error {
    margin: 0 14px 8px;
    padding: 8px 10px;
    background: rgba(220, 38, 38, 0.12);
    border: 1px solid #7f1d1d;
    color: #fca5a5;
    border-radius: 8px;
    font-size: 12px;
  }

  .ai-chat-input-row {
    display: flex; align-items: flex-end; gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid #2a1a48;
    background: #0f0a1e;
  }
  .ai-chat-input {
    flex: 1;
    resize: none;
    max-height: 120px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #2a1a48;
    background: #1a0f2e;
    color: #fff;
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.4;
    outline: none;
  }
  .ai-chat-input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,0.2); }
  .ai-chat-send {
    width: 38px; height: 38px; border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #7c3aed, #a855f7);
    color: #fff; font-size: 16px; font-weight: 700;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .ai-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 640px) {
    .ai-chat-panel {
      right: 12px; bottom: 12px; left: 12px;
      width: auto; height: 70vh;
    }
    .ai-chat-fab { right: 14px; bottom: 14px; }
  }
`;
