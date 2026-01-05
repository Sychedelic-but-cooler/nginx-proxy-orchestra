// Debug logging
console.log('Login script loaded');

const errorMessage = document.getElementById('errorMessage');
const loginButton = document.getElementById('loginButton');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

console.log('Elements found:', {
  errorMessage: !!errorMessage,
  loginButton: !!loginButton,
  usernameInput: !!usernameInput,
  passwordInput: !!passwordInput
});

// Handle login
async function performLogin() {
  console.log('performLogin called');
  
  // Disable button to prevent double submission
  loginButton.disabled = true;
  loginButton.textContent = 'Logging in...';
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  console.log('Username length:', username.length);

  if (!username || !password) {
    errorMessage.textContent = 'Username and password are required';
    errorMessage.style.display = 'block';
    loginButton.disabled = false;
    loginButton.textContent = 'Login';
    return;
  }

  errorMessage.style.display = 'none';

  try {
    console.log('Sending login request...');
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

    console.log('Response status:', response.status);
    const data = await response.json();

    if (response.ok) {
      console.log('Login successful');
      // Clear form fields immediately for security
      usernameInput.value = '';
      passwordInput.value = '';
      
      // Redirect to app
      window.location.replace('/app');
    } else {
      console.log('Login failed:', data.error);
      errorMessage.textContent = data.error || 'Login failed';
      errorMessage.style.display = 'block';
      loginButton.disabled = false;
      loginButton.textContent = 'Login';
    }
  } catch (error) {
    console.error('Login error:', error);
    errorMessage.textContent = 'Connection error. Please try again.';
    errorMessage.style.display = 'block';
    loginButton.disabled = false;
    loginButton.textContent = 'Login';
  }
}

// Button click handler
if (loginButton) {
  console.log('Adding click listener to button');
  loginButton.addEventListener('click', function(e) {
    console.log('Button clicked!');
    performLogin();
  });
} else {
  console.error('Login button not found!');
}

// Allow Enter key in password field
if (passwordInput) {
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      console.log('Enter pressed in password field');
      e.preventDefault();
      performLogin();
    }
  });
}

// Allow Enter key in username field
if (usernameInput) {
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      console.log('Enter pressed in username field');
      e.preventDefault();
      performLogin();
    }
  });
}
