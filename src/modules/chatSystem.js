/**
 * OmniTRAF Surabaya - Staff Coordination Chat System
 * Menangani percakapan contoh di dalam simulator; tidak menghubungkan petugas,
 * operator ATCS, atau dispatcher layanan darurat.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[tag] || tag));
}

export class ChatSystem {
  constructor() {
    this.messages = [
      {
        sender: "Admin Demo",
        role: "admin",
        text: "Contoh percakapan: node kamera dan koridor pada layar ini adalah data simulasi.",
        time: "07:45"
      },
      {
        sender: "Petugas Demo 01",
        role: "field",
        text: "Contoh laporan: antrean pada skenario koridor demo bertambah.",
        time: "07:52"
      },
      {
        sender: "Dispatcher Demo",
        role: "dispatcher",
        text: "Tidak ada ambulans yang dikirim. Pesan ini hanya contoh alur koordinasi.",
        time: "08:02"
      }
    ];

    this.chatBody = null;
    this.chatInput = null;
    this.typingWrapper = null;
    this._isInitialized = false;
    this.soundEnabled = true;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this.chatBody = document.getElementById("staffChatBody");
    this.chatInput = document.getElementById("chatInputText");
    this.typingWrapper = document.getElementById("chatTypingWrapper");
    try { this.soundEnabled = window.localStorage.getItem('omnitraf.chatSound') !== 'false'; } catch (_) {}

    this._renderInitialMessages();
    this._bindEvents();
    this._syncSoundToggle();
  }

  _renderInitialMessages() {
    if (!this.chatBody) return;
    this.chatBody.innerHTML = "";
    this.messages.forEach(msg => this._appendMessageDom(msg));
    this._scrollToBottom();
  }

  _appendMessageDom(msg) {
    if (!this.chatBody) return;

    const isMe = msg.role === "user";
    const bubble = document.createElement("div");
    bubble.className = `chat-message-item ${isMe ? 'msg-outgoing' : 'msg-incoming'}`;
    bubble.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: ${isMe ? 'flex-end' : 'flex-start'};
      margin-bottom: 10px;
      animation: fadeIn 0.2s ease-out;
    `;

    const meta = document.createElement("div");
    meta.style.cssText = `
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 3px;
      display: flex;
      gap: 6px;
    `;
    const safeSender = escapeHtml(msg.sender);
    const safeTime = escapeHtml(msg.time);
    meta.innerHTML = `<strong style="color: ${isMe ? 'var(--primary-2)' : 'var(--text)'};">${safeSender}</strong> <span>${safeTime}</span>`;

    const textBubble = document.createElement("div");
    textBubble.style.cssText = `
      padding: 8px 12px;
      border-radius: ${isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
      background: ${isMe ? 'var(--primary)' : 'var(--panel-soft)'};
      color: ${isMe ? '#ffffff' : 'var(--text)'};
      font-size: 12px;
      line-height: 1.4;
      max-width: 85%;
      border: 1px solid ${isMe ? 'transparent' : 'var(--border)'};
      word-break: break-word;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;
    textBubble.textContent = msg.text;

    bubble.appendChild(meta);
    bubble.appendChild(textBubble);
    if (msg.image && msg.image.startsWith('data:image/png;base64,')) {
      const image = document.createElement('img');
      image.src = msg.image;
      image.alt = 'Snapshot kamera sintetis pada waktu pesan';
      image.style.cssText = 'max-width:85%;height:auto;border-radius:12px;margin-top:8px;';
      bubble.appendChild(image);
    }
    if (this.chatBody) {
      this.chatBody.appendChild(bubble);
    }
  }

  _scrollToBottom() {
    if (this.chatBody) {
      this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }
  }

  _bindEvents() {
    const btnSend = document.getElementById("btnSendChat");
    const quickChips = document.querySelectorAll("#chatQuickSuggestions .quick-chip");
    const btnAttach = document.getElementById("btnChatAttach");
    const btnSound = document.getElementById("btnToggleChatSound");

    if (btnSound) {
      btnSound.addEventListener('click', () => {
        this.soundEnabled = !this.soundEnabled;
        try { window.localStorage.setItem('omnitraf.chatSound', String(this.soundEnabled)); } catch (_) {}
        this._syncSoundToggle();
      });
    }

    if (btnSend && this.chatInput) {
      btnSend.addEventListener("click", () => this.sendMessage());
      this.chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    quickChips.forEach(chip => {
      chip.addEventListener("click", () => {
        const text = chip.dataset.msg || chip.textContent;
        if (this.chatInput) {
          this.chatInput.value = text;
          this.sendMessage();
        }
      });
    });

    if (btnAttach) {
      btnAttach.addEventListener("click", () => {
        const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const canvas = document.getElementById('dashCameraCanvas') || document.querySelector('#view-cctv.active canvas');
        let image;
        try { if (canvas?.width) image = canvas.toDataURL('image/png'); } catch (_) {}
        if (!image) {
          window.showToast?.('Buka kamera sintetis sampai frame tersedia, lalu lampirkan kembali.', 'warning');
          return;
        }
        const attachMsg = {
          image,
          sender: "Operator Demo",
          role: "user",
          text: "📷 [Cuplikan Kamera Demo] Node contoh — metrik antrean sintetis.",
          time
        };
        this.messages.push(attachMsg);
        this._appendMessageDom(attachMsg);
        this._scrollToBottom();
        if (typeof window.showToast === "function") {
          window.showToast("Cuplikan demo ditambahkan ke chat lokal; tidak ada CCTV atau kanal petugas yang terhubung.");
        }
        this._triggerAutoReply(attachMsg.text);
      });
    }

    // Toggle Online Dispatchers list
    const btnToggleOnline = document.getElementById("btnToggleChatOnline");
    const chatOnlinePanel = document.getElementById("chatOnlinePanel");
    const btnCloseOnline = document.getElementById("btnCloseOnlinePanel");

    if (btnToggleOnline && chatOnlinePanel) {
      btnToggleOnline.addEventListener("click", () => {
        const isOpen = chatOnlinePanel.style.display !== "none";
        chatOnlinePanel.style.display = isOpen ? "none" : "block";
      });
    }

    if (btnCloseOnline && chatOnlinePanel) {
      btnCloseOnline.addEventListener("click", () => {
        chatOnlinePanel.style.display = "none";
      });
    }
  }

  addMessage(msg) {
    if (!msg || !msg.text) return;
    const time = msg.time || new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const formatted = {
      sender: msg.sender || "Pengguna Demo",
      role: msg.role || "user",
      text: msg.text,
      time
    };
    this.messages.push(formatted);
    if (this.messages.length > 100) {
      this.messages.shift();
    }
    this._appendMessageDom(formatted);
    if (this.chatBody && this.chatBody.children && this.chatBody.children.length > 100) {
      if (typeof this.chatBody.children[0]?.remove === 'function') {
        this.chatBody.children[0].remove();
      }
    }
    this._scrollToBottom();
  }

  sendMessage() {
    if (!this.chatInput) return;
    const text = this.chatInput.value.trim();
    if (!text) return;

    this._playSound('click');

    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const userMsg = {
      sender: "Operator Demo",
      role: "user",
      text,
      time
    };

    this.messages.push(userMsg);
    if (this.messages.length > 100) {
      this.messages.shift();
    }
    this._appendMessageDom(userMsg);
    if (this.chatBody && this.chatBody.children.length > 100) {
      this.chatBody.children[0].remove();
    }
    this.chatInput.value = "";
    this._scrollToBottom();

    this._triggerAutoReply(text);
  }

  _triggerAutoReply(userText) {
    if (this.typingWrapper) {
      this.typingWrapper.classList.remove("is-hidden");
      this._scrollToBottom();
    }

    setTimeout(() => {
      if (this.typingWrapper) {
        this.typingWrapper.classList.add("is-hidden");
      }

      let replySender = "Petugas Demo 01";
      let replyRole = "field";
      let replyText = "Balasan otomatis demo. Pesan ini tidak dikirim ke petugas dan tidak memantau arus nyata.";

      const lower = userText.toLowerCase();
      if (lower.includes("satlantas") || lower.includes("polisi") || lower.includes("kirim petugas")) {
        replySender = "Petugas Simulasi";
        replyRole = "field";
        replyText = "Skenario demo: permintaan petugas dicatat sebagai contoh saja. Tidak ada personel yang dikirim.";
      } else if (lower.includes("sirine") || lower.includes("suara")) {
        replySender = "Sistem Demo";
        replyRole = "admin";
        replyText = "Aksi sirine hanya disimulasikan di antarmuka; tidak ada sirine persimpangan yang diaktifkan.";
        this._playSound('alert');
      } else if (lower.includes("pohon") || lower.includes("tumbang") || lower.includes("dkrth")) {
        replySender = "Unit Demo";
        replyRole = "field";
        replyText = "Contoh respons untuk skenario hambatan jalan. Tidak ada evakuasi atau konfirmasi kondisi jalan.";
      } else if (lower.includes("ambulans") || lower.includes("darurat") || lower.includes("112")) {
        replySender = "Dispatcher Demo";
        replyRole = "dispatcher";
        replyText = "Skenario prioritas kendaraan berjalan di simulator saja. Layanan 112, GPS, dan APILL tidak terhubung.";
        this._playSound('siren');
      } else if (lower.includes("patroli") || lower.includes("dishub")) {
        replySender = "Patroli Demo";
        replyRole = "field";
        replyText = "Contoh status patroli; tidak ada kendaraan atau petugas nyata yang bergerak.";
      } else if (lower.includes("hijau") || lower.includes("siklus") || lower.includes("preemption")) {
        replySender = "Admin Demo";
        replyRole = "admin";
        replyText = "Nilai fase sinyal contoh diperbarui di simulator; tidak dikirim ke ATCS.";
      } else if (lower.includes("cctv") || lower.includes("kamera")) {
        replySender = "Operator Demo";
        replyRole = "dispatcher";
        replyText = "Kamera pada prototipe menggunakan adegan sintetis; tidak ada telemetri CCTV nyata.";
      } else if (lower.includes("copy") || lower.includes("lancar")) {
        replySender = "Admin Demo";
        replyRole = "admin";
        replyText = "Contoh balasan demo. Prototipe tidak terhubung ke SITS atau pengendali sinyal.";
      }

      const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const replyMsg = {
        sender: replySender,
        role: replyRole,
        text: replyText,
        time
      };

      this.messages.push(replyMsg);
      if (this.messages.length > 100) {
        this.messages.shift();
      }
      this._appendMessageDom(replyMsg);
      if (this.chatBody && this.chatBody.children.length > 100) {
        this.chatBody.children[0].remove();
      }
      this._scrollToBottom();

      this._playSound('dispatch');

      if (typeof window.showToast === "function") {
        window.showToast(`📻 Pesan Radio dari ${replySender}`);
      }
    }, 1200);
  }

  _playSound(type) {
    if (this.soundEnabled) soundManager.play(type);
  }

  _syncSoundToggle() {
    const button = document.getElementById('btnToggleChatSound');
    if (!button) return;
    button.textContent = this.soundEnabled ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', String(this.soundEnabled));
    button.setAttribute('aria-label', this.soundEnabled ? 'Matikan suara chat' : 'Aktifkan suara chat');
    button.setAttribute('title', this.soundEnabled ? 'Suara chat aktif' : 'Suara chat nonaktif');
  }
}

export const chatSystem = new ChatSystem();
