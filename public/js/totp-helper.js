/**
 * Helper function to prompt for TOTP code when performing security-critical operations
 * 
 * @param {string} message - Custom message to display in the prompt
 * @returns {Promise<string|null>} - Returns the TOTP code or null if cancelled
 */
async function promptForTOTP(message = 'This operation requires 2FA verification.') {
  return new Promise((resolve) => {
    const modalHTML = `
      <div class="modal-overlay" id="totpPromptModal">
        <div class="modal modal-sm">
          <div class="modal-header">
            <h3>2FA Verification Required</h3>
            <button class="modal-close" id="closeTOTPPrompt">&times;</button>
          </div>
          <div class="modal-body">
            <p>${message}</p>
            <div class="form-group" style="margin-top: 20px;">
              <label>Authenticator Code</label>
              <input type="text" id="totpPromptCode" placeholder="000000" maxlength="6" pattern="[0-9]{6}" 
                     style="text-align: center; font-size: 24px; letter-spacing: 8px; width: 100%;" autofocus>
            </div>
            <div id="totpPromptError" style="color: var(--danger-color); margin-top: 10px; display: none;"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancelTOTPPrompt">Cancel</button>
            <button type="button" class="btn btn-primary" id="submitTOTPPrompt">Verify</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modalContainer').innerHTML = modalHTML;

    const codeInput = document.getElementById('totpPromptCode');
    const errorDiv = document.getElementById('totpPromptError');
    const submitBtn = document.getElementById('submitTOTPPrompt');

    const cleanup = () => {
      document.getElementById('totpPromptModal')?.remove();
    };

    const submit = () => {
      const code = codeInput.value.trim();
      
      if (!/^\d{6}$/.test(code)) {
        errorDiv.textContent = 'Please enter a valid 6-digit code';
        errorDiv.style.display = 'block';
        return;
      }

      cleanup();
      resolve(code);
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    document.getElementById('closeTOTPPrompt').addEventListener('click', cancel);
    document.getElementById('cancelTOTPPrompt').addEventListener('click', cancel);
    document.getElementById('submitTOTPPrompt').addEventListener('click', submit);
    
    codeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    // Auto-submit when 6 digits entered
    codeInput.addEventListener('input', (e) => {
      if (e.target.value.length === 6) {
        submit();
      }
    });
  });
}

/**
 * Wrapper for API calls that may require TOTP verification
 * Automatically prompts for TOTP if the API returns requires2FA
 * 
 * @param {Function} apiCall - Function that makes the API call, receives totpCode as parameter
 * @param {string} promptMessage - Custom message for TOTP prompt
 * @returns {Promise<any>} - Result of the API call
 */
async function withTOTPVerification(apiCall, promptMessage) {
  try {
    // Try the operation without TOTP first
    return await apiCall(null);
  } catch (error) {
    // Check if error response indicates 2FA is required
    if (error.response && error.response.requires2FA) {
      // Prompt for TOTP
      const totpCode = await promptForTOTP(promptMessage || error.response.message);
      
      if (!totpCode) {
        // User cancelled
        throw new Error('Operation cancelled');
      }

      // Retry with TOTP code
      return await apiCall(totpCode);
    }

    // Not a 2FA error, rethrow
    throw error;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { promptForTOTP, withTOTPVerification };
}
