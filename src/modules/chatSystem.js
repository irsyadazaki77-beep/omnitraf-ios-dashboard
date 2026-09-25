/**
 * OmniTRAF Surabaya - Staff Coordination Chat System
 * Menangani perpesanan koordinasi langsung antar petugas lapangan Dishub,
 * operator ATCS SITS, dan dispatcher tanggap darurat 112 Kota Surabaya.
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
        sender: "Budi Santoso (Admin SITS)",
        role: "admin",
        text: "Pagi tim koordinasi. Seluruh 184 node CCTV SITS dan koridor arteri Surabaya telah aktif tersinkronisasi.",
        time: "07:45"
      },
      {
        sender: "Rian (Dishub Wonokromo)",
        role: "field",
        text: "Copy pusat. Titik temu Frontage Margorejo - Wonokromo mulai merayap 200m arah utara.",
        time: "07:52"
      },
      {
        sender: "Dewi (Dispatcher 112)",
        role: "dispatcher",
        text: "Siaga, Ambulans AMB-02 bersiap meluncur dari Bundaran Waru menuju RSU Dr. Soetomo.",
        time: "08:02"
      }
    ];

    this.chatBody = null;
    this.chatInput = null;
    this.typingWrapper = null;
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this.chatBody = document.getElementById("staffChatBody");
    this.chatInput = document.getElementById("chatInputText");
    this.typingWrapper = document.getElementById("chatTypingWrapper");

    this._renderInitialMessages();
    this._bindEvents();
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
    this.chatBody.appendChild(bubble);
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
        const attachMsg = {
          sender: "Zaki (Operator SITS)",
          role: "user",
          text: "📷 [Lampiran Snapshot CCTV] Wonokromo Node-01 — Tingkat kemacetan 68%, antrean teridentifikasi 140m.",
          time
        };
        this.messages.push(attachMsg);
        this._appendMessageDom(attachMsg);
        this._scrollToBottom();
        if (typeof window.showToast === "function") {
          window.showToast("Snapshot CCTV SITS berhasil dibagikan ke kanal koordinasi.");
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

  sendMessage() {
    if (!this.chatInput) return;
    const text = this.chatInput.value.trim();
    if (!text) return;

    soundManager.play('click');

    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const userMsg = {
      sender: "Zaki (Operator SITS)",
      role: "user",
      text,
      time
    };

    this.messages.push(userMsg);
    this._appendMessageDom(userMsg);
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

      let replySender = "Rian (Dishub Wonokromo)";
      let replyRole = "field";
      let replyText = "Copy pusat kendali. Koordinasi dipahami, monitor terus perkembangan arus.";

      const lower = userText.toLowerCase();
      if (lower.includes("satlantas") || lower.includes("polisi") || lower.includes("kirim petugas")) {
        replySender = "Aipda Wahyudi (Satlantas Polrestabes)";
        replyRole = "field";
        replyText = "8-1-3 Dimengerti pusat kendali SITS! 2 personil Satlantas dan unit motor patroli meluncur ke lokasi untuk penguraian antrean.";
      } else if (lower.includes("sirine") || lower.includes("suara")) {
        replySender = "Sistem Otomasi ATCS SITS";
        replyRole = "admin";
        replyText = "🔊 Sirine peringatan audio persimpangan Wonokromo telah diaktifkan dengan volume terkalibrasi dari Command Center.";
        soundManager.play('alert');
      } else if (lower.includes("pohon") || lower.includes("tumbang") || lower.includes("dkrth")) {
        replySender = "Regu DKRTH & PMK Surabaya";
        replyRole = "field";
        replyText = "Lapor pusat: Evakuasi ranting dan pohon tumbang telah rampung 100%. Dua lajur jalan kini steril dan aman dilalui kendaraan.";
      } else if (lower.includes("ambulans") || lower.includes("darurat") || lower.includes("112")) {
        replySender = "Dewi (Dispatcher 112)";
        replyRole = "dispatcher";
        replyText = "🚨 Siaga darurat: Koridor prioritas Ambulans Bundaran Waru - RSUD Dr. Soetomo aktif! Sinyal Margorejo, Wonokromo, dan Darmo dikunci hijau.";
        soundManager.play('siren');
      } else if (lower.includes("patroli") || lower.includes("dishub")) {
        replySender = "Patroli Dishub Unit 04";
        replyRole = "field";
        replyText = "Patroli bergerak merapat ke Simpang Wonokromo dalam 4 menit untuk pengaturan manual.";
      } else if (lower.includes("hijau") || lower.includes("siklus") || lower.includes("preemption")) {
        replySender = "Budi Santoso (Admin SITS)";
        replyRole = "admin";
        replyText = "Fase hijau Wonokromo disesuaikan via ATCS. Koridor Darmo dialokasikan prioritas tambahan.";
      } else if (lower.includes("cctv") || lower.includes("kamera")) {
        replySender = "Dewi (Dispatcher 112)";
        replyRole = "dispatcher";
        replyText = "Telemetri CCTV Wonokromo jernih, analitik CV mendeteksi kecepatan rata-rata 24 km/jam.";
      } else if (lower.includes("copy") || lower.includes("lancar")) {
        replySender = "Budi Santoso (Admin SITS)";
        replyRole = "admin";
        replyText = "Terima kasih konfirmasinya. Sistem SITS menjaga headway sinyal optimal.";
      }

      const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const replyMsg = {
        sender: replySender,
        role: replyRole,
        text: replyText,
        time
      };

      this.messages.push(replyMsg);
      this._appendMessageDom(replyMsg);
      this._scrollToBottom();

      soundManager.play('dispatch');

      if (typeof window.showToast === "function") {
        window.showToast(`📻 Pesan Radio dari ${replySender}`);
      }
    }, 1200);
  }
}

export const chatSystem = new ChatSystem();
