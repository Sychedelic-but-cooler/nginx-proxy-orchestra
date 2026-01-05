import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

export async function renderModules(container) {
  showLoading();
  
  try {
    const modules = await api.getModules();
    
    if (modules.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No Modules</h2>
          <p>Create reusable configuration snippets</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="grid grid-2">
          ${modules.map(module => `
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">${module.name}</h3>
                <div class="action-buttons">
                  <button class="btn btn-sm btn-secondary edit-module" data-id="${module.id}">Edit</button>
                  <button class="btn btn-sm btn-danger delete-module" data-id="${module.id}">Delete</button>
                </div>
              </div>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">${module.description || 'No description'}</p>
              <pre style="background: var(--bg-color); padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto;"><code>${module.content}</code></pre>
              <small style="color: var(--text-secondary);">Created: ${new Date(module.created_at).toLocaleDateString()}</small>
            </div>
          `).join('')}
        </div>
      `;

      // Event listeners
      document.querySelectorAll('.edit-module').forEach(btn => {
        btn.addEventListener('click', () => showModuleForm(parseInt(btn.dataset.id), modules));
      });

      document.querySelectorAll('.delete-module').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteModule(parseInt(btn.dataset.id), container));
      });
    }

    // Add module button handler
    document.getElementById('addModuleBtn')?.addEventListener('click', () => showModuleForm());

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load modules</h2></div>';
  } finally {
    hideLoading();
  }
}

async function handleDeleteModule(id, container) {
  if (!confirm('Are you sure you want to delete this module?')) return;
  
  showLoading();
  try {
    await api.deleteModule(id);
    showSuccess('Module deleted successfully');
    await renderModules(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

function showModuleForm(id = null, modules = []) {
  const module = id ? modules.find(m => m.id === id) : null;
  
  const modal = document.getElementById('modalContainer');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>${id ? 'Edit' : 'Add'} Module</h3>
        </div>
        <form id="moduleForm">
          <div class="form-group">
            <label for="moduleName">Name *</label>
            <input type="text" id="moduleName" required value="${module?.name || ''}" placeholder="HSTS, Security Headers, etc.">
          </div>

          <div class="form-group">
            <label for="moduleDescription">Description</label>
            <input type="text" id="moduleDescription" value="${module?.description || ''}" placeholder="Brief description of what this module does">
          </div>

          <div class="form-group">
            <label for="moduleContent">Configuration Content *</label>
            <textarea id="moduleContent" required style="min-height: 200px; font-family: 'Courier New', monospace;">${module?.content || ''}</textarea>
            <small>Nginx configuration directives (without location or server blocks)</small>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Form submit handler
  document.getElementById('moduleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
      name: document.getElementById('moduleName').value,
      description: document.getElementById('moduleDescription').value,
      content: document.getElementById('moduleContent').value
    };

    showLoading();
    try {
      if (id) {
        await api.updateModule(id, data);
        showSuccess('Module updated successfully');
      } else {
        await api.createModule(data);
        showSuccess('Module created successfully');
      }
      modal.innerHTML = '';
      await renderModules(document.getElementById('mainContent'));
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });

  // Cancel button
  document.getElementById('cancelBtn').addEventListener('click', () => {
    modal.innerHTML = '';
  });
}
