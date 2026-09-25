// SpotLocal Audio Engine & MediaSession Controller

class PlayerEngine {
  constructor() {
    this.audio = new Audio();
    this.currentTrack = null;
    this.queue = [];
    this.currentIndex = -1;
    this.isShuffle = localStorage.getItem('spotlocal_shuffle') === 'true';
    this.repeatMode = localStorage.getItem('spotlocal_repeat') || 'off'; // 'off' | 'all' | 'one'
    this.volume = parseFloat(localStorage.getItem('spotlocal_volume') || '0.8');
    this.isPlaying = false;
    this.shuffledIndices = [];

    this.audio.volume = this.volume;
    this.audio.preload = 'metadata';

    this.initAudioEvents();
    this.initMediaSession();
  }

  initAudioEvents() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayStateUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayStateUI();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });

    this.audio.addEventListener('timeupdate', () => {
      this.updateProgressUI();
    });

    this.audio.addEventListener('ended', () => {
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.next();
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error on:', this.audio.src, e);
      if (window.App) {
        window.App.showToast('Ошибка воспроизведения трека');
      }
    });
  }

  initMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime && this.audio.duration) {
        this.audio.currentTime = details.seekTime;
      }
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      this.audio.currentTime = Math.max(this.audio.currentTime - skip, 0);
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      this.audio.currentTime = Math.min(this.audio.currentTime + skip, this.audio.duration || 0);
    });
  }

  updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator)) return;

    const coverUrl = track.cover || (track.id > 0 ? `/api/covers/${track.id}` : '/static/icons/icon.svg');
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'SpotLocal',
      artwork: [
        { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: coverUrl, sizes: '512x512', type: 'image/jpeg' }
      ]
    });
  }

  playTrack(track, newQueue = null) {
    if (!track) return;

    if (newQueue && Array.isArray(newQueue)) {
      this.queue = [...newQueue];
      this.currentIndex = this.queue.findIndex(t => (t.id > 0 && t.id === track.id) || (t.title === track.title && t.artist === track.artist));
      if (this.currentIndex === -1) {
        this.queue.unshift(track);
        this.currentIndex = 0;
      }
    } else if (this.queue.length === 0) {
      this.queue = [track];
      this.currentIndex = 0;
    } else {
      this.currentIndex = this.queue.findIndex(t => (t.id > 0 && t.id === track.id) || (t.title === track.title && t.artist === track.artist));
      if (this.currentIndex === -1) {
        this.queue.push(track);
        this.currentIndex = this.queue.length - 1;
      }
    }

    this.currentTrack = track;
    const isOnline = !track.id || track.id <= 0 || !track.is_local;
    if (isOnline) {
      const qStr = `${track.artist} - ${track.title}`;
      this.audio.src = `/api/stream/online?q=${encodeURIComponent(qStr)}&artist=${encodeURIComponent(track.artist || '')}&title=${encodeURIComponent(track.title || '')}`;
    } else {
      this.audio.src = `/api/stream/${track.id}`;
    }

    this.audio.play().catch(err => {
      console.warn('Playback prevented or interrupted:', err);
    });

    this.updateMediaSessionMetadata(track);
    this.updateTrackInfoUI(track);

    if (track.id && track.id > 0) {
      API.recordPlay(track.id).catch(() => {});
    }

    if (isOnline && window.App && window.App.onOnlineTrackPlay) {
      window.App.onOnlineTrackPlay(track);
    }
  }

  togglePlay() {
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.playTrack(this.queue[0]);
      }
      return;
    }
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  play() {
    if (this.audio.src) {
      this.audio.play().catch(e => console.warn(e));
    }
  }

  pause() {
    this.audio.pause();
  }

  next() {
    if (this.queue.length === 0) return;

    if (this.isShuffle) {
      this.currentIndex = Math.floor(Math.random() * this.queue.length);
    } else {
      this.currentIndex++;
      if (this.currentIndex >= this.queue.length) {
        if (this.repeatMode === 'all') {
          this.currentIndex = 0;
        } else {
          this.currentIndex = this.queue.length - 1;
          this.pause();
          return;
        }
      }
    }

    const nextTrack = this.queue[this.currentIndex];
    if (nextTrack) {
      this.playTrack(nextTrack);
    }
  }

  previous() {
    if (this.audio.currentTime > 3.0) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.queue.length === 0) return;

    this.currentIndex--;
    if (this.currentIndex < 0) {
      this.currentIndex = this.queue.length - 1;
    }
    const prevTrack = this.queue[this.currentIndex];
    if (prevTrack) {
      this.playTrack(prevTrack);
    }
  }

  seek(percent) {
    if (!this.audio.duration) return;
    const time = (percent / 100) * this.audio.duration;
    this.audio.currentTime = time;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.audio.volume = this.volume;
    localStorage.setItem('spotlocal_volume', this.volume);
    this.updateVolumeUI();
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    localStorage.setItem('spotlocal_shuffle', this.isShuffle);
    this.updateControlButtonsUI();
    if (window.App) {
      window.App.showToast(this.isShuffle ? 'Случайный порядок включен' : 'Случайный порядок выключен');
    }
  }

  toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const nextIdx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
    this.repeatMode = modes[nextIdx];
    localStorage.setItem('spotlocal_repeat', this.repeatMode);
    this.updateControlButtonsUI();

    const modeLabels = {
      'off': 'Повтор выключен',
      'all': 'Повтор всех треков',
      'one': 'Повтор одного трека'
    };
    if (window.App) {
      window.App.showToast(modeLabels[this.repeatMode]);
    }
  }

  addToQueue(track) {
    this.queue.push(track);
    if (!this.currentTrack) {
      this.playTrack(track);
    } else if (window.App) {
      window.App.showToast(`Трек добавлен в очередь: ${track.title}`);
    }
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // UI Updates
  updateTrackInfoUI(track) {
    const coverUrl = track.cover || (track.id > 0 ? `/api/covers/${track.id}` : '/static/icons/icon.svg');

    // Desktop Player Bar
    const dCover = document.getElementById('player-cover');
    const dTitle = document.getElementById('player-title');
    const dArtist = document.getElementById('player-artist');
    const dHeart = document.getElementById('player-heart');

    if (dCover) dCover.src = coverUrl;
    if (dTitle) dTitle.textContent = track.title;
    if (dArtist) dArtist.textContent = track.artist;
    if (dHeart) {
      dHeart.classList.toggle('active', !!track.is_favorite);
      dHeart.dataset.trackId = track.id;
    }

    // Mobile Miniplayer
    const mCover = document.getElementById('mini-cover');
    const mTitle = document.getElementById('mini-title');
    const mArtist = document.getElementById('mini-artist');
    const mHeart = document.getElementById('mini-heart');

    if (mCover) mCover.src = coverUrl;
    if (mTitle) mTitle.textContent = track.title;
    if (mArtist) mArtist.textContent = track.artist;
    if (mHeart) {
      mHeart.classList.toggle('active', !!track.is_favorite);
      mHeart.dataset.trackId = track.id;
    }

    // Mobile Full-Screen Player
    const fsCover = document.getElementById('fs-cover');
    const fsTitle = document.getElementById('fs-title');
    const fsArtist = document.getElementById('fs-artist');
    const fsHeart = document.getElementById('fs-heart');

    if (fsCover) fsCover.src = coverUrl;
    if (fsTitle) fsTitle.textContent = track.title;
    if (fsArtist) fsArtist.textContent = track.artist;
    if (fsHeart) {
      fsHeart.classList.toggle('active', !!track.is_favorite);
      fsHeart.dataset.trackId = track.id;
    }

    // Highlight row in active track table
    document.querySelectorAll('.track-row').forEach(row => {
      row.classList.toggle('active', row.dataset.id == track.id);
    });
  }

  updatePlayStateUI() {
    const playIconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    const pauseIconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

    const dPlayBtn = document.getElementById('player-play-btn');
    if (dPlayBtn) dPlayBtn.innerHTML = this.isPlaying ? pauseIconSvg : playIconSvg;

    const mPlayBtn = document.getElementById('mini-play-btn');
    if (mPlayBtn) mPlayBtn.innerHTML = this.isPlaying ? pauseIconSvg : playIconSvg;

    const fsPlayBtn = document.getElementById('fs-play-btn');
    if (fsPlayBtn) {
      const fsIcon = this.isPlaying 
        ? `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
        : `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      fsPlayBtn.innerHTML = fsIcon;
    }
  }

  updateProgressUI() {
    const cur = this.audio.currentTime || 0;
    const dur = this.audio.duration || this.currentTrack?.duration || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;

    // Desktop
    const dFill = document.getElementById('player-progress-fill');
    const dCur = document.getElementById('player-current-time');
    const dDur = document.getElementById('player-duration');
    if (dFill) dFill.style.width = `${pct}%`;
    if (dCur) dCur.textContent = this.formatTime(cur);
    if (dDur) dDur.textContent = this.formatTime(dur);

    // Mobile mini-player progress line
    const mFill = document.getElementById('mini-progress-fill');
    if (mFill) mFill.style.width = `${pct}%`;

    // Mobile Fullscreen
    const fsFill = document.getElementById('fs-progress-fill');
    const fsCur = document.getElementById('fs-current-time');
    const fsDur = document.getElementById('fs-duration');
    if (fsFill) fsFill.style.width = `${pct}%`;
    if (fsCur) fsCur.textContent = this.formatTime(cur);
    if (fsDur) fsDur.textContent = this.formatTime(dur);

    // Position State in MediaSession
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && dur > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: this.audio.playbackRate,
          position: cur
        });
      } catch (e) {
        // Ignore minor out-of-range sync errors
      }
    }
  }

  updateVolumeUI() {
    const vFill = document.getElementById('volume-bar-fill');
    if (vFill) vFill.style.width = `${this.volume * 100}%`;
  }

  updateControlButtonsUI() {
    const shuffleBtns = [
      document.getElementById('player-shuffle-btn'),
      document.getElementById('fs-shuffle-btn')
    ];
    shuffleBtns.forEach(btn => {
      if (btn) btn.classList.toggle('active', this.isShuffle);
    });

    const repeatBtns = [
      document.getElementById('player-repeat-btn'),
      document.getElementById('fs-repeat-btn')
    ];
    repeatBtns.forEach(btn => {
      if (btn) {
        btn.classList.toggle('active', this.repeatMode !== 'off');
        btn.title = `Повтор: ${this.repeatMode}`;
      }
    });
  }
}

window.Player = new PlayerEngine();
