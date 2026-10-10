import { authManager } from '../core/authManager.js';

export class SessionController {
  init() {
    const host = document.getElementById('modalsContainer');
    if (!host || document.getElementById('sessionDialog')) return;
    host.insertAdjacentHTML('beforeend', `
      <dialog id="sessionDialog" class="session-dialog" aria-labelledby="sessionTitle" aria-describedby="sessionHelp">
        <form id="sessionForm">
          <div class="section-head"><h2 id="sessionTitle">Masuk ke simulator</h2><button type="button" class="btn btn-ghost" data-close-session aria-label="Tutup formulir masuk">×</button></div>
          <p id="sessionHelp">Masuk untuk menerima stream server dan menjalankan perintah sesuai peran. Anda juga dapat menjelajahi demo lokal.</p>
          <label for="sessionUsername">Nama pengguna</label><input id="sessionUsername" class="input" name="username" autocomplete="username" required maxlength="64">
          <label for="sessionPassword">Kata sandi</label><input id="sessionPassword" class="input" name="password" type="password" autocomplete="current-password" required>
          <p id="sessionError" role="alert" hidden></p>
          <div class="session-actions"><button type="button" class="btn btn-ghost" data-close-session>Jelajahi demo lokal</button><button id="sessionSubmit" type="submit" class="btn btn-primary">Masuk</button></div>
        </form>
      </dialog>`);
    this.dialog = document.getElementById('sessionDialog');
    this.returnFocus = null;
    const profile = document.getElementById('operatorProfile');
    if (profile) {
      profile.tabIndex = 0;
      profile.setAttribute('role', 'button');
      profile.addEventListener('click', () => this.open());
      profile.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); this.open(); } });
    }
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-open-session]')) this.open();
      if (event.target.closest('[data-close-session]')) this.dialog.close();
    });
    this.dialog.addEventListener('close', () => { document.getElementById('sessionPassword').value = ''; this.returnFocus?.focus?.(); });
    this.dialog.addEventListener('click', (event) => { if (event.target === this.dialog) this.dialog.close(); });
    document.getElementById('sessionForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.getElementById('sessionSubmit');
      const error = document.getElementById('sessionError');
      button.disabled = true; button.setAttribute('aria-busy', 'true'); error.hidden = true;
      try {
        await authManager.login(document.getElementById('sessionUsername').value.trim(), document.getElementById('sessionPassword').value);
        this.dialog.close();
        window.showToast?.('Sesi server aktif. Izin sesuai peran telah diterapkan.', 'success');
      } catch (failure) { error.textContent = failure.message || 'Server tidak dapat dihubungi. Coba lagi.'; error.hidden = false; }
      finally { button.disabled = false; button.removeAttribute('aria-busy'); }
    });
    const logout = document.createElement('button');
    logout.type = 'button'; logout.id = 'sessionLogout'; logout.className = 'btn btn-ghost compact'; logout.textContent = 'Keluar'; logout.hidden = true;
    profile?.parentElement?.appendChild(logout);
    logout.addEventListener('click', async () => { logout.disabled = true; try { await authManager.logout(); window.showToast?.('Sesi berakhir. Demo lokal tersedia.', 'info'); } catch (error) { window.showToast?.(error.message || 'Gagal mengakhiri sesi server.', 'danger'); } finally { logout.disabled = false; } });
    const sync = (user) => {
      logout.hidden = !user;
      profile?.setAttribute('aria-label', user ? `Sesi ${user.name || user.username}. Keluar tersedia di tombol sebelah.` : 'Masuk ke simulator');
      const login = document.querySelector('[data-open-session]'); if (login) login.hidden = Boolean(user);
    };
    authManager.onAuthChange(sync); sync(authManager.getUser());
  }

  open() {
    if (!this.dialog) return;
    this.returnFocus = document.activeElement;
    document.getElementById('sessionError').hidden = true;
    if (!this.dialog.open) this.dialog.showModal();
    document.getElementById('sessionUsername').focus();
  }
}

export const sessionController = new SessionController();
