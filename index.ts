import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import Anthropic from '@anthropic-ai/sdk';
import db from './db';

const app = new Hono();

const ai = process.env.SANTAI_AI_BASE_URL
  ? new Anthropic({
      baseURL: process.env.SANTAI_AI_BASE_URL,
      apiKey: process.env.SANTAI_AI_TOKEN || 'placeholder',
    })
  : null;

// Serve static files
app.use('/public/*', serveStatic({ root: import.meta.dir }));

// --- API Routes ---

// Get chat history for a session
app.get('/api/history/:sessionId', (c) => {
  const { sessionId } = c.req.param();
  const rows = db
    .query('SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as { role: string; content: string; created_at: number }[];
  return c.json(rows);
});

// Send a message and get AI reply
app.post('/api/chat', async (c) => {
  const { sessionId, message } = await c.req.json<{ sessionId: string; message: string }>();

  if (!sessionId || !message?.trim()) {
    return c.json({ error: 'sessionId and message are required' }, 400);
  }

  // Save user message
  db.query('INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, 'user', message);

  if (!ai) {
    const fallback = "I'm not able to reach the AI right now — try deploying the app or check your environment.";
    db.query('INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, 'assistant', fallback);
    return c.json({ reply: fallback });
  }

  // Build message history for context (last 30 turns)
  const history = db
    .query('SELECT role, content FROM conversations WHERE session_id = ? ORDER BY created_at ASC LIMIT 30')
    .all(sessionId) as { role: string; content: string }[];

  try {
    const response = await ai.messages.create({
      model: 'anthropic-claude-bedrock4.5-haiku',
      max_tokens: 1024,
      system: "You are a helpful, friendly, and concise AI assistant. Respond clearly and naturally.",
      messages: history.map(({ role, content }) => ({
        role: role as 'user' | 'assistant',
        content,
      })),
    });

    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    db.query('INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, 'assistant', reply);
    return c.json({ reply });
  } catch (err) {
    console.error('AI error:', err);
    return c.json({ error: 'AI request failed' }, 500);
  }
});

// Clear conversation history
app.delete('/api/history/:sessionId', (c) => {
  const { sessionId } = c.req.param();
  db.query('DELETE FROM conversations WHERE session_id = ?').run(sessionId);
  return c.json({ ok: true });
});

// Serve the UI for all other routes
app.get('*', (c) => {
  return c.html(html);
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Chatbot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f0f13;
      --surface: #18181f;
      --surface2: #22222c;
      --border: #2e2e3a;
      --accent: #7c6af7;
      --accent-dim: #5b52c4;
      --text: #e8e8f0;
      --text-muted: #8888a0;
      --user-bg: #7c6af7;
      --user-text: #ffffff;
      --bot-bg: #22222c;
      --bot-text: #e8e8f0;
      --radius: 18px;
      --input-h: 56px;
    }

    html, body {
      height: 100%;
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
    }

    #app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      max-width: 780px;
      margin: 0 auto;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      backdrop-filter: blur(12px);
      z-index: 10;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7c6af7, #a78bfa);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }

    .status {
      font-size: 12px;
      color: #4ade80;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .status::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #4ade80;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    #clear-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 13px;
      padding: 6px 14px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }

    #clear-btn:hover {
      background: var(--surface2);
      color: var(--text);
      border-color: var(--accent);
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      scroll-behavior: smooth;
    }

    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .message-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      animation: fadeUp 0.2s ease;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-row.user { flex-direction: row-reverse; }

    .msg-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    .msg-avatar.bot { background: linear-gradient(135deg, #7c6af7, #a78bfa); }
    .msg-avatar.user { background: var(--surface2); border: 1px solid var(--border); }

    .bubble {
      max-width: 70%;
      padding: 12px 16px;
      border-radius: var(--radius);
      font-size: 14.5px;
      line-height: 1.6;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .user .bubble {
      background: var(--user-bg);
      color: var(--user-text);
      border-bottom-right-radius: 4px;
    }

    .bot .bubble {
      background: var(--bot-bg);
      color: var(--bot-text);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--border);
    }

    .typing-bubble .bubble {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 14px 18px;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: bounce 1.2s infinite;
    }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-muted);
      text-align: center;
    }

    .empty-state .icon { font-size: 48px; margin-bottom: 8px; }
    .empty-state h2 { font-size: 20px; font-weight: 600; color: var(--text); }
    .empty-state p { font-size: 14px; max-width: 300px; }

    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      margin-top: 16px;
    }

    .suggestion {
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      padding: 8px 14px;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .suggestion:hover {
      border-color: var(--accent);
      background: var(--surface);
    }

    footer {
      padding: 16px 20px 20px;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }

    #input-form {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 8px 8px 8px 16px;
      transition: border-color 0.15s;
    }

    #input-form:focus-within {
      border-color: var(--accent);
    }

    #user-input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--text);
      font-family: inherit;
      font-size: 14.5px;
      line-height: 1.5;
      resize: none;
      max-height: 160px;
      min-height: 40px;
      padding: 8px 0;
    }

    #user-input::placeholder { color: var(--text-muted); }

    #send-btn {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--accent);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;
    }

    #send-btn:hover:not(:disabled) { background: var(--accent-dim); transform: scale(1.05); }
    #send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    #send-btn svg { color: white; }

    @media (max-width: 600px) {
      #messages { padding: 16px 12px; }
      footer { padding: 12px 12px 16px; }
      header { padding: 12px 14px; }
      .bubble { max-width: 85%; }
    }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <div class="header-left">
        <div class="avatar">✦</div>
        <div>
          <h1>AI Assistant</h1>
          <div class="status">Online</div>
        </div>
      </div>
      <button id="clear-btn">Clear chat</button>
    </header>

    <div id="messages">
      <div class="empty-state" id="empty">
        <div class="icon">💬</div>
        <h2>How can I help?</h2>
        <p>Ask me anything — I'm here to help.</p>
        <div class="suggestions">
          <button class="suggestion">Explain quantum computing</button>
          <button class="suggestion">Write a haiku about code</button>
          <button class="suggestion">What's the Fibonacci sequence?</button>
          <button class="suggestion">Give me a productivity tip</button>
        </div>
      </div>
    </div>

    <footer>
      <form id="input-form">
        <textarea
          id="user-input"
          placeholder="Message AI Assistant..."
          rows="1"
          autocomplete="off"
        ></textarea>
        <button type="submit" id="send-btn" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </form>
    </footer>
  </div>

  <script>
    const SESSION_ID = 'session_' + Math.random().toString(36).slice(2);
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('user-input');
    const formEl = document.getElementById('input-form');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const emptyEl = document.getElementById('empty');
    let isLoading = false;

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
      sendBtn.disabled = !inputEl.value.trim() || isLoading;
    });

    // Send on Enter (Shift+Enter = newline)
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) formEl.requestSubmit();
      }
    });

    // Suggestion clicks
    document.querySelectorAll('.suggestion').forEach((btn) => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.textContent;
        inputEl.dispatchEvent(new Event('input'));
        formEl.requestSubmit();
      });
    });

    // Clear chat
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Clear the conversation?')) return;
      await fetch(\`/api/history/\${SESSION_ID}\`, { method: 'DELETE' });
      messagesEl.innerHTML = '';
      messagesEl.appendChild(emptyEl);
      emptyEl.style.display = '';
    });

    // Submit
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text || isLoading) return;

      appendMessage('user', text);
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sendBtn.disabled = true;
      setLoading(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: SESSION_ID, message: text }),
        });
        const data = await res.json();
        removeTyping();
        if (data.reply) {
          appendMessage('bot', data.reply);
        } else {
          appendMessage('bot', 'Something went wrong. Please try again.');
        }
      } catch {
        removeTyping();
        appendMessage('bot', 'Network error. Please check your connection.');
      } finally {
        setLoading(false);
      }
    });

    function setLoading(on) {
      isLoading = on;
      sendBtn.disabled = on || !inputEl.value.trim();
      if (on) appendTyping();
    }

    function hideEmpty() {
      emptyEl.style.display = 'none';
    }

    function appendMessage(role, text) {
      hideEmpty();
      const row = document.createElement('div');
      row.className = 'message-row ' + role;

      const av = document.createElement('div');
      av.className = 'msg-avatar ' + role;
      av.textContent = role === 'user' ? '👤' : '✦';

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;

      row.appendChild(av);
      row.appendChild(bubble);
      messagesEl.appendChild(row);
      scrollBottom();
    }

    function appendTyping() {
      const row = document.createElement('div');
      row.className = 'message-row bot typing-bubble';
      row.id = 'typing';
      row.innerHTML = \`
        <div class="msg-avatar bot">✦</div>
        <div class="bubble">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>\`;
      messagesEl.appendChild(row);
      scrollBottom();
    }

    function removeTyping() {
      document.getElementById('typing')?.remove();
    }

    function scrollBottom() {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    }

    // Load existing history
    (async () => {
      try {
        const res = await fetch(\`/api/history/\${SESSION_ID}\`);
        const rows = await res.json();
        rows.forEach(({ role, content }) => appendMessage(role === 'user' ? 'user' : 'bot', content));
      } catch {}
    })();

    inputEl.focus();
  </script>
</body>
</html>`;

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
