// SpotLocal Application Coordinator

const App = {
  currentTab: 'home',
  currentPlaylistId: null,
  activeTracks: [],
  searchTimeout: null,
  sseSource: null,

  async init() {
    this.bindEvents();
    this.setupSSE();
    await this.loadSidebarPlaylists();
    await this.navigate('home');

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  },

  bindEvents() {
    // Navigation items (Desktop)
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = el.dataset.tab;
        if (tab) this.navigate(tab);
      });
    });

    // Navigation items (Mobile)
    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = el.dataset.tab;
        if (tab) this.navigate(tab);
      });
    });

    // Global Search Inputs
    const headerSearch = document.getElementById('header-search');
    if (headerSearch) {
      headerSearch.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          if (this.currentTab !== 'search') {
            this.navigate('search');
          }
          this.executeSearch(e.target.value);
        }, 250);
      });
    }

    // Playback bar scrubbers
    this.setupScrubbers();

    // Player buttons
    document.getElementById('player-play-btn')?.addEventListener('click', () => Player.togglePlay());
    document.getElementById('mini-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      Player.togglePlay();
    });
    document.getElementById('fs-play-btn')?.addEventListener('click', () => Player.togglePlay());

    document.getElementById('player-next-btn')?.addEventListener('click', () => Player.next());
    document.getElementById('fs-next-btn')?.addEventListener('click', () => Player.next());
    document.getElementById('player-prev-btn')?.addEventListener('click', () => Player.previous());
    document.getElementById('fs-prev-btn')?.addEventListener('click', () => Player.previous());

    document.getElementById('player-shuffle-btn')?.addEventListener('click', () => Player.toggleShuffle());
    document.getElementById('fs-shuffle-btn')?.addEventListener('click', () => Player.toggleShuffle());
    document.getElementById('player-repeat-btn')?.addEventListener('click', () => Player.toggleRepeat());
    document.getElementById('fs-repeat-btn')?.addEventListener('click', () => Player.toggleRepeat());

    // Like buttons
    const bindHeart = (btnId) => {
      document.getElementById(btnId)?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tid = Player.currentTrack?.id;
        if (!tid) return;
        const res = await API.toggleFavorite(tid);
        Player.currentTrack.is_favorite = res.is_favorite ? 1 : 0;
        Player.updateTrackInfoUI(Player.currentTrack);
        this.showToast(res.is_favorite ? 'Добавлено в Любимые треки' : 'Удалено из Любимых треков');
      });
    };
    bindHeart('player-heart');
    bindHeart('mini-heart');
    bindHeart('fs-heart');

    // Mobile Miniplayer -> expand Fullscreen Player
    const miniPlayer = document.getElementById('mobile-miniplayer');
    const fsPlayer = document.getElementById('mobile-fullscreen-player');
    const fsClose = document.getElementById('fs-player-close');

    miniPlayer?.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      fsPlayer?.classList.add('open');
    });

    fsClose?.addEventListener('click', () => {
      fsPlayer?.classList.remove('open');
    });

    // Artist navigation from player bars
    document.getElementById('player-artist')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Player.currentTrack?.artist) this.openArtist(Player.currentTrack.artist);
    });
    document.getElementById('mini-artist')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Player.currentTrack?.artist) this.openArtist(Player.currentTrack.artist);
    });
    document.getElementById('fs-artist')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('mobile-fullscreen-player')?.classList.remove('open');
      if (Player.currentTrack?.artist) this.openArtist(Player.currentTrack.artist);
    });

    // Similar tracks buttons in players
    document.getElementById('player-similar-btn')?.addEventListener('click', () => {
      if (Player.currentTrack?.id) {
        this.openSimilarModal(Player.currentTrack.id);
      } else {
        this.showToast('Сначала выберите трек для воспроизведения');
      }
    });
    document.getElementById('fs-similar-btn')?.addEventListener('click', () => {
      if (Player.currentTrack?.id) {
        this.openSimilarModal(Player.currentTrack.id);
      } else {
        this.showToast('Сначала выберите трек для воспроизведения');
      }
    });

    // Library Rescan button
    document.getElementById('btn-rescan')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-rescan');
      btn.style.opacity = '0.5';
      this.showToast('Сканирование папки музыки...');
      try {
        const res = await API.rescanLibrary();
        this.showToast(`Сканирование завершено: +${res.result.indexed} треков`);
        await this.loadSidebarPlaylists();
        this.navigate(this.currentTab);
      } catch (err) {
        this.showToast('Ошибка сканирования');
      } finally {
        btn.style.opacity = '1';
      }
    });

    // Create Playlist button
    document.getElementById('btn-create-playlist')?.addEventListener('click', () => {
      this.openModal('create-playlist-modal');
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      });
    });

    // Form create playlist
    document.getElementById('form-create-playlist')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('new-playlist-name');
      const name = input.value.trim();
      if (!name) return;
      try {
        const pl = await API.createPlaylist(name);
        input.value = '';
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
        this.showToast(`Плейлист "${pl.name}" создан`);
        await this.loadSidebarPlaylists();
        this.openPlaylist(pl.id);
      } catch (err) {
        this.showToast('Ошибка создания плейлиста');
      }
    });

    // Queue buttons
    document.getElementById('player-queue-btn')?.addEventListener('click', () => this.openQueueModal());
    document.getElementById('fs-queue-btn')?.addEventListener('click', () => this.openQueueModal());
  },

  setupScrubbers() {
    const handleScrub = (containerId, onPercent) => {
      const el = document.getElementById(containerId);
      if (!el) return;

      const calc = (e) => {
        const rect = el.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        onPercent(pct);
      };

      let isDown = false;
      el.addEventListener('mousedown', (e) => {
        isDown = true;
        calc(e);
      });
      el.addEventListener('touchstart', (e) => {
        isDown = true;
        calc(e);
      }, { passive: true });

      window.addEventListener('mousemove', (e) => {
        if (isDown) calc(e);
      });
      window.addEventListener('touchmove', (e) => {
        if (isDown) calc(e);
      }, { passive: true });

      window.addEventListener('mouseup', () => { isDown = false; });
      window.addEventListener('touchend', () => { isDown = false; });
    };

    // Desktop playback scrub
    handleScrub('player-progress-wrap', (pct) => Player.seek(pct));
    // Mobile fullscreen playback scrub
    handleScrub('fs-progress-wrap', (pct) => Player.seek(pct));
    // Desktop volume scrub
    handleScrub('volume-bar-wrap', (pct) => Player.setVolume(pct / 100));
  },

  setupSSE() {
    this.sseSource = API.connectSSE((eventType, data) => {
      const term = document.getElementById('terminal-box');
      if (term && eventType === 'job_log') {
        term.textContent += `${data.line}\n`;
        term.scrollTop = term.scrollHeight;
      } else if (eventType === 'job_completed') {
        this.showToast('Загрузка через spotDL завершена!');
        if (term) term.textContent += `\n[SUCCESS] spotDL finished download. Library rescanned: +${data.scan_result?.indexed || 0} tracks.\n`;
        this.loadSidebarPlaylists();
        this.updateArtistBadges();
        if (this.currentTab === 'home' || this.currentTab === 'library') {
          this.navigate(this.currentTab);
        }
      } else if (eventType === 'job_error') {
        this.showToast('Ошибка загрузки spotDL');
        if (term) term.textContent += `\n[ERROR] ${data.error}\n`;
      }
    });
  },

  async updateArtistBadges() {
    if (!this.activeTracks || this.activeTracks.length === 0) return;
    try {
      const allDownloaded = await API.getTracks({ limit: 1000 });
      const dlMap = new Map();
      for (const t of allDownloaded) {
        const k = `${t.title.toLowerCase()}:${t.artist.toLowerCase()}`;
        dlMap.set(k, t.id);
      }
      let changed = false;
      for (const at of this.activeTracks) {
        const k = `${(at.title || '').toLowerCase()}:${(at.artist || '').toLowerCase()}`;
        if (!at.is_local && dlMap.has(k)) {
          at.is_local = true;
          at.local_track_id = dlMap.get(k);
          at.id = dlMap.get(k);
          changed = true;
        }
      }
      if (Player.currentTrack && !Player.currentTrack.is_local) {
        const curK = `${(Player.currentTrack.title || '').toLowerCase()}:${(Player.currentTrack.artist || '').toLowerCase()}`;
        if (dlMap.has(curK)) {
          Player.currentTrack.id = dlMap.get(curK);
          Player.currentTrack.is_local = true;
        }
      }
      if (changed && this.currentTab === 'artist') {
        const trackContainer = document.querySelector('.track-table tbody');
        if (trackContainer) {
          const freshTable = this.renderArtistTrackTable(this.activeTracks);
          const temp = document.createElement('div');
          temp.innerHTML = freshTable;
          const newTbody = temp.querySelector('tbody');
          if (newTbody) trackContainer.innerHTML = newTbody.innerHTML;
        }
      }
    } catch (e) {
      console.warn('Error updating badges:', e);
    }
  },

  async navigate(tab, param = null) {
    this.currentTab = tab;

    // Update active nav links
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });

    const content = document.getElementById('main-content');
    if (!content) return;

    // Show/hide search bar in header based on tab
    const searchWrapper = document.getElementById('header-search-wrapper');
    if (searchWrapper) {
      searchWrapper.style.display = (tab === 'search') ? 'block' : 'none';
    }

    if (tab === 'home') {
      await this.renderHome(content);
    } else if (tab === 'search') {
      await this.renderSearch(content);
    } else if (tab === 'library') {
      await this.renderLibrary(content);
    } else if (tab === 'downloader') {
      await this.renderDownloader(content);
    } else if (tab === 'favorites') {
      await this.renderFavorites(content);
    } else if (tab === 'playlist') {
      await this.renderPlaylist(content, param);
    } else if (tab === 'artist') {
      await this.renderArtist(content, param);
    } else if (tab === 'album') {
      await this.renderAlbum(content, param);
    }

    content.scrollTop = 0;
  },

  getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Доброе утро';
    if (hour >= 12 && hour < 18) return 'Добрый день';
    if (hour >= 18 && hour < 23) return 'Добрый вечер';
    return 'Доброй ночи';
  },

  async loadSidebarPlaylists() {
    try {
      const playlists = await API.getPlaylists();
      const container = document.getElementById('sidebar-playlists-list');
      if (!container) return;

      if (playlists.length === 0) {
        container.innerHTML = `<div style="padding: 12px; font-size: 0.8rem; color: var(--text-muted);">Создайте свой первый плейлист</div>`;
        return;
      }

      container.innerHTML = playlists.map(p => `
        <div class="playlist-nav-item" onclick="App.openPlaylist(${p.id})">
          <div class="playlist-thumb">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(p.name)}</span>
        </div>
      `).join('');
    } catch (e) {
      console.warn('Failed to load playlists:', e);
    }
  },

  // VIEWS
  async renderHome(container) {
    container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Загрузка музыки...</div>`;
    const tracks = await API.getTracks({ limit: 100 });
    this.activeTracks = tracks;

    const quickHtml = `
      <div class="greeting-section">
        <h1 class="section-title">${this.getGreeting()}</h1>
        <div class="quick-cards-grid">
          <div class="quick-card" onclick="App.navigate('favorites')">
            <div class="quick-card-img liked-gradient-icon" style="display:flex;align-items:center;justify-content:center;">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>
            <span class="quick-card-title">Любимые треки</span>
            <button class="quick-card-play" onclick="event.stopPropagation(); App.playFavorites()">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>

          <div class="quick-card" onclick="App.navigate('downloader')">
            <div class="quick-card-img" style="background:#222;display:flex;align-items:center;justify-content:center;">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="var(--green)"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
            </div>
            <span class="quick-card-title">Скачать со Spotify</span>
          </div>
        </div>
      </div>
    `;

    const tracksTableHtml = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 class="section-title">Все треки (${tracks.length})</h2>
          ${tracks.length > 0 ? `
            <button class="btn-primary" onclick="Player.playTrack(App.activeTracks[0], App.activeTracks)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              Слушать все
            </button>
          ` : ''}
        </div>
        ${tracks.length === 0 ? `
          <div style="background: var(--bg-surface); padding: 40px; border-radius: var(--radius-md); text-align: center;">
            <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px;">Ваша музыкальная библиотека пуста</p>
            <p style="color: var(--text-subdued); margin-bottom: 20px;">Скачайте треки или плейлисты прямо через встроенный spotDL!</p>
            <button class="btn-primary" onclick="App.navigate('downloader')">Перейти в Загрузчик</button>
          </div>
        ` : this.renderTrackTable(tracks)}
        <div id="home-recommendations-area"></div>
      </div>
    `;

    container.innerHTML = quickHtml + tracksTableHtml;

    if (tracks.length > 0) {
      setTimeout(async () => {
        try {
          const recArea = document.getElementById('home-recommendations-area');
          if (!recArea) return;
          const recData = await API.getRecommendations();
          if (recData && recData.similar_tracks && recData.similar_tracks.length > 0) {
            recArea.innerHTML = `
              <div style="margin-top: 16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                  <div>
                    <h2 class="section-title" style="font-size:1.25rem;">Вам может понравиться</h2>
                    <div style="color:var(--text-subdued); font-size:0.85rem;">Похожие треки на основе вашей медиатеки</div>
                  </div>
                </div>
                <div class="similar-card-list">
                  ${recData.similar_tracks.slice(0, 6).map(st => App.renderSimilarTrackRow(st)).join('')}
                </div>
              </div>
            `;
          }
        } catch (e) {
          // ignore error in background recommendation fetch
        }
      }, 50);
    }
  },

  async renderSearch(container) {
    const input = document.getElementById('header-search');
    const query = input ? input.value.trim() : '';

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <h1 class="section-title">Поиск</h1>
        <div class="downloader-input-group" style="margin-bottom: 12px;">
          <input type="text" id="inline-search" class="dl-input" placeholder="Что хочешь послушать? Трек, артист, альбом..." value="${this.escapeHtml(query)}" autofocus />
        </div>
        <div id="search-results-area">
          ${query ? '<div style="color: var(--text-muted);">Ищем...</div>' : '<div style="color: var(--text-subdued);">Введите название трека или имя артиста</div>'}
        </div>
      </div>
    `;

    const inline = document.getElementById('inline-search');
    inline?.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.executeSearch(e.target.value);
      }, 200);
    });

    if (query) {
      this.executeSearch(query);
    }
  },

  async executeSearch(query) {
    const resArea = document.getElementById('search-results-area');
    if (!resArea) return;

    const q = query.trim();
    if (!q) {
      resArea.innerHTML = '<div style="color: var(--text-subdued); padding: 20px 0;">Введите поисковый запрос (например: Noize MC, Queen, Выдыхай...)</div>';
      return;
    }

    resArea.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 10px;">
        <span style="display:inline-block; width:16px; height:16px; border:2px solid var(--green); border-top-color:transparent; border-radius:50%; animation: spin 0.8s linear infinite;"></span>
        <span>Поиск по всему каталогу музыки и медиатеке...</span>
      </div>
    `;

    try {
      const data = await API.searchUnified(q);
      let html = '';

      // 1. TOP RESULT
      if (data.top_result) {
        const tr = data.top_result;
        const isArtist = tr.type === 'artist';
        const clickAction = isArtist 
          ? `App.openArtist('${this.escapeHtml(tr.name)}')` 
          : (tr.is_local ? `App.playLocalTrackById(${tr.track_id})` : `App.playOnlineTrack(${JSON.stringify(tr).replace(/"/g, '&quot;')})`);

        html += `
          <div style="margin-bottom: 24px;">
            <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px;">Лучший результат</h2>
            <div class="top-result-card" onclick="${clickAction}">
              <div class="top-result-img-wrap ${isArtist ? 'rounded' : ''}">
                ${tr.picture ? `<img src="${tr.picture}" class="top-result-img" onerror="this.src='/static/icons/icon.svg'" />` : `
                  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#282828;">
                    <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                `}
              </div>
              <div class="top-result-info">
                <h3 class="top-result-title">${this.escapeHtml(tr.name)}</h3>
                <div class="top-result-meta">
                  <span class="badge-tag">${this.escapeHtml(tr.subtitle || (isArtist ? 'Исполнитель' : 'Трек'))}</span>
                  ${tr.fans ? `<span>• ${Number(tr.fans).toLocaleString()} слушателей</span>` : ''}
                </div>
              </div>
              <button class="btn-play-all" style="padding: 10px 22px; font-size: 0.9rem;" onclick="event.stopPropagation(); ${clickAction}">
                ${isArtist ? 'Перейти к артисту →' : '▶ Слушать'}
              </button>
            </div>
          </div>
        `;
      }

      // 2. ONLINE TRACKS / SONGS (WITH 1-CLICK DOWNLOAD / PLAY)
      if (data.online_tracks && data.online_tracks.length > 0) {
        html += `
          <div style="margin-bottom: 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
              <h2 style="font-size: 1.15rem; font-weight: 700;">Песни (Spotify)</h2>
              <span style="font-size: 0.8rem; color: var(--text-subdued);">${data.online_tracks.length} найдено</span>
            </div>
            <div class="similar-card-list">
              ${data.online_tracks.map(t => this.renderSimilarTrackRow(t)).join('')}
            </div>
          </div>
        `;
      }

      // 3. ARTISTS (MATCHING)
      if (data.artists && data.artists.length > 0) {
        html += `
          <div style="margin-bottom: 24px;">
            <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px;">Исполнители</h2>
            <div class="cards-grid">
              ${data.artists.map(a => `
                <div class="media-card" onclick="App.openArtist('${this.escapeHtml(a.name)}')">
                  <div class="media-card-img-wrap rounded" style="background:#282828;">
                    ${a.picture ? `<img class="media-card-img" src="${a.picture}" alt="${this.escapeHtml(a.name)}" />` : `
                      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
                        <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                      </div>
                    `}
                  </div>
                  <div class="media-card-title">${this.escapeHtml(a.name)}</div>
                  <div class="media-card-sub">${a.is_local ? '<span style="color:var(--green); font-weight:700;">● В медиатеке</span>' : 'Исполнитель'}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // 4. LOCAL TRACKS
      if (data.local_tracks && data.local_tracks.length > 0) {
        html += `
          <div style="margin-bottom: 24px;">
            <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px;">В вашей локальной медиатеке (${data.local_tracks.length})</h2>
            ${this.renderTrackTable(data.local_tracks)}
          </div>
        `;
      }

      if (!html) {
        html = `
          <div style="padding: 30px; text-align: center; color: var(--text-muted);">
            По запросу «${this.escapeHtml(q)}» ничего не найдено.
            <div style="margin-top: 14px;">
              <button class="btn-primary" onclick="App.openDownloaderWithQuery('${this.escapeHtml(q)}')">Скачать через spotDL</button>
            </div>
          </div>
        `;
      }

      resArea.innerHTML = html;
    } catch (e) {
      console.error('Search error:', e);
      resArea.innerHTML = `<div style="color: var(--red); padding: 20px; text-align: center;">Ошибка поиска в сети</div>`;
    }
  },

  async renderLibrary(container) {
    container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Загрузка библиотеки...</div>`;
    const [playlists, artists, albums] = await Promise.all([
      API.getPlaylists(),
      API.getArtists(),
      API.getAlbums()
    ]);

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h1 class="section-title">Моя медиатека</h1>
          <button class="btn-secondary" onclick="App.openModal('create-playlist-modal')">+ Создать плейлист</button>
        </div>

        <div>
          <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 14px;">Плейлисты</h2>
          <div class="cards-grid">
            <div class="media-card" onclick="App.navigate('favorites')">
              <div class="media-card-img-wrap liked-gradient-icon" style="display: flex; align-items: center; justify-content: center;">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="#fff"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              </div>
              <div class="media-card-title">Любимые треки</div>
              <div class="media-card-sub">Избранное</div>
            </div>

            ${playlists.map(p => `
              <div class="media-card" onclick="App.openPlaylist(${p.id})">
                <div class="media-card-img-wrap" style="display: flex; align-items: center; justify-content: center; background: #222;">
                  <svg viewBox="0 0 24 24" width="42" height="42" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <div class="media-card-title">${this.escapeHtml(p.name)}</div>
                <div class="media-card-sub">${p.track_count || 0} треков</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 14px;">Исполнители (${artists.length})</h2>
          <div class="cards-grid">
            ${artists.slice(0, 12).map(a => `
              <div class="media-card" onclick="App.openArtist('${this.escapeHtml(a.artist)}')">
                <div class="media-card-img-wrap rounded" style="background:#282828; display:flex; align-items:center; justify-content:center;">
                  <svg viewBox="0 0 24 24" width="42" height="42" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                </div>
                <div class="media-card-title">${this.escapeHtml(a.artist)}</div>
                <div class="media-card-sub">${a.track_count} треков</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 14px;">Альбомы (${albums.length})</h2>
          <div class="cards-grid">
            ${albums.slice(0, 12).map(al => `
              <div class="media-card" onclick="App.openAlbum('${this.escapeHtml(al.album)}')">
                <div class="media-card-img-wrap">
                  <img class="media-card-img" src="/api/covers/${al.sample_track_id}" onerror="this.src='/static/icons/icon.svg'" />
                </div>
                <div class="media-card-title">${this.escapeHtml(al.album)}</div>
                <div class="media-card-sub">${this.escapeHtml(al.artist)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  async renderDownloader(container) {
    const jobs = await API.getDownloadStatus();

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px; max-width: 900px;">
        <div class="downloader-header">
          <h1 class="section-title">Загрузчик через spotDL</h1>
          <p style="color: var(--text-subdued); font-size: 0.95rem;">
            Вставьте ссылку на трек, альбом или плейлист Spotify — либо просто поисковый запрос (Артист - Название). spotDL автоматически скачает музыку в наилучшем качестве, извлечёт метаданные и обложки в вашу библиотеку.
          </p>
        </div>

        <div class="downloader-card">
          <form id="dl-form" style="display: flex; flex-direction: column; gap: 14px;">
            <div class="downloader-input-group">
              <input type="text" id="dl-query-input" class="dl-input" placeholder="https://open.spotify.com/playlist/... или Название песни" required />
              <button type="submit" id="btn-submit-dl" class="btn-primary" style="height: 52px; padding: 0 28px;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                Скачать
              </button>
            </div>

            <div class="chips-row">
              <span class="chip" onclick="document.getElementById('dl-query-input').value='https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'">Пример трека</span>
              <span class="chip" onclick="document.getElementById('dl-query-input').value='Queen Bohemian Rhapsody'">Поиск по названию</span>
              <span class="chip" onclick="document.getElementById('dl-query-input').value='Daft Punk Get Lucky'">Daft Punk</span>
            </div>
          </form>

          <div>
            <div style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; color: var(--text-subdued); margin-bottom: 8px;">
              Терминал загрузки (spotDL Live Console)
            </div>
            <div id="terminal-box" class="terminal-box">[SpotLocal] Ready. Waiting for download task...</div>
          </div>
        </div>

        <div>
          <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 14px;">История загрузок</h2>
          <div style="background: var(--bg-surface); border-radius: var(--radius-md); overflow: hidden;">
            ${jobs.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: var(--text-muted);">Загрузок ещё не было</div>
            ` : `
              <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                ${jobs.map(j => `
                  <tr style="border-bottom: 1px solid #282828;">
                    <td style="padding: 12px 16px; font-weight: 600;">${this.escapeHtml(j.query)}</td>
                    <td style="padding: 12px 16px; text-align: right;">
                      <span style="padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; ${
                        j.status === 'completed' ? 'background: #1ed760; color: #000;' :
                        j.status === 'running' ? 'background: #2196f3; color: #fff;' :
                        j.status === 'error' ? 'background: #f15e6c; color: #fff;' : 'background: #555; color: #fff;'
                      }">
                        ${j.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </table>
            `}
          </div>
        </div>
      </div>
    `;

    document.getElementById('dl-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('dl-query-input');
      const val = input.value.trim();
      if (!val) return;

      const term = document.getElementById('terminal-box');
      if (term) term.textContent = `[SpotLocal] Launching spotDL task for: ${val}...\n`;

      try {
        const job = await API.startDownload(val);
        this.showToast('Загрузка начата в фоне...');
        input.value = '';
      } catch (err) {
        this.showToast('Ошибка запуска загрузки');
      }
    });
  },

  openDownloaderWithQuery(query) {
    this.navigate('downloader').then(() => {
      const input = document.getElementById('dl-query-input');
      if (input) input.value = query;
    });
  },

  async renderFavorites(container) {
    container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Загрузка...</div>`;
    const tracks = await API.getTracks({ favorites: true });
    this.activeTracks = tracks;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="display: flex; align-items: flex-end; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #282828;">
          <div class="liked-gradient-icon" style="width: 140px; height: 140px; border-radius: var(--radius-md); display:flex; align-items:center; justify-content:center; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="#fff"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </div>
          <div>
            <div style="text-transform: uppercase; font-size: 0.75rem; font-weight: 700; margin-bottom: 6px;">Плейлист</div>
            <h1 style="font-size: 2.5rem; font-weight: 900; margin-bottom: 12px;">Любимые треки</h1>
            <div style="color: var(--text-subdued); font-size: 0.9rem;">${tracks.length} треков</div>
          </div>
        </div>

        ${tracks.length > 0 ? `
          <div style="margin-bottom: 8px;">
            <button class="btn-primary" onclick="Player.playTrack(App.activeTracks[0], App.activeTracks)">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              Слушать
            </button>
          </div>
          ${this.renderTrackTable(tracks)}
        ` : `
          <div style="padding: 40px; text-align: center; color: var(--text-muted);">
            В любимых треках пока пусто. Нажимайте на сердечко у любых песен, чтобы добавить их сюда!
          </div>
        `}
      </div>
    `;
  },

  async openPlaylist(id) {
    this.navigate('playlist', id);
  },

  async renderPlaylist(container, id) {
    container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Загрузка плейлиста...</div>`;
    const pl = await API.getPlaylist(id);
    this.activeTracks = pl.tracks;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="display: flex; align-items: flex-end; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #282828;">
          <div style="width: 140px; height: 140px; border-radius: var(--radius-md); background: #242424; display:flex; align-items:center; justify-content:center; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
          <div style="flex: 1;">
            <div style="text-transform: uppercase; font-size: 0.75rem; font-weight: 700; margin-bottom: 6px;">Плейлист</div>
            <h1 style="font-size: 2.2rem; font-weight: 900; margin-bottom: 8px;">${this.escapeHtml(pl.name)}</h1>
            <div style="color: var(--text-subdued); font-size: 0.9rem;">${pl.tracks.length} треков</div>
          </div>
          <div>
            <button class="btn-icon-sm" title="Удалить плейлист" onclick="App.deletePlaylistPrompt(${pl.id}, '${this.escapeHtml(pl.name)}')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        </div>

        ${pl.tracks.length > 0 ? `
          <div>
            <button class="btn-primary" onclick="Player.playTrack(App.activeTracks[0], App.activeTracks)">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              Слушать плейлист
            </button>
          </div>
          ${this.renderTrackTable(pl.tracks, pl.id)}
        ` : `
          <div style="padding: 40px; text-align: center; color: var(--text-muted);">
            В этом плейлисте пока нет песен. Добавьте треки из поиска или домашней страницы!
          </div>
        `}
      </div>
    `;
  },

  async openArtist(artistName) {
    if (!artistName) return;
    this.navigate('artist', artistName);
  },

  async renderArtist(container, artistName) {
    container.innerHTML = `
      <div style="padding: 60px 20px; text-align: center; color: var(--text-muted); display:flex; align-items:center; justify-content:center; gap:12px;">
        <span style="display:inline-block; width:20px; height:20px; border:2px solid var(--green); border-top-color:transparent; border-radius:50%; animation: spin 0.8s linear infinite;"></span>
        <span style="font-size: 1.05rem;">Поиск артиста «${this.escapeHtml(artistName)}» по всему интернету...</span>
      </div>
    `;
    
    let data;
    try {
      data = await API.getArtist(artistName);
    } catch (e) {
      console.warn('API.getArtist failed, falling back to local tracks:', e);
      const local = await API.getTracks({ artist: artistName });
      data = {
        artist: artistName,
        local_tracks: local,
        top_tracks: [],
        local_albums: [],
        online_albums: [],
        similar_artists: [],
        similar_tracks: []
      };
    }

    const localTracks = data.local_tracks || [];
    const topTracks = data.top_tracks || [];

    // Compile complete tracklist: all popular songs from internet + local tracks
    const allTracks = [];
    const seenKeys = new Set();

    // 1. Add internet top tracks
    for (const t of topTracks) {
      const key = `${(t.title || '').toLowerCase()}:${(t.artist || '').toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allTracks.push(t);
      }
    }

    // 2. Add any local tracks not in top tracks
    for (const lt of localTracks) {
      const key = `${(lt.title || '').toLowerCase()}:${(lt.artist || '').toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allTracks.push({
          id: lt.id,
          local_track_id: lt.id,
          title: lt.title,
          artist: lt.artist,
          album: lt.album,
          duration: lt.duration,
          is_local: true,
          cover: `/api/covers/${lt.id}`
        });
      }
    }

    this.activeTracks = allTracks;
    const totalSec = allTracks.reduce((acc, t) => acc + (t.duration || 0), 0);

    const avatarHtml = data.avatar_url 
      ? `<img src="${data.avatar_url}" class="artist-avatar-img" alt="${this.escapeHtml(artistName)}" onerror="this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#282828;\\'><svg viewBox=\\'0 0 24 24\\' width=\\'70\\' height=\\'70\\' fill=\\'var(--text-subdued)\\'><path d=\\'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z\\'/></svg></div>'" />`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#282828;">
           <svg viewBox="0 0 24 24" width="70" height="70" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
         </div>`;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 28px;">
        <!-- ARTIST HERO -->
        <div class="artist-hero">
          <div class="artist-avatar-wrap">
            ${avatarHtml}
          </div>
          <div class="artist-info">
            <div class="artist-badge-verified">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              Исполнитель
            </div>
            <h1 class="artist-title-huge">${this.escapeHtml(artistName)}</h1>
            <div class="artist-meta-stats">
              <span>${allTracks.length} песен доступно</span>
              <span>• ${localTracks.length} скачано в медиатеку</span>
              ${data.fan_count ? `<span>• ${Number(data.fan_count).toLocaleString()} слушателей</span>` : ''}
              ${totalSec > 0 ? `<span>• ${Player.formatTime(totalSec)}</span>` : ''}
            </div>
            
            <div class="artist-actions-bar">
              ${allTracks.length > 0 ? `
                <button class="btn-play-all" onclick="App.playArtistAll()">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  Слушать все песни
                </button>
                <button class="btn-shuffle-all" onclick="App.playArtistAll(true)">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                  Перемешать
                </button>
                <button class="btn-shuffle-all" onclick="App.downloadArtistTop('${this.escapeHtml(artistName)}')">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                  Скачать топ-5 (spotDL)
                </button>
              ` : ''}
              <button class="btn-shuffle-all" onclick="App.openDownloaderWithQuery('${this.escapeHtml(artistName)}')">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                Загрузчик spotDL
              </button>
            </div>
          </div>
        </div>

        <!-- TRACKS LIST (Internet + Local) -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px;">
            <h2 style="font-size: 1.3rem; font-weight: 700;">Популярные песни (${allTracks.length})</h2>
            <span style="font-size:0.85rem; color:var(--text-subdued);">Нажмите на любой трек для прослушивания и загрузки spotDL</span>
          </div>
          ${allTracks.length > 0 ? this.renderArtistTrackTable(allTracks) : `
            <div style="background: var(--bg-surface); padding: 30px; border-radius: var(--radius-md); text-align: center; color: var(--text-subdued);">
              Песен не найдено. Попробуйте скачать треки через встроенный spotDL!
            </div>
          `}
        </div>

        <!-- ONLINE ALBUMS (from Deezer) -->
        ${((data.online_albums && data.online_albums.length > 0) || (data.local_albums && data.local_albums.length > 0)) ? `
          <div>
            <h2 style="font-size: 1.3rem; font-weight: 700; margin-bottom: 14px;">Альбомы</h2>
            <div class="cards-grid">
              ${(data.online_albums || []).map(al => `
                <div class="media-card" onclick="App.openDownloaderWithQuery('${this.escapeHtml(artistName + ' ' + al.title)}')">
                  <div class="media-card-img-wrap">
                    <img class="media-card-img" src="${al.cover || '/static/icons/icon.svg'}" onerror="this.src='/static/icons/icon.svg'" />
                  </div>
                  <div class="media-card-title">${this.escapeHtml(al.title)}</div>
                  <div class="media-card-sub">${al.release_date ? al.release_date.slice(0, 4) : 'Альбом'} • Скачать spotDL</div>
                </div>
              `).join('')}
              ${(data.local_albums || []).map(al => `
                <div class="media-card" onclick="App.openAlbum('${this.escapeHtml(al.album)}')">
                  <div class="media-card-img-wrap">
                    <img class="media-card-img" src="/api/covers/${al.sample_track_id}" onerror="this.src='/static/icons/icon.svg'" />
                  </div>
                  <div class="media-card-title">${this.escapeHtml(al.album)}</div>
                  <div class="media-card-sub"><span style="color:var(--green);font-weight:700;">● В медиатеке</span></div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- SIMILAR TRACKS (Radio) -->
        ${(data.similar_tracks && data.similar_tracks.length > 0) ? `
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px;">
              <div>
                <h2 style="font-size: 1.3rem; font-weight: 700;">Похожие треки и радио</h2>
                <div style="font-size: 0.85rem; color: var(--text-subdued);">Рекомендации в стиле ${this.escapeHtml(artistName)}</div>
              </div>
            </div>
            <div class="similar-card-list">
              ${data.similar_tracks.map(st => this.renderSimilarTrackRow(st)).join('')}
            </div>
          </div>
        ` : ''}

        <!-- SIMILAR ARTISTS (Fans Also Like) -->
        ${(data.similar_artists && data.similar_artists.length > 0) ? `
          <div>
            <h2 style="font-size: 1.3rem; font-weight: 700; margin-bottom: 14px;">Похожие исполнители</h2>
            <div class="cards-grid">
              ${data.similar_artists.map(sa => `
                <div class="media-card" onclick="App.openArtist('${this.escapeHtml(sa.name)}')">
                  <div class="media-card-img-wrap rounded" style="background:#282828;">
                    ${sa.picture ? `<img class="media-card-img" src="${sa.picture}" alt="${this.escapeHtml(sa.name)}" />` : `
                      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
                        <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                      </div>
                    `}
                  </div>
                  <div class="media-card-title">${this.escapeHtml(sa.name)}</div>
                  <div class="media-card-sub">${sa.is_in_library ? '<span style="color:var(--green); font-weight:700;">● В медиатеке</span>' : (sa.fans ? `${Number(sa.fans).toLocaleString()} слушателей` : 'Исполнитель')}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  async openAlbum(albumName) {
    this.navigate('album', albumName);
  },

  async renderAlbum(container, albumName) {
    container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Загрузка...</div>`;
    const tracks = await API.getTracks({ album: albumName });
    this.activeTracks = tracks;
    const sampleTrack = tracks[0] || {};

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="display: flex; align-items: flex-end; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #282828;">
          <img src="/api/covers/${sampleTrack.id || 0}" style="width: 140px; height: 140px; border-radius: var(--radius-md); object-fit: cover;" onerror="this.src='/static/icons/icon.svg'" />
          <div>
            <div style="text-transform: uppercase; font-size: 0.75rem; font-weight: 700; margin-bottom: 6px;">Альбом</div>
            <h1 style="font-size: 2.2rem; font-weight: 900; margin-bottom: 8px;">${this.escapeHtml(albumName)}</h1>
            <div style="color: var(--text-subdued); font-size: 0.9rem;">
              <span class="track-artist-link" onclick="App.openArtist('${this.escapeHtml(sampleTrack.artist || '')}')">${this.escapeHtml(sampleTrack.artist || '')}</span> • ${tracks.length} треков
            </div>
          </div>
        </div>

        <button class="btn-primary" onclick="Player.playTrack(App.activeTracks[0], App.activeTracks)">Слушать альбом</button>
        ${this.renderTrackTable(tracks)}
      </div>
    `;
  },

  renderTrackTable(tracks, currentPlaylistId = null) {
    return `
      <table class="track-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Название</th>
            <th class="track-album-cell">Альбом</th>
            <th style="width: 80px; text-align: right;">Время</th>
            <th style="width: 70px;"></th>
          </tr>
        </thead>
        <tbody>
          ${tracks.map((t, idx) => `
            <tr class="track-row ${Player.currentTrack?.id == t.id ? 'active' : ''}" data-id="${t.id}" onclick="Player.playTrack(App.activeTracks[${idx}], App.activeTracks)">
              <td class="track-cell track-num-cell">
                <span class="track-index">${idx + 1}</span>
                <span class="track-play-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </span>
              </td>
              <td class="track-cell">
                <div class="track-info-cell">
                  <img class="track-cover-sm" src="/api/covers/${t.id}" onerror="this.src='/static/icons/icon.svg'" />
                  <div class="track-meta">
                    <span class="track-title-text">${this.escapeHtml(t.title)}</span>
                    <span class="track-artist-text track-artist-link" onclick="event.stopPropagation(); App.openArtist('${this.escapeHtml(t.artist)}')">${this.escapeHtml(t.artist)}</span>
                  </div>
                </div>
              </td>
              <td class="track-cell track-album-cell">${this.escapeHtml(t.album || '-')}</td>
              <td class="track-cell" style="text-align: right; color: var(--text-subdued); font-size: 0.8rem;">
                ${Player.formatTime(t.duration)}
              </td>
              <td class="track-cell track-actions-cell" onclick="event.stopPropagation();">
                <button class="btn-heart ${t.is_favorite ? 'active' : ''}" onclick="App.toggleTrackHeart(${t.id}, this)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button class="btn-icon-sm" onclick="App.openTrackMenu(${t.id}, ${currentPlaylistId || 'null'}, event)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async toggleTrackHeart(trackId, btnEl) {
    const res = await API.toggleFavorite(trackId);
    btnEl.classList.toggle('active', !!res.is_favorite);
    if (Player.currentTrack?.id == trackId) {
      Player.currentTrack.is_favorite = res.is_favorite ? 1 : 0;
      Player.updateTrackInfoUI(Player.currentTrack);
    }
    this.showToast(res.is_favorite ? 'Добавлено в Любимые' : 'Удалено из Любимых');
  },

  async playFavorites() {
    const favs = await API.getTracks({ favorites: true });
    if (favs.length > 0) {
      this.activeTracks = favs;
      Player.playTrack(favs[0], favs);
    } else {
      this.showToast('В любимых треках пока пусто');
    }
  },

  async openTrackMenu(trackId, playlistId, event) {
    const playlists = await API.getPlaylists();
    const modal = document.getElementById('track-actions-modal');
    const container = document.getElementById('track-actions-content');
    if (!modal || !container) return;

    let html = `
      <div style="font-weight: 700; margin-bottom: 12px; font-size: 1.1rem;">Опции трека</div>
      <button class="btn-secondary" style="width: 100%; justify-content: flex-start; margin-bottom: 8px;" onclick="Player.addToQueue(App.activeTracks.find(t=>t.id==${trackId})); App.closeModal('track-actions-modal');">
        Добавить в очередь
      </button>
      <button class="btn-secondary" style="width: 100%; justify-content: flex-start; margin-bottom: 8px;" onclick="App.closeModal('track-actions-modal'); App.openSimilarModal(${trackId});">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:8px;"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/><path d="M19 8l1.25-2.75L23 4l-2.75-1.25L19 0l-1.25 2.75L15 4l2.75 1.25z"/></svg>
        Похожие треки (Радио)
      </button>
      <button class="btn-secondary" style="width: 100%; justify-content: flex-start; margin-bottom: 8px;" onclick="App.closeModal('track-actions-modal'); const t = App.activeTracks.find(x=>x.id==${trackId}); if (t) App.openArtist(t.artist);">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:8px;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        Перейти к исполнителю
      </button>
    `;

    if (playlistId) {
      html += `
        <button class="btn-secondary" style="width: 100%; justify-content: flex-start; color: var(--red); margin-bottom: 12px;" onclick="App.removeTrackFromPlaylist(${playlistId}, ${trackId})">
          Удалить из этого плейлиста
        </button>
      `;
    }

    html += `
      <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-subdued); margin: 12px 0 6px 0;">Добавить в плейлист:</div>
      <div style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
        ${playlists.length === 0 ? '<div style="color: var(--text-muted); font-size: 0.8rem;">Нет плейлистов</div>' : ''}
        ${playlists.map(p => `
          <button class="btn-secondary" style="width: 100%; justify-content: flex-start;" onclick="App.addTrackToPlaylist(${p.id}, ${trackId})">
            ${this.escapeHtml(p.name)}
          </button>
        `).join('')}
      </div>
    `;

    container.innerHTML = html;
    this.openModal('track-actions-modal');
  },

  async addTrackToPlaylist(playlistId, trackId) {
    try {
      await API.addToPlaylist(playlistId, trackId);
      this.closeModal('track-actions-modal');
      this.showToast('Трек добавлен в плейлист');
      await this.loadSidebarPlaylists();
    } catch (e) {
      this.showToast('Трек уже есть в этом плейлисте');
    }
  },

  async removeTrackFromPlaylist(playlistId, trackId) {
    try {
      await API.removeFromPlaylist(playlistId, trackId);
      this.closeModal('track-actions-modal');
      this.showToast('Трек удалён из плейлиста');
      this.renderPlaylist(document.getElementById('main-content'), playlistId);
    } catch (e) {
      this.showToast('Ошибка удаления трека');
    }
  },

  async deletePlaylistPrompt(id, name) {
    if (confirm(`Удалить плейлист "${name}"?`)) {
      await API.deletePlaylist(id);
      this.showToast('Плейлист удалён');
      await this.loadSidebarPlaylists();
      this.navigate('home');
    }
  },

  openQueueModal() {
    const modal = document.getElementById('queue-modal');
    const container = document.getElementById('queue-tracks-list');
    if (!modal || !container) return;

    if (Player.queue.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px;">Очередь воспроизведения пуста</div>`;
    } else {
      container.innerHTML = Player.queue.map((t, idx) => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 4px; ${idx === Player.currentIndex ? 'background: rgba(30, 215, 96, 0.15);' : ''}">
          <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; cursor: pointer;" onclick="Player.playTrack(Player.queue[${idx}]); App.closeModal('queue-modal');">
            <span style="font-size: 0.75rem; color: var(--text-subdued); width: 20px;">${idx + 1}</span>
            <div style="overflow: hidden;">
              <div style="font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${idx === Player.currentIndex ? 'color: var(--green);' : ''}">${this.escapeHtml(t.title)}</div>
              <div style="font-size: 0.75rem; color: var(--text-subdued);">${this.escapeHtml(t.artist)}</div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${Player.formatTime(t.duration)}</span>
        </div>
      `).join('');
    }

    this.openModal('queue-modal');
  },

  playArtistAll(shuffle = false) {
    if (!this.activeTracks || this.activeTracks.length === 0) {
      this.showToast('Нет доступных треков артиста');
      return;
    }
    let list = [...this.activeTracks];
    if (shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      this.showToast('Включён случайный порядок треков артиста');
    } else {
      this.showToast(`Воспроизведение всех треков артиста (${list.length})`);
    }
    Player.playTrack(list[0], list);
  },

  playArtistTrack(idx) {
    if (!this.activeTracks || !this.activeTracks[idx]) return;
    Player.playTrack(this.activeTracks[idx], this.activeTracks);
  },

  playOnlineTrack(track) {
    if (!track) return;
    Player.playTrack(track, [track]);
  },

  _downloadingTracks: new Set(),
  onOnlineTrackPlay(track) {
    if (!track || track.is_local) return;
    const qStr = `${track.artist} - ${track.title}`;
    if (this._downloadingTracks.has(qStr)) return;
    this._downloadingTracks.add(qStr);

    this.showToast(`Воспроизведение онлайн. spotDL скачивает полный трек...`);
    API.startDownload(qStr).catch(err => {
      console.warn('Auto spotDL download error:', err);
      this._downloadingTracks.delete(qStr);
    });
  },

  async downloadArtistTop(artistName) {
    if (!this.activeTracks || this.activeTracks.length === 0) {
      this.openDownloaderWithQuery(artistName);
      return;
    }
    const toDownload = this.activeTracks.filter(t => !t.is_local).slice(0, 5);
    if (toDownload.length === 0) {
      this.showToast('Все популярные треки артиста уже скачаны в медиатеку!');
      return;
    }
    this.showToast(`Запущено скачивание ${toDownload.length} лучших песен «${artistName}» через spotDL...`);
    for (const t of toDownload) {
      const q = `${t.artist} - ${t.title}`;
      this._downloadingTracks.add(q);
      API.startDownload(q).catch(() => {});
    }
  },

  renderArtistTrackTable(tracks) {
    return `
      <table class="track-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Название</th>
            <th class="track-album-cell">Альбом</th>
            <th style="width: 80px; text-align: right;">Время</th>
            <th style="width: 140px; text-align: right;">Статус</th>
          </tr>
        </thead>
        <tbody>
          ${tracks.map((t, idx) => {
            const isCur = (Player.currentTrack?.id && Player.currentTrack?.id == t.id) || 
                          (Player.currentTrack?.title === t.title && Player.currentTrack?.artist === t.artist);
            const coverSrc = t.cover || (t.id ? `/api/covers/${t.id}` : (t.local_track_id ? `/api/covers/${t.local_track_id}` : '/static/icons/icon.svg'));
            const qStr = `${t.artist} - ${t.title}`;
            return `
              <tr class="track-row ${isCur ? 'active' : ''}" onclick="App.playArtistTrack(${idx})">
                <td class="track-cell track-num-cell">
                  <span class="track-index">${idx + 1}</span>
                  <span class="track-play-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </span>
                </td>
                <td class="track-cell">
                  <div class="track-info-cell">
                    <img class="track-cover-sm" src="${coverSrc}" onerror="this.src='/static/icons/icon.svg'" />
                    <div class="track-meta">
                      <span class="track-title-text">${this.escapeHtml(t.title)}</span>
                      <span class="track-artist-text">${this.escapeHtml(t.artist)}</span>
                    </div>
                  </div>
                </td>
                <td class="track-cell track-album-cell">${this.escapeHtml(t.album || '-')}</td>
                <td class="track-cell" style="text-align: right; color: var(--text-subdued); font-size: 0.8rem;">
                  ${Player.formatTime(t.duration)}
                </td>
                <td class="track-cell" style="text-align: right;" onclick="event.stopPropagation();">
                  ${t.is_local ? `
                    <span class="badge-in-library">● В медиатеке</span>
                  ` : `
                    <button class="btn-download-sm" onclick="App.quickDownloadTrack('${this.escapeHtml(qStr)}', this)">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                      Скачать
                    </button>
                  `}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  renderSimilarTrackRow(st) {
    const qStr = `${st.artist} - ${st.title}`;
    const clickHandler = st.is_local && st.local_track_id 
      ? `App.playLocalTrackById(${st.local_track_id})` 
      : `App.playOnlineTrack(${JSON.stringify(st).replace(/"/g, '&quot;')})`;

    return `
      <div class="similar-track-item" style="cursor: pointer;" onclick="${clickHandler}">
        <div class="similar-track-left">
          <img class="similar-track-cover" src="${st.cover || '/static/icons/icon.svg'}" onerror="this.src='/static/icons/icon.svg'" />
          <div class="similar-track-meta">
            <span class="similar-track-title">${this.escapeHtml(st.title)}</span>
            <span class="similar-track-sub">
              <span class="track-artist-link" onclick="event.stopPropagation(); App.openArtist('${this.escapeHtml(st.artist)}')">${this.escapeHtml(st.artist)}</span>
              ${st.album ? ` • ${this.escapeHtml(st.album)}` : ''}
            </span>
          </div>
        </div>
        <div class="similar-track-actions" onclick="event.stopPropagation();">
          ${st.is_local ? `
            <span class="badge-in-library">В медиатеке</span>
            <button class="btn-play-all" style="padding: 6px 14px; font-size: 0.8rem;" onclick="App.playLocalTrackById(${st.local_track_id})">
              ▶
            </button>
          ` : `
            <button class="btn-play-all" style="padding: 6px 14px; font-size: 0.8rem;" onclick='App.playOnlineTrack(${JSON.stringify(st).replace(/'/g, "&#39;")})' title="Включить через spotDL">
              ▶ Слушать
            </button>
            <button class="btn-download-sm" onclick="App.quickDownloadTrack('${this.escapeHtml(qStr)}', this)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
              Скачать
            </button>
          `}
        </div>
      </div>
    `;
  },

  async openSimilarModal(trackId) {
    const modal = document.getElementById('similar-modal');
    const container = document.getElementById('similar-modal-content');
    if (!modal || !container) return;

    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">Ищем похожие треки...</div>`;
    this.openModal('similar-modal');

    try {
      const data = await API.getSimilarTracks(trackId);
      const seed = data.seed_track;
      if (!seed) {
        container.innerHTML = `<div style="color: var(--text-muted); text-align:center; padding: 20px;">Трек не найден</div>`;
        return;
      }

      document.getElementById('similar-modal-title').innerHTML = `
        <span>🎧 Радио трека: ${this.escapeHtml(seed.title)}</span>
      `;

      let html = `
        <div style="display:flex; align-items:center; gap:12px; padding:12px; background:rgba(255,255,255,0.05); border-radius:var(--radius-sm); margin-bottom:16px;">
          <img src="/api/covers/${seed.id}" style="width:50px; height:50px; border-radius:var(--radius-sm); object-fit:cover;" onerror="this.src='/static/icons/icon.svg'" />
          <div>
            <div style="font-weight:700;">${this.escapeHtml(seed.title)}</div>
            <div style="font-size:0.85rem; color:var(--text-subdued);">${this.escapeHtml(seed.artist)}</div>
          </div>
        </div>
      `;

      if (data.local_similar && data.local_similar.length > 0) {
        html += `
          <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 8px;">Похожие в вашей медиатеке</div>
          <div style="display:flex; flex-direction:column; gap:6px; margin-bottom: 20px;">
            ${data.local_similar.map(t => `
              <div class="similar-track-item" style="cursor:pointer;" onclick="App.playLocalTrackById(${t.id}); App.closeModal('similar-modal');">
                <div class="similar-track-left">
                  <img class="similar-track-cover" src="/api/covers/${t.id}" onerror="this.src='/static/icons/icon.svg'" />
                  <div class="similar-track-meta">
                    <span class="similar-track-title">${this.escapeHtml(t.title)}</span>
                    <span class="similar-track-sub">${this.escapeHtml(t.artist)}</span>
                  </div>
                </div>
                <div class="similar-track-actions">
                  <span class="badge-in-library">В медиатеке</span>
                  <button class="btn-play-all" style="padding:6px 12px; font-size:0.75rem;">▶</button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      if (data.similar_tracks && data.similar_tracks.length > 0) {
        html += `
          <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 8px;">Рекомендации и похожие треки</div>
          <div class="similar-card-list">
            ${data.similar_tracks.map(st => this.renderSimilarTrackRow(st)).join('')}
          </div>
        `;
      } else if (!data.local_similar || data.local_similar.length === 0) {
        html += `<div style="text-align:center; color:var(--text-muted); padding:20px;">Похожих треков не найдено</div>`;
      }

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div style="color:var(--red); text-align:center; padding:20px;">Ошибка загрузки похожих треков</div>`;
    }
  },

  async playLocalTrackById(trackId) {
    try {
      const track = await API.getTrack(trackId);
      if (track) {
        Player.playTrack(track, [track]);
        this.showToast(`Играет: ${track.artist} - ${track.title}`);
      }
    } catch (e) {
      this.showToast('Ошибка воспроизведения трека');
    }
  },

  async quickDownloadTrack(query, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Загрузка...';
    }
    this.showToast(`Загрузка «${query}» запущена через spotDL`);
    try {
      await API.startDownload(query);
    } catch (e) {
      this.showToast('Ошибка запуска загрузки');
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = 'Скачать';
      }
    }
  },

  _previewAudio: null,
  _previewBtn: null,

  togglePreview(url, btnEl) {
    if (this._previewAudio) {
      this._previewAudio.pause();
      if (this._previewBtn) {
        this._previewBtn.classList.remove('playing');
        this._previewBtn.textContent = '♫ Превью';
      }
      if (this._previewAudio.src === url) {
        this._previewAudio = null;
        this._previewBtn = null;
        return;
      }
    }

    const audio = new Audio(url);
    audio.play();
    btnEl.classList.add('playing');
    btnEl.textContent = '⏸ Стоп';
    this._previewAudio = audio;
    this._previewBtn = btnEl;

    audio.onended = () => {
      btnEl.classList.remove('playing');
      btnEl.textContent = '♫ Превью';
      this._previewAudio = null;
      this._previewBtn = null;
    };
    audio.onerror = () => {
      btnEl.classList.remove('playing');
      btnEl.textContent = '♫ Превью';
      this._previewAudio = null;
      this._previewBtn = null;
      this.showToast('Ошибка воспроизведения превью');
    };
  },

  openModal(id) {
    document.getElementById(id)?.classList.add('open');
  },

  closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  },

  showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
