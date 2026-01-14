const errorMessage = document.getElementById('errorMessage');
const loginButton = document.getElementById('loginButton');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

// Apply saved theme preference
const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme === 'dark') {
  document.body.classList.add('dark-mode');
}

let failedLoginAttempts = 0;
let tempToken = null;
let currentUsername = null;

// Handle login
async function performLogin() {
  // Disable button to prevent double submission
  loginButton.disabled = true;
  loginButton.textContent = 'Logging in...';

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    errorMessage.textContent = 'Username and password are required';
    errorMessage.style.display = 'block';
    loginButton.disabled = false;
    loginButton.textContent = 'Login';
    return;
  }

  errorMessage.style.display = 'none';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ username, password }),
      credentials: 'same-origin',
      redirect: 'manual'
    });

    const data = await response.json();

    if (response.ok) {
      // Check if TOTP is required
      if (data.requiresTOTP) {
        tempToken = data.tempToken;
        currentUsername = username;
        showTOTPInput();
        return;
      }
      
      // Store JWT token in localStorage
      if (data.token) {
        localStorage.setItem('auth_token', data.token);
      }
      
      // Clear form fields immediately for security
      usernameInput.value = '';
      passwordInput.value = '';
      
      // Redirect to app
      window.location.replace('/app');
    } else {
      // Track failed attempts
      if (data.failedAttempts) {
        failedLoginAttempts = data.failedAttempts;
        if (failedLoginAttempts >= 3) {
          showRecoveryOption();
        }
      }
      
      errorMessage.textContent = data.error || 'Login failed';
      errorMessage.style.display = 'block';
      loginButton.disabled = false;
      loginButton.textContent = 'Login';
    }
  } catch (error) {
    errorMessage.textContent = 'Connection error. Please try again.';
    errorMessage.style.display = 'block';
    loginButton.disabled = false;
    loginButton.textContent = 'Login';
  }
}

// Show TOTP input form
function showTOTPInput() {
  const formContainer = document.querySelector('.login-card form');
  formContainer.innerHTML = `
    <h2 style="text-align: center; margin-bottom: 20px;">Two-Factor Authentication</h2>
    <p style="text-align: center; margin-bottom: 30px; color: #666;">Enter the 6-digit code from your authenticator app</p>
    
    <div style="margin-bottom: 20px;">
      <input type="text" id="totpCode" placeholder="000000" maxlength="6" pattern="[0-9]{6}" 
             style="text-align: center; font-size: 32px; letter-spacing: 12px; width: 100%; padding: 15px;"
             autocomplete="off" autofocus>
    </div>
    
    <div id="totpError" style="display: none; background-color: #fee; color: #c33; padding: 12px; border-radius: 4px; margin-bottom: 20px; text-align: center;"></div>
    
    <button type="button" id="verifyTOTPButton" style="width: 100%; padding: 12px; margin-bottom: 10px;">Verify</button>
    <button type="button" id="cancelTOTPButton" style="width: 100%; padding: 12px; background: #6c757d; border: none;">Back to Login</button>
  `;
  
  const totpCodeInput = document.getElementById('totpCode');
  const verifyButton = document.getElementById('verifyTOTPButton');
  const cancelButton = document.getElementById('cancelTOTPButton');
  const totpError = document.getElementById('totpError');
  
  cancelButton.addEventListener('click', () => {
    location.reload();
  });
  
  async function verifyTOTP() {
    const code = totpCodeInput.value.trim();
    
    if (!/^\d{6}$/.test(code)) {
      totpError.textContent = 'Please enter a valid 6-digit code';
      totpError.style.display = 'block';
      return;
    }
    
    verifyButton.disabled = true;
    verifyButton.textContent = 'Verifying...';
    totpError.style.display = 'none';
    
    try {
      const response = await fetch('/api/login/totp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tempToken, code })
      });
      
      const data = await response.json();
      
      if (response.ok && data.token) {
        localStorage.setItem('auth_token', data.token);
        window.location.replace('/app');
      } else {
        // Track failed attempts
        if (data.failedAttempts) {
          failedLoginAttempts = data.failedAttempts;
          if (failedLoginAttempts >= 3) {
            showRecoveryOption();
            return;
          }
        }
        
        totpError.textContent = data.error || 'Invalid code';
        totpError.style.display = 'block';
        verifyButton.disabled = false;
        verifyButton.textContent = 'Verify';
        totpCodeInput.value = '';
        totpCodeInput.focus();
      }
    } catch (error) {
      totpError.textContent = 'Connection error. Please try again.';
      totpError.style.display = 'block';
      verifyButton.disabled = false;
      verifyButton.textContent = 'Verify';
    }
  }
  
  verifyButton.addEventListener('click', verifyTOTP);
  
  totpCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      verifyTOTP();
    }
  });
  
  // Auto-submit when 6 digits entered
  totpCodeInput.addEventListener('input', (e) => {
    if (e.target.value.length === 6) {
      verifyTOTP();
    }
  });
}

// Show recovery key option
function showRecoveryOption() {
  const formContainer = document.querySelector('.login-card form');
  const existingRecoveryBtn = document.getElementById('useRecoveryButton');
  
  if (existingRecoveryBtn) return; // Already shown
  
  const recoveryButton = document.createElement('button');
  recoveryButton.type = 'button';
  recoveryButton.id = 'useRecoveryButton';
  recoveryButton.textContent = 'Use Recovery Key Instead';
  recoveryButton.style.cssText = 'width: 100%; padding: 12px; margin-top: 10px; background: #ffc107; color: #000; border: none; border-radius: 4px; cursor: pointer;';
  
  formContainer.appendChild(recoveryButton);
  
  recoveryButton.addEventListener('click', showRecoveryForm);
}

// Show recovery key form
function showRecoveryForm() {
  const formContainer = document.querySelector('.login-card form');
  formContainer.innerHTML = `
    <h2 style="text-align: center; margin-bottom: 20px;">Account Recovery</h2>
    <p style="text-align: center; margin-bottom: 30px; color: #666;">Enter your 128-character recovery key</p>
    
    <div style="margin-bottom: 20px;">
      <label for="recoveryUsername" style="display: block; margin-bottom: 8px; font-weight: 500;">Username</label>
      <input type="text" id="recoveryUsername" value="${currentUsername || ''}" style="width: 100%; padding: 10px;">
    </div>
    
    <div style="margin-bottom: 20px;">
      <label for="recoveryKey" style="display: block; margin-bottom: 8px; font-weight: 500;">Recovery Key</label>
      <textarea id="recoveryKey" rows="4" placeholder="Paste your 128-character recovery key here" 
                style="width: 100%; padding: 10px; font-family: monospace; font-size: 12px;"></textarea>
    </div>
    
    <div id="recoveryError" style="display: none; background-color: #fee; color: #c33; padding: 12px; border-radius: 4px; margin-bottom: 20px; text-align: center;"></div>
    
    <button type="button" id="submitRecoveryButton" style="width: 100%; padding: 12px; margin-bottom: 10px;">Recover Account</button>
    <button type="button" id="cancelRecoveryButton" style="width: 100%; padding: 12px; background: #6c757d; border: none;">Back to Login</button>
  `;
  
  const usernameInput = document.getElementById('recoveryUsername');
  const recoveryKeyInput = document.getElementById('recoveryKey');
  const submitButton = document.getElementById('submitRecoveryButton');
  const cancelButton = document.getElementById('cancelRecoveryButton');
  const recoveryError = document.getElementById('recoveryError');
  
  cancelButton.addEventListener('click', () => {
    location.reload();
  });
  
  async function submitRecovery() {
    const username = usernameInput.value.trim();
    const recoveryKey = recoveryKeyInput.value.trim();
    
    if (!username || !recoveryKey) {
      recoveryError.textContent = 'Username and recovery key are required';
      recoveryError.style.display = 'block';
      return;
    }
    
    if (!/^[0-9a-f]{128}$/i.test(recoveryKey)) {
      recoveryError.textContent = 'Invalid recovery key format (must be 128 hexadecimal characters)';
      recoveryError.style.display = 'block';
      return;
    }
    
    submitButton.disabled = true;
    submitButton.textContent = 'Recovering...';
    recoveryError.style.display = 'none';
    
    try {
      const response = await fetch('/api/login/recovery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, recoveryKey })
      });
      
      const data = await response.json();
      
      if (response.ok && data.token) {
        localStorage.setItem('auth_token', data.token);
        alert(data.message || 'Login successful with recovery key');
        window.location.replace('/app');
      } else {
        recoveryError.textContent = data.error || 'Recovery failed';
        recoveryError.style.display = 'block';
        submitButton.disabled = false;
        submitButton.textContent = 'Recover Account';
      }
    } catch (error) {
      recoveryError.textContent = 'Connection error. Please try again.';
      recoveryError.style.display = 'block';
      submitButton.disabled = false;
      submitButton.textContent = 'Recover Account';
    }
  }
  
  submitButton.addEventListener('click', submitRecovery);
}

// Button click handler
if (loginButton) {
  loginButton.addEventListener('click', function(e) {
    performLogin();
  });
}

// Allow Enter key in password field
if (passwordInput) {
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performLogin();
    }
  });
}

// Allow Enter key in username field
if (usernameInput) {
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performLogin();
    }
  });
}
