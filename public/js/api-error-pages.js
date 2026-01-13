import api from './api.js';

export async function getErrorPages() {
  return api._fetch('/api/settings/error-pages', { method: 'GET' });
}

export async function saveErrorPage(code, html) {
  return api._fetch('/api/settings/error-pages', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, html })
  });
}
