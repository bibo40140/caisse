(() => {
  async function get() {
    try {
      if (window.electronAPI?.getConfig) {
        const cfg = await window.electronAPI.getConfig();
        const url = cfg?.api_base_url || cfg?.apiBaseUrl || cfg?.apiBase;
        if (url && typeof url === 'string') return url.replace(/\/+$/, '');
      }
    } catch {}
    try {
      if (window.ApiClient?.getBase) {
        const u = window.ApiClient.getBase();
        if (u) return String(u).replace(/\/+$/, '');
      }
    } catch {}
    try {
      const u = localStorage.getItem('api_base_url') || localStorage.getItem('API_BASE_URL');
      if (u) return String(u).replace(/\/+$/, '');
    } catch {}
    try {
      if (location?.origin && /^https?:/i.test(location.origin)) {
        return location.origin.replace(/\/+$/, '');
      }
    } catch {}
    return '';
  }
  window.ApiBase = { get };
})();