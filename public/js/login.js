const errorMessage = document.getElementById('errorMessage');
const loginButton = document.getElementById('loginButton');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

// Apply saved theme preference
const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme === 'dark') {
  document.body.classList.add('dark-mode');
}

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
