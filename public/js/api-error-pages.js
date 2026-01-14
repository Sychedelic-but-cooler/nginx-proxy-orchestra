import api from './api.js';

export async function getErrorPages() {
  return api.request('/api/settings/error-pages', { method: 'GET' });
}

export async function saveErrorPage(code, html) {
  return api.request('/api/settings/error-pages', {
    method: 'PUT',
    body: { code, html }
  });
}
