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
        <div class="modal-overlay csp-style-236ff41546" id="${this._modalId}" >
          <div class="modal-content glass-panel csp-style-215c085d3a" >
            <div class="csp-style-834fd65dce" >
              <span class="csp-style-0d7886adef" >⚠️</span>
              <div>
                <h3 id="confirmModalTitle" class="csp-style-cebb3cba63">KONFIRMASI PERINTAH BERISIKO TINGGI</h3>
                <p id="confirmModalLevel" class="csp-style-66e38c5e16">CRITICAL ACTION REQUIRED</p>
              </div>
            </div>
            
            <div class="csp-style-f9ecf9a5c4" >
              <div class="csp-style-abd137b89b" ><strong class="csp-style-9fbb568a76" >Target / Lokasi:</strong> <span id="confirmModalTarget" class="csp-style-7763de74ad" >-</span></div>
              <div class="csp-style-abd137b89b" ><strong class="csp-style-9fbb568a76" >Alasan / Deskripsi:</strong> <span id="confirmModalReason">-</span></div>
              <div class="csp-style-abd137b89b" ><strong class="csp-style-9fbb568a76" >Estimasi Durasi:</strong> <span id="confirmModalDuration" class="csp-style-1d6ef49380" >-</span></div>
              <div><strong class="csp-style-9fbb568a76" >Persimpangan Terdampak:</strong> <span id="confirmModalImpacted" class="csp-style-398922df1f" >-</span></div>
            </div>

            <div class="csp-style-74aa97bfdf" >
              <button class="btn btn-ghost csp-style-76e392845e" id="btnConfirmCancel" >Batalkan</button>
              <button class="btn btn-primary csp-style-95688b0491" id="btnConfirmProceed" >Setujui & Kirim</button>
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
