// SpotLocal API Client
const API = {
  async req(endpoint, options = {}) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(error.detail || 'API request failed');
      }
      return await res.json();
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  getTracks(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.req(`/api/tracks?${q}`);
  },

  getTrack(id) {
    return this.req(`/api/tracks/${id}`);
  },

  toggleFavorite(id) {
    return this.req(`/api/tracks/${id}/favorite`, { method: 'POST' });
  },

  recordPlay(id) {
    return this.req(`/api/tracks/${id}/play`, { method: 'POST' });
  },

  getArtists() {
    return this.req('/api/artists');
  },

  getAlbums() {
    return this.req('/api/albums');
  },

  getPlaylists() {
    return this.req('/api/playlists');
  },

  createPlaylist(name, description = '') {
    return this.req('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description })
    });
  },

  deletePlaylist(id) {
    return this.req(`/api/playlists/${id}`, { method: 'DELETE' });
  },

  getPlaylist(id) {
    return this.req(`/api/playlists/${id}`);
  },

  addToPlaylist(playlistId, trackId) {
    return this.req(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ track_id: trackId })
    });
  },

  removeFromPlaylist(playlistId, trackId) {
    return this.req(`/api/playlists/${playlistId}/tracks/${trackId}`, {
      method: 'DELETE'
    });
  },

  rescanLibrary() {
    return this.req('/api/library/rescan', { method: 'POST' });
  },

  getStats() {
    return this.req('/api/library/stats');
  },

  startDownload(query) {
    return this.req('/api/download', {
      method: 'POST',
      body: JSON.stringify({ query })
    });
  },

  getDownloadStatus() {
    return this.req('/api/download/status');
  },

  connectSSE(onEvent, onError) {
    const evtSource = new EventSource('/api/download/events');
    evtSource.addEventListener('job_started', (e) => onEvent('job_started', JSON.parse(e.data)));
    evtSource.addEventListener('job_log', (e) => onEvent('job_log', JSON.parse(e.data)));
    evtSource.addEventListener('job_completed', (e) => onEvent('job_completed', JSON.parse(e.data)));
    evtSource.addEventListener('job_error', (e) => onEvent('job_error', JSON.parse(e.data)));
    evtSource.onerror = (e) => {
      if (onError) onError(e);
    };
    return evtSource;
  }
};
