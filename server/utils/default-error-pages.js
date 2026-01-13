const { ensureDefaultErrorPages, getErrorPagePath, ALLOWED_CODES } = require('./error-pages');

function renderErrorPageDirectives(baseIndent = '') {
  // Ensure defaults exist so nginx has files to serve
  ensureDefaultErrorPages();

  // Map error codes to file paths
  const paths = {};
  for (const code of ALLOWED_CODES) {
    paths[code] = getErrorPagePath(code);
  }

  let cfg = '';
  cfg += `${baseIndent}error_page 404 ${paths['404']};\n`;
  cfg += `${baseIndent}error_page 502 ${paths['502']};\n`;
  cfg += `${baseIndent}error_page 503 ${paths['503']};\n`;
  cfg += `${baseIndent}location = ${paths['404']} {\n`;
  cfg += `${baseIndent}    internal;\n`;
  cfg += `${baseIndent}}\n`;
  cfg += `${baseIndent}location = ${paths['502']} {\n`;
  cfg += `${baseIndent}    internal;\n`;
  cfg += `${baseIndent}}\n`;
  cfg += `${baseIndent}location = ${paths['503']} {\n`;
  cfg += `${baseIndent}    internal;\n`;
  cfg += `${baseIndent}}\n`;
  return cfg;
}

module.exports = { renderErrorPageDirectives };
