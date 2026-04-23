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
          <span className="ai-chat-fab-icon">{'\u2728'}</span>
          <span className="ai-chat-fab-label">Ask AI</span>
        </button>
      )}

      {open && (
        <>
          <div
            className="ai-chat-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
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
        </>
      )}
    </>
  );
}

const chatCss = `
  /* Floating "Ask AI" pill in the bottom-right. Matches the portal's
     lime accent so it reads as part of the product, not a bolt-on. */
  .ai-chat-fab {
    position: fixed; right: 22px; bottom: 22px; z-index: 9000;
    display: flex; align-items: center; gap: 8px;
    padding: 11px 16px 11px 14px;
    border-radius: 999px;
    border: 1px solid rgba(26, 26, 46, 0.08);
    background: #ffffff;
    color: #1a1a2e; font-size: 13px; font-weight: 700;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(26, 26, 46, 0.12), 0 2px 6px rgba(26, 26, 46, 0.06);
    font-family: inherit;
    transition: transform 0.15s ease, box-shadow 0.2s ease;
  }
  .ai-chat-fab:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 28px rgba(26, 26, 46, 0.16), 0 3px 8px rgba(26, 26, 46, 0.08);
  }
  .ai-chat-fab-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 50%;
    background: #c8e600; color: #1a1a2e;
    font-size: 13px; line-height: 1;
  }

  /* Backdrop behind the drawer — subtle, lets the page show through. */
  .ai-chat-backdrop {
    position: fixed; inset: 0; z-index: 8998;
    background: rgba(26, 26, 46, 0.08);
    backdrop-filter: blur(2px);
    animation: ai-chat-fade 0.15s ease-out;
  }
  @keyframes ai-chat-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* Full-height right-side drawer. Matches the sidebar's white /
     off-white gradient so the two edges of the app feel like siblings. */
  .ai-chat-panel {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 9000;
    width: 420px; max-width: 100vw;
    background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
    border-left: 1px solid #e8eaed;
    box-shadow: -12px 0 40px rgba(26, 26, 46, 0.08);
    display: flex; flex-direction: column;
    font-family: inherit;
    overflow: hidden;
    animation: ai-chat-slide 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes ai-chat-slide {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  /* Header — matches the portal card header style */
  .ai-chat-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid #e8eaed;
    background: #ffffff;
  }
  .ai-chat-title { display: flex; align-items: center; gap: 12px; }
  .ai-chat-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: #c8e600;
    display: flex; align-items: center; justify-content: center;
    font-size: 17px;
  }
  .ai-chat-name { font-size: 14px; font-weight: 800; color: #1a1a2e; letter-spacing: -0.01em; }
  .ai-chat-sub {
    font-size: 10px; font-weight: 600; color: #8c8ca1;
    letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px;
  }
  .ai-chat-close {
    background: transparent; border: 1px solid transparent;
    color: #8c8ca1;
    width: 32px; height: 32px; border-radius: 8px;
    font-size: 18px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .ai-chat-close:hover { background: #f0f2f5; color: #1a1a2e; }

  .ai-chat-messages {
    flex: 1; overflow-y: auto; padding: 20px 18px 12px;
    display: flex; flex-direction: column; gap: 12px;
    background: #fafbfc;
    scrollbar-width: thin;
    scrollbar-color: #d1d5db transparent;
  }
  .ai-chat-messages::-webkit-scrollbar { width: 6px; }
  .ai-chat-messages::-webkit-scrollbar-thumb {
    background: #d1d5db; border-radius: 3px;
  }
  .ai-chat-msg { display: flex; }
  .ai-chat-msg-user { justify-content: flex-end; }
  .ai-chat-msg-assistant { justify-content: flex-start; }
  .ai-chat-bubble {
    max-width: 82%;
    padding: 11px 14px; border-radius: 14px;
    font-size: 13.5px; line-height: 1.5;
    word-wrap: break-word;
  }
  .ai-chat-msg-user .ai-chat-bubble {
    background: #c8e600;
    color: #1a1a2e;
    font-weight: 500;
    border-bottom-right-radius: 4px;
  }
  .ai-chat-msg-assistant .ai-chat-bubble {
    background: #ffffff;
    color: #1a1a2e;
    border: 1px solid #e8eaed;
    border-bottom-left-radius: 4px;
  }
  .ai-chat-typing { display: flex; gap: 5px; padding: 14px 16px; }
  .ai-chat-typing span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #8c8ca1;
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
    padding: 4px 18px 14px;
  }
  .ai-chat-suggestion {
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid #e5e7eb;
    background: #ffffff;
    color: #4a4a6a; font-size: 12px; font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }
  .ai-chat-suggestion:hover {
    background: #c8e600;
    border-color: #c8e600;
    color: #1a1a2e;
  }

  .ai-chat-error {
    margin: 0 18px 10px;
    padding: 10px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    border-radius: 10px;
    font-size: 12px;
  }

  .ai-chat-input-row {
    display: flex; align-items: flex-end; gap: 8px;
    padding: 14px 16px 18px;
    border-top: 1px solid #e8eaed;
    background: #ffffff;
  }
  .ai-chat-input {
    flex: 1;
    resize: none;
    max-height: 120px;
    padding: 11px 14px;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
    background: #fafbfc;
    color: #1a1a2e;
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.4;
    outline: none;
    transition: all 0.15s;
  }
  .ai-chat-input::placeholder { color: #9ca3af; }
  .ai-chat-input:focus {
    border-color: #c8e600;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(200, 230, 0, 0.2);
  }
  .ai-chat-send {
    width: 40px; height: 40px; border-radius: 12px;
    border: none;
    background: #c8e600;
    color: #1a1a2e; font-size: 16px; font-weight: 700;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .ai-chat-send:hover:not(:disabled) {
    background: #b8d400;
    transform: translateY(-1px);
  }
  .ai-chat-send:disabled {
    background: #e5e7eb; color: #9ca3af;
    cursor: not-allowed;
  }

  /* Tablet / smaller laptop — narrower drawer */
  @media (max-width: 900px) {
    .ai-chat-panel { width: 380px; }
  }
  /* Mobile — fill width */
  @media (max-width: 640px) {
    .ai-chat-panel { width: 100vw; border-left: none; }
    .ai-chat-fab { right: 14px; bottom: 14px; }
  }
`;
