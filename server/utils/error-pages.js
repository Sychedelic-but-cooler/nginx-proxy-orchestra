const fs = require('fs');
const path = require('path');

const ALLOWED_CODES = ['404', '502', '503'];

function getErrorPagesDir() {
  return path.join(__dirname, '../../data/error-pages');
}

function ensureErrorPagesDir() {
  const dir = getErrorPagesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  return dir;
}

function getErrorPagePath(code) {
  if (!ALLOWED_CODES.includes(code)) {
    throw new Error('Unsupported error code');
  }
  return path.join(getErrorPagesDir(), `${code}.html`);
}

function defaultContent(code) {
  if (code === '404') {
    return '<!DOCTYPE html><html><head><title>Not Found</title></head><body><h1>404 - Not Found</h1><p>The requested resource could not be found.</p></body></html>';
  }
  if (code === '502') {
    return '<!DOCTYPE html><html><head><title>Bad Gateway</title></head><body><h1>502 - Bad Gateway</h1><p>The upstream server encountered an error.</p></body></html>';
  }
  if (code === '503') {
    return '<!DOCTYPE html><html><head><title>Service Unavailable</title></head><body><h1>503 - Service Unavailable</h1><p>The service is temporarily unavailable. Please try again later.</p></body></html>';
  }
  return '';
}

function ensureDefaultErrorPages() {
  ensureErrorPagesDir();
  for (const code of ALLOWED_CODES) {
    const filePath = getErrorPagePath(code);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent(code), { mode: 0o644 });
    }
  }
}

function getErrorPages(includeContent = true) {
  ensureDefaultErrorPages();
  const pages = {};
  for (const code of ALLOWED_CODES) {
    const filePath = getErrorPagePath(code);
    const exists = fs.existsSync(filePath);
    const content = exists && includeContent ? fs.readFileSync(filePath, 'utf-8') : null;
    pages[code] = { code, exists, content };
  }
  return pages;
}

function setErrorPage(code, html) {
  if (!ALLOWED_CODES.includes(code)) {
    throw new Error('Unsupported error code');
  }
  ensureErrorPagesDir();
  fs.writeFileSync(getErrorPagePath(code), html, { mode: 0o644 });
  return true;
}

function deleteErrorPage(code) {
  if (!ALLOWED_CODES.includes(code)) {
    throw new Error('Unsupported error code');
  }
  const filePath = getErrorPagePath(code);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  // Recreate default after deletion to ensure availability
  fs.writeFileSync(filePath, defaultContent(code), { mode: 0o644 });
  return true;
}

module.exports = {
  ALLOWED_CODES,
  getErrorPagesDir,
  ensureErrorPagesDir,
  ensureDefaultErrorPages,
  getErrorPages,
  setErrorPage,
  deleteErrorPage
};
