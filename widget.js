(function () {
  const scriptTag = document.currentScript;
  const STORE_ID = scriptTag.getAttribute('data-store-id');
  const API_URL = scriptTag.getAttribute('data-api-url');

  if (!STORE_ID || !API_URL) {
    console.error('AI Chat Widget: missing data-store-id or data-api-url');
    return;
  }

  console.log('AI Chat Widget v3 loaded');

  const STORAGE_KEY = 'ai_chat_customer_' + STORE_ID;
  const POLL_OPEN_MS = 4000;
  const POLL_CLOSED_MS = 15000;

  let customerId = null;
  let assistantName = 'AI Customer Service';
  let isOpen = false;
  let sending = false;
  let pollTimer = null;
  const seen = {}; // chat log id -> { user: rendered?, ai: rendered? }

  const style = document.createElement('style');
  style.textContent = `
    #aicw-bubble { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%; background: #2563eb; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 999999; font-size: 24px; }
    #aicw-dot { position: absolute; top: 4px; right: 4px; width: 14px; height: 14px; background: #ef4444; border: 2px solid white; border-radius: 50%; display: none; }
    #aicw-panel { position: fixed; bottom: 88px; right: 20px; width: 340px; max-width: 90vw; height: 480px; max-height: 70vh; background: white; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.25); display: none; flex-direction: column; overflow: hidden; z-index: 999999; font-family: sans-serif; }
    #aicw-panel.open { display: flex; }
    #aicw-header { background: #2563eb; color: white; padding: 12px 16px; font-weight: 600; }
    #aicw-messages { flex: 1; overflow-y: auto; padding: 12px; background: #f5f5f5; }
    .aicw-msg { margin-bottom: 10px; max-width: 80%; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
    .aicw-msg.user { background: #2563eb; color: white; margin-left: auto; border-bottom-right-radius: 2px; }
    .aicw-msg.bot { background: white; color: #222; border: 1px solid #ddd; border-bottom-left-radius: 2px; }
    .aicw-msg.human { background: #ecfdf5; color: #222; border: 1px solid #a7f3d0; border-bottom-left-radius: 2px; }
    .aicw-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .aicw-option-btn { background: white; border: 1px solid #2563eb; color: #2563eb; border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; text-align: left; }
    .aicw-option-btn:hover { background: #eff6ff; }
    #aicw-input-row { display: flex; border-top: 1px solid #ddd; padding: 8px; gap: 8px; }
    #aicw-input { flex: 1; border: 1px solid #ccc; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    #aicw-send { background: #2563eb; color: white; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
    #aicw-identify { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    #aicw-identify input { border: 1px solid #ccc; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    #aicw-identify button { background: #2563eb; color: white; border: none; border-radius: 8px; padding: 10px; cursor: pointer; font-size: 14px; }
  `;
  document.head.appendChild(style);

  const bubble = document.createElement('div');
  bubble.id = 'aicw-bubble';
  bubble.innerHTML = '💬<span id="aicw-dot"></span>';
  document.body.appendChild(bubble);

  const panel = document.createElement('div');
  panel.id = 'aicw-panel';
  panel.innerHTML = `
    <div id="aicw-header">${assistantName}</div>
    <div id="aicw-identify">
      <div>What's your name and phone number so we can save your chat history?</div>
      <input type="text" id="aicw-name-input" placeholder="Your name" />
      <input type="tel" id="aicw-phone-input" placeholder="Your phone number" />
      <button id="aicw-identify-btn">Start chat</button>
    </div>
    <div id="aicw-messages" style="display:none;"></div>
    <div id="aicw-input-row" style="display:none;">
      <input type="text" id="aicw-input" placeholder="Type a message..." />
      <button id="aicw-send">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  const dot = bubble.querySelector('#aicw-dot');
  const headerEl = panel.querySelector('#aicw-header');
  const identifyEl = panel.querySelector('#aicw-identify');
  const messagesEl = panel.querySelector('#aicw-messages');
  const inputRowEl = panel.querySelector('#aicw-input-row');
  const inputEl = panel.querySelector('#aicw-input');
  const sendBtn = panel.querySelector('#aicw-send');
  const nameInput = panel.querySelector('#aicw-name-input');
  const phoneInput = panel.querySelector('#aicw-phone-input');
  const identifyBtn = panel.querySelector('#aicw-identify-btn');

  bubble.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) {
      dot.style.display = 'none';
      messagesEl.scrollTop = messagesEl.scrollHeight;
      pollOnce();
      schedulePoll();
    }
  });

  function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = 'aicw-msg ' + sender;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addOptions(options, promptText) {
    if (promptText) addMessage(promptText, 'bot');
    const wrap = document.createElement('div');
    wrap.className = 'aicw-options';
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'aicw-option-btn';
      btn.textContent = opt.title + (opt.short_desc ? ' — ' + opt.short_desc : '');
      btn.addEventListener('click', () => {
        wrap.remove();
        selectPromotion(opt.id, opt.title);
      });
      wrap.appendChild(btn);
    });
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function handleChatResponse(data) {
    if (data.log_id) {
      seen[data.log_id] = { user: true, ai: !data.needs_human };
    }
    if (data.type === 'options') {
      addOptions(data.options, data.text);
    } else {
      addMessage(data.reply, 'bot');
    }
  }

  async function postChat(payload) {
    const res = await fetch(API_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Bad response');
    return res.json();
  }

  async function selectPromotion(promoId, title) {
    if (sending) return;
    sending = true;
    addMessage(title, 'user');
    try {
      const data = await postChat({
        store_id: STORE_ID,
        customer_id: customerId,
        message: '',
        selected_promotion_id: promoId,
      });
      handleChatResponse(data);
    } catch (e) {
      addMessage('Sorry, something went wrong. Please try again.', 'bot');
    } finally {
      sending = false;
    }
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    sending = true;
    addMessage(text, 'user');
    inputEl.value = '';
    try {
      const data = await postChat({ store_id: STORE_ID, customer_id: customerId, message: text });
      handleChatResponse(data);
    } catch (e) {
      addMessage('Sorry, something went wrong. Please try again.', 'bot');
    } finally {
      sending = false;
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  identifyBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    if (!phone) { alert('Please enter your phone number'); return; }
    const res = await fetch(API_URL + '/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: STORE_ID, phone: phone, name: name }),
    });
    const data = await res.json();
    customerId = data.customer.id;
    localStorage.setItem(STORAGE_KEY, customerId);
    showChatUI();
    await loadHistory();
    schedulePoll();
  });

  function showChatUI() {
    identifyEl.style.display = 'none';
    messagesEl.style.display = 'block';
    inputRowEl.style.display = 'flex';
  }

  function cleanUserText(text) {
    const m = text.match(/^\[selected promotion: (.*)\]$/);
    return m ? m[1] : text;
  }

  function isOptionsLog(text) {
    return text.indexOf('[shown promotion options]:') === 0;
  }

  // Render any rows not shown yet; returns true if a new reply appeared
  function syncRows(rows) {
    let gotNewReply = false;
    rows.forEach((row) => {
      const s = seen[row.id] || (seen[row.id] = { user: false, ai: false });
      if (row.user_message && !s.user) {
        s.user = true;
        addMessage(cleanUserText(row.user_message), 'user');
      }
      if (row.ai_response && !s.ai) {
        s.ai = true;
        if (!isOptionsLog(row.ai_response)) {
          addMessage(row.ai_response, row.replied_by === 'human' ? 'human' : 'bot');
          gotNewReply = true;
        }
      }
    });
    return gotNewReply;
  }

  async function fetchHistory() {
    const res = await fetch(API_URL + '/chat/history?store_id=' + STORE_ID + '&customer_id=' + customerId);
    return res.json();
  }

  async function loadHistory() {
    try {
      const data = await fetchHistory();
      syncRows(data);
      if (data.length === 0) {
        addMessage('Hi! How can I help you today?', 'bot');
      }
    } catch (e) {}
  }

  async function pollOnce() {
    if (!customerId || sending) return;
    try {
      const data = await fetchHistory();
      if (sending) return; // drop data fetched while a message was being sent, to avoid duplicates
      const gotReply = syncRows(data);
      if (gotReply && !isOpen) dot.style.display = 'block';
    } catch (e) {}
  }

  function schedulePoll() {
    if (!customerId) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      await pollOnce();
      schedulePoll();
    }, isOpen ? POLL_OPEN_MS : POLL_CLOSED_MS);
  }

  // Check immediately when the customer comes back to this tab or window
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && customerId) {
      pollOnce();
      schedulePoll();
    }
  });
  window.addEventListener('focus', () => {
    if (customerId) pollOnce();
  });

  async function loadStoreInfo() {
    try {
      const res = await fetch(API_URL + '/store-info?store_id=' + STORE_ID);
      const data = await res.json();
      assistantName = data.ai_display_name || assistantName;
      headerEl.textContent = assistantName;
    } catch (e) {}
  }

  async function init() {
    await loadStoreInfo();
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      customerId = stored;
      showChatUI();
      await loadHistory();
      schedulePoll();
    }
  }

  init();
})();
