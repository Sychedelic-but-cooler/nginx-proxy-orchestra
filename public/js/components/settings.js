async function loadErrorPagesSection(settings) {
  const card = document.getElementById('errorPagesCard');
  if (!card) return;

  card.innerHTML = `<div class="loading">Loading error pages...</div>`;
  try {
    const resp = await import('../api-error-pages.js').then(m => m.getErrorPages());
    const pages = resp.pages || {};
    const allowed = resp.allowed || ['404', '502', '503'];

    card.innerHTML = `
      <h2>Custom Error Pages</h2>
      <p class="form-help">Upload custom HTML for common error responses. These are served globally (default catch-all) and can be wired into proxy templates.</p>
      <div class="error-pages-grid">
        ${allowed.map(code => renderErrorPagePanel(code, pages[code])).join('')}
      </div>
    `;

    allowed.forEach(code => {
      const form = card.querySelector(`#errorForm_${code}`);
      if (!form) return;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textarea = form.querySelector('textarea');
        const html = textarea.value;
        if (!html.trim()) {
          alert('HTML content cannot be empty');
          return;
        }
        try {
          await import('../api-error-pages.js').then(m => m.saveErrorPage(code, html));
          showSuccess(`Saved custom ${code} page`);
        } catch (err) {
          showError(err.message || `Failed to save ${code} page`);
        }
      });
    });
  } catch (error) {
    card.innerHTML = `<div class="error">Failed to load error pages</div>`;
  }
}

function renderErrorPagePanel(code, page) {
  const content = page && page.content ? page.content : '';
  return `
    <div class="error-page-panel">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="badge">${code}</span>
        <strong>Custom ${code} Page</strong>
      </div>
      <form id="errorForm_${code}" class="error-form">
        <textarea rows="6" placeholder="Paste custom HTML for ${code}">${content || ''}</textarea>
        <div class="form-actions" style="margin-top:8px; display:flex; justify-content: flex-end; gap:8px;">
          <button type="submit" class="btn btn-primary">Save ${code}</button>
        </div>
      </form>
    </div>
  `;
}
