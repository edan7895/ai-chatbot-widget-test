(function () {
  const scriptTag = document.currentScript;
  const STORE_ID = scriptTag.getAttribute('data-store-id');
  const API_URL = scriptTag.getAttribute('data-api-url');

  if (!STORE_ID || !API_URL) {
    console.error('AI Chat Widget: missing data-store-id or data-api-url');
    return;
  }

  const STORAGE_KEY = 'ai_chat_customer_' + STORE_ID;
  let customerId = null;
  let assistantName = 'AI Customer Service';

  const style = document.createElement('style');
  style.textContent = `
    #aicw-bubble { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%; background: #2563eb; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 999999; font-size: 24px; }
    #aicw-panel { position: fixed; bottom: 88px; right: 20px; width: 340px; max-width: 90vw; height: 480px; max-height: 70vh; background: white; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.25); display: none; flex-direction: column; overflow: hidden; z-index: 999999; font-family: sans-serif; }
    #aicw-panel.open { display: flex; }
    #aicw-header { background: #2563eb; color: white; padding: 12px 16px; font-weight: 600; }
    #aicw-messages { flex: 1; overflow-y: auto; padding: 12px; background: #f5f5f5; }
    .aicw-msg { margin-bottom: 10px; max-width: 80%; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.4; }
    .aicw-msg.user { background: #2563eb; color: white; margin-left: auto; border-bottom-right-radius: 2px; }
    .aicw-msg.bot { background: white; color: #222; border: 1px solid #ddd; border-bottom-left-radius: 2px; }
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
  bubble.textContent = '💬';
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
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) init();
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
      btn.addEventListener('click', () => selectPromotion(opt.id));
      wrap.appendChild(btn);
    });
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function selectPromotion(promoId) {
    const res = await fetch(API_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: STORE_ID, customer_id: customerId, message: '', selected_promotion_id: promoId }),
    });
    const data = await res.json();
    addMessage(data.reply, 'bot');
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    inputEl.value = '';
    const res = await fetch(API_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: STORE_ID, customer_id: customerId, message: text }),
    });
    const data = await res.json();
    if (data.type === 'options') {
      addOptions(data.options, data.text);
    } else {
      addMessage(data.reply, 'bot');
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
    loadHistory();
  });

  function showChatUI() {
    identifyEl.style.display = 'none';
    messagesEl.style.display = 'block';
    inputRowEl.style.display = 'flex';
  }

  async function loadHistory() {
    const res = await fetch(API_URL + '/chat/history?store_id=' + STORE_ID + '&customer_id=' + customerId);
    const data = await res.json();
    data.forEach((row) => {
      if (row.user_message) addMessage(row.user_message, 'user');
      if (row.ai_response) addMessage(row.ai_response, 'bot');
    });
    if (data.length === 0) {
      addMessage('Hi! How can I help you today?', 'bot');
    }
  }

  async function loadStoreInfo() {
    try {
      const res = await fetch(API_URL + '/store-info?store_id=' + STORE_ID);
      const data = await res.json();
      assistantName = data.ai_display_name || assistantName;
      headerEl.textContent = assistantName;
    } catch (e) {}
  }

  let initialized = false;
  async function init() {
    if (initialized) return;
    initialized = true;
    await loadStoreInfo();
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      customerId = stored;
      showChatUI();
      loadHistory();
    }
  }
})();
