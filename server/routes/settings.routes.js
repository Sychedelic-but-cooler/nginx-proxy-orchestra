/**
 * Get custom error pages
 */
function handleGetErrorPages(req, res) {
  try {
    const pages = getErrorPages(false);
    sendJSON(res, { success: true, pages, allowed: ALLOWED_CODES });
  } catch (error) {
    console.error('Get error pages error:', error);
    sendJSON(res, { error: error.message || 'Failed to get error pages' }, 500);
  }
}

/**
 * Update (upload) a custom error page
 */
async function handleUpdateErrorPage(req, res) {
  try {
    const body = await parseBody(req);
    const { code, html } = body;

    if (!code || !html) {
      return sendJSON(res, { error: 'code and html are required' }, 400);
    }
    if (!ALLOWED_CODES.includes(String(code))) {
      return sendJSON(res, { error: 'Unsupported error code' }, 400);
    }

    setErrorPage(String(code), html);
    ensureDefaultErrorPages();

    logAudit(req.user.userId, 'update_error_page', 'settings', null, JSON.stringify({ code }), getClientIP(req));

    // Reload nginx so new page takes effect in default server and templates
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: `Custom ${code} page saved` });
  } catch (error) {
    console.error('Update error page error:', error);
    sendJSON(res, { error: error.message || 'Failed to update error page' }, 500);
  }
}
