/**
 * OmniTRAF Surabaya - Confirmation Service (Phase 1 Refactor)
 * Bertanggung jawab khusus untuk modal konfirmasi high-risk command,
 * backdrop click handling, escape key handling, dan DOM modal lifecycle.
 */

export class ConfirmationService {
  constructor() {
    this._modalId = "operatorConfirmModal";
  }

  ensureModalDOM() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(this._modalId);
    if (!existing) {
      const modalHtml = `
        <div class="modal-overlay" id="${this._modalId}" style="display:none; z-index:99999; justify-content:center; align-items:center; background:rgba(15,23,42,0.85); backdrop-filter:blur(4px); transition:opacity 0.2s;">
          <div class="modal-content glass-panel" style="max-width:480px; width:94vw; border:1px solid rgba(239,68,68,0.4); padding:24px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
              <span style="font-size:32px; color:#ef4444;">⚠️</span>
              <div>
                <h3 style="margin:0; font-size:18px; font-weight:800; color:#fff;" id="confirmModalTitle">KONFIRMASI PERINTAH BERISIKO TINGGI</h3>
                <p style="margin:2px 0 0 0; font-size:11px; color:#ef4444; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;" id="confirmModalLevel">CRITICAL ACTION REQUIRED</p>
              </div>
            </div>
            
            <div style="font-size:12.5px; line-height:1.5; color:#cbd5e1; background:rgba(0,0,0,0.2); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); margin-bottom:18px;">
              <div style="margin-bottom:6px;"><strong style="color:#94a3b8;">Target / Lokasi:</strong> <span id="confirmModalTarget" style="color:#fff; font-family:'Share Tech Mono'; font-weight:700;">-</span></div>
              <div style="margin-bottom:6px;"><strong style="color:#94a3b8;">Alasan / Deskripsi:</strong> <span id="confirmModalReason">-</span></div>
              <div style="margin-bottom:6px;"><strong style="color:#94a3b8;">Estimasi Durasi:</strong> <span id="confirmModalDuration" style="color:#38bdf8;">-</span></div>
              <div><strong style="color:#94a3b8;">Persimpangan Terdampak:</strong> <span id="confirmModalImpacted" style="color:#f59e0b;">-</span></div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button class="btn btn-ghost" id="btnConfirmCancel" style="padding:8px 16px; font-size:12px;">Batalkan</button>
              <button class="btn btn-primary" id="btnConfirmProceed" style="background:#ef4444; border-color:#ef4444; color:#fff; padding:8px 20px; font-weight:700; font-size:12px;">Setujui & Kirim</button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
  }

  /**
   * Menampilkan konfirmasi untuk perintah berisiko tinggi
   * @param {Object} intent
   * @returns {Promise<boolean>}
   */
  confirm(intent) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve(true);
        return;
      }

      this.ensureModalDOM();

      const modal = document.getElementById(this._modalId);
      const title = document.getElementById("confirmModalTitle");
      const target = document.getElementById("confirmModalTarget");
      const reason = document.getElementById("confirmModalReason");
      const duration = document.getElementById("confirmModalDuration");
      const impacted = document.getElementById("confirmModalImpacted");
      const btnCancel = document.getElementById("btnConfirmCancel");
      const btnProceed = document.getElementById("btnConfirmProceed");

      if (!modal) {
        resolve(true);
        return;
      }

      // Customize content based on action severity
      if (intent.action === 'emergency:activate') {
        if (title) title.textContent = "KONFIRMASI SKENARIO KENDARAAN DARURAT";
        if (target) target.textContent = `${intent.payload?.code || 'AMBULANCE-02'} (Rute: ${intent.payload?.route ? intent.payload.route.replace('route-', '').toUpperCase() : 'SOETOMO'})`;
        if (reason) reason.textContent = "Aksi ini hanya mengubah state simulator; tidak menghubungi layanan 112 atau mengendalikan sinyal fisik.";
        if (duration) duration.textContent = "Hingga 300 detik dalam simulasi";
        if (impacted) impacted.textContent = "Koridor contoh dalam peta demo";
      } else if (intent.action === 'signal:override') {
        if (title) title.textContent = "KONFIRMASI MANUAL SIGNAL OVERRIDE";
        if (target) target.textContent = intent.targetId;
        if (reason) reason.textContent = "Perubahan fase hanya diterapkan pada simulator; belum ada validasi keselamatan lapangan.";
        if (duration) duration.textContent = "45 detik berkelanjutan";
        if (impacted) impacted.textContent = `${intent.targetId} dan koridor terdekat`;
      } else if (intent.action === 'green-wave:toggle') {
        if (title) title.textContent = "KONFIRMASI GREEN WAVE TIMING LOCK";
        if (target) target.textContent = "Koridor Utama A. Yani - Darmo";
        if (reason) reason.textContent = "Mengubah visualisasi skenario green wave; tidak ada koordinasi atau pengendalian APILL nyata.";
        if (duration) duration.textContent = intent.payload?.active ? "Aktif pada state simulasi" : "Kembali ke state simulasi";
        if (impacted) impacted.textContent = "Wonokromo, Jemursari, Darmo, Tunjungan";
      } else {
        if (title) title.textContent = "KONFIRMASI TINDAKAN OPERATOR CRITICAL";
        if (target) target.textContent = intent.targetId || "Simulator OmniTRAF";
        if (reason) reason.textContent = "Perubahan ini hanya memengaruhi state demo lokal.";
        if (duration) duration.textContent = "State simulasi";
        if (impacted) impacted.textContent = "Komponen demo terkait";
      }

      modal.style.display = "flex";
      modal.style.opacity = "1";

      const cleanup = () => {
        modal.style.display = "none";
        if (btnCancel) btnCancel.removeEventListener("click", handleCancel);
        if (btnProceed) btnProceed.removeEventListener("click", handleProceed);
        modal.removeEventListener("click", handleBackdropClick);
        if (typeof window !== 'undefined') {
          window.removeEventListener("keydown", handleEscape);
        }
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const handleProceed = () => {
        cleanup();
        resolve(true);
      };

      const handleBackdropClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      const handleEscape = (e) => {
        if (e.key === "Escape") {
          handleCancel();
        }
      };

      if (btnCancel) btnCancel.addEventListener("click", handleCancel);
      if (btnProceed) btnProceed.addEventListener("click", handleProceed);
      modal.addEventListener("click", handleBackdropClick);
      if (typeof window !== 'undefined') {
        window.addEventListener("keydown", handleEscape);
      }
    });
  }
}

export const confirmationService = new ConfirmationService();
