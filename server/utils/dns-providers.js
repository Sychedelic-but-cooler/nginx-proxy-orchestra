const fs = require('fs');
const path = require('path');
const { encryptCredentials, decryptCredentials } = require('./credential-encryption');

/**
 * DNS Provider Abstraction Layer
 *
 * Supports multiple DNS providers for DNS-01 ACME challenges
 * Each provider has specific credential requirements and certbot plugins
 */

/**
 * Get certbot credentials directory
 * Uses CERTBOT_CREDENTIALS_DIR environment variable or defaults to data/certbot-credentials
 */
function getCertbotCredentialsDir() {
  if (process.env.CERTBOT_CREDENTIALS_DIR) {
    return process.env.CERTBOT_CREDENTIALS_DIR;
  }
  // Default to data/certbot-credentials in project root
  return path.join(__dirname, '../../data/certbot-credentials');
}

// Directory for storing certbot credentials
const CERTBOT_CREDENTIALS_DIR = getCertbotCredentialsDir();

/**
 * DNS Provider Definitions
 *
 * Each provider includes:
 * - id: Unique identifier
 * - name: Display name
 * - plugin: Certbot plugin name
 * - installCommand: Rocky Linux 9 installation command
 * - fields: Required credential fields
 * - credentialFileFormat: Function to generate credential file content
 * - getCertbotArgs: Function to generate certbot command arguments
 */

const DNS_PROVIDERS = {
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare',
    plugin: 'dns-cloudflare',
    installCommand: 'dnf install -y python3-certbot-dns-cloudflare',
    docsUrl: 'https://certbot-dns-cloudflare.readthedocs.io/',
    fields: [
      {
        name: 'api_token',
        label: 'API Token',
        type: 'password',
        required: true,
        help: 'Cloudflare API Token with Zone:DNS:Edit permissions'
      },
      {
        name: 'email',
        label: 'Cloudflare Account Email',
        type: 'email',
        required: false,
        help: 'Optional: Used with Global API Key (legacy)'
      },
      {
        name: 'api_key',
        label: 'Global API Key',
        type: 'password',
        required: false,
        help: 'Optional: Legacy authentication method'
      }
    ],
    credentialFileFormat: (credentials) => {
      // Prefer API Token (recommended), fallback to email + api_key (legacy)
      if (credentials.api_token) {
        return `dns_cloudflare_api_token = ${credentials.api_token}\n`;
      } else if (credentials.email && credentials.api_key) {
        return `dns_cloudflare_email = ${credentials.email}\ndns_cloudflare_api_key = ${credentials.api_key}\n`;
      } else {
        throw new Error('Cloudflare requires either api_token or (email + api_key)');
      }
    },
    getCertbotArgs: (credentialPath, propagationSeconds) => [
      '-a', 'dns-cloudflare',
      `--dns-cloudflare-credentials`, credentialPath,
      `--dns-cloudflare-propagation-seconds`, propagationSeconds.toString()
    ]
  },

  route53: {
    id: 'route53',
    name: 'AWS Route53',
    plugin: 'dns-route53',
    installCommand: 'dnf install -y python3-certbot-dns-route53',
    docsUrl: 'https://certbot-dns-route53.readthedocs.io/',
    fields: [
      {
        name: 'aws_access_key_id',
        label: 'AWS Access Key ID',
        type: 'text',
        required: true,
        help: 'AWS IAM access key with Route53 permissions'
      },
      {
        name: 'aws_secret_access_key',
        label: 'AWS Secret Access Key',
        type: 'password',
        required: true,
        help: 'AWS IAM secret key'
      },
      {
        name: 'aws_region',
        label: 'AWS Region',
        type: 'text',
        required: false,
        help: 'Optional: AWS region (default: us-east-1)'
      }
    ],
    credentialFileFormat: (credentials) => {
      let content = `[default]\naws_access_key_id=${credentials.aws_access_key_id}\naws_secret_access_key=${credentials.aws_secret_access_key}\n`;
      if (credentials.aws_region) {
        content += `region=${credentials.aws_region}\n`;
      }
      return content;
    },
    getCertbotArgs: (credentialPath, propagationSeconds) => [
      '-a', 'dns-route53',
      `--dns-route53-propagation-seconds`, propagationSeconds.toString()
      // Note: Route53 plugin looks for credentials in ~/.aws/credentials or environment variables
      // We set AWS_SHARED_CREDENTIALS_FILE environment variable when executing
    ]
  },

  google: {
    id: 'google',
    name: 'Google Cloud DNS',
    plugin: 'dns-google',
    installCommand: 'dnf install -y python3-certbot-dns-google',
    docsUrl: 'https://certbot-dns-google.readthedocs.io/',
    fields: [
      {
        name: 'service_account_json',
        label: 'Service Account JSON',
        type: 'textarea',
        required: true,
        help: 'Full JSON content of GCP service account key file'
      },
      {
        name: 'project_id',
        label: 'GCP Project ID',
        type: 'text',
        required: true,
        help: 'Google Cloud project ID'
      }
    ],
    credentialFileFormat: (credentials) => {
      // Google uses the raw JSON service account file
      return credentials.service_account_json;
    },
    getCertbotArgs: (credentialPath, propagationSeconds) => [
      '-a', 'dns-google',
      '--dns-google-credentials', credentialPath,
      '--dns-google-propagation-seconds', propagationSeconds.toString()
    ]
  },

  digitalocean: {
    id: 'digitalocean',
    name: 'DigitalOcean',
    plugin: 'dns-digitalocean',
    installCommand: 'dnf install -y python3-certbot-dns-digitalocean',
    docsUrl: 'https://certbot-dns-digitalocean.readthedocs.io/',
    fields: [
      {
        name: 'api_token',
        label: 'API Token',
        type: 'password',
        required: true,
        help: 'DigitalOcean API token with read/write access'
      }
    ],
    credentialFileFormat: (credentials) => {
      return `dns_digitalocean_token = ${credentials.api_token}\n`;
    },
    getCertbotArgs: (credentialPath, propagationSeconds) => [
      '-a', 'dns-digitalocean',
      '--dns-digitalocean-credentials', credentialPath,
      '--dns-digitalocean-propagation-seconds', propagationSeconds.toString()
    ]
  },

  azure: {
    id: 'azure',
    name: 'Azure DNS',
    plugin: 'dns-azure',
    installCommand: 'dnf install -y python3-certbot-dns-azure',
    docsUrl: 'https://certbot-dns-azure.readthedocs.io/',
    fields: [
      {
        name: 'client_id',
        label: 'Client ID',
        type: 'text',
        required: true,
        help: 'Azure application (client) ID'
      },
      {
        name: 'client_secret',
        label: 'Client Secret',
        type: 'password',
        required: true,
        help: 'Azure client secret'
      },
      {
        name: 'tenant_id',
        label: 'Tenant ID',
        type: 'text',
        required: true,
        help: 'Azure tenant (directory) ID'
      },
      {
        name: 'subscription_id',
        label: 'Subscription ID',
        type: 'text',
        required: true,
        help: 'Azure subscription ID'
      },
      {
        name: 'resource_group',
        label: 'Resource Group',
        type: 'text',
        required: true,
        help: 'Azure DNS zone resource group'
      }
    ],
    credentialFileFormat: (credentials) => {
      return `dns_azure_sp_client_id = ${credentials.client_id}
dns_azure_sp_client_secret = ${credentials.client_secret}
dns_azure_tenant_id = ${credentials.tenant_id}
dns_azure_subscription_id = ${credentials.subscription_id}
dns_azure_resource_group = ${credentials.resource_group}
`;
    },
    getCertbotArgs: (credentialPath, propagationSeconds) => [
      '-a', 'dns-azure',
      '--dns-azure-credentials', credentialPath,
      '--dns-azure-propagation-seconds', propagationSeconds.toString()
    ]
  }
};

/**
 * Get list of all supported providers
 * @returns {Array} Array of provider metadata (without sensitive functions)
 */
function getProviders() {
  return Object.values(DNS_PROVIDERS).map(provider => ({
    id: provider.id,
    name: provider.name,
    plugin: provider.plugin,
    installCommand: provider.installCommand,
    docsUrl: provider.docsUrl,
    fields: provider.fields
  }));
}

/**
 * Get specific provider by ID
 * @param {String} providerId - Provider ID (e.g., 'cloudflare')
 * @returns {Object} Provider definition or null
 */
function getProvider(providerId) {
  return DNS_PROVIDERS[providerId] || null;
}

/**
 * Validate provider credentials
 * @param {String} providerId - Provider ID
 * @param {Object} credentials - Credentials object
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateCredentials(providerId, credentials) {
  const provider = getProvider(providerId);
  if (!provider) {
    return { valid: false, errors: ['Invalid provider'] };
  }

  const errors = [];
  const requiredFields = provider.fields.filter(f => f.required);

  for (const field of requiredFields) {
    if (!credentials[field.name] || credentials[field.name].trim() === '') {
      errors.push(`${field.label} is required`);
    }
  }

  // Special validation for Cloudflare (needs token OR email+key)
  if (providerId === 'cloudflare') {
    const hasToken = credentials.api_token && credentials.api_token.trim();
    const hasEmailKey = credentials.email && credentials.api_key &&
                        credentials.email.trim() && credentials.api_key.trim();

    if (!hasToken && !hasEmailKey) {
      errors.push('Either API Token or (Email + API Key) is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create credential file for certbot
 * @param {String} providerId - Provider ID
 * @param {Object} credentials - Decrypted credentials object
 * @param {String} credentialName - Name for the credential file
 * @returns {String} Path to created credential file
 */
function createCredentialFile(providerId, credentials, credentialName) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Ensure credentials directory exists
  if (!fs.existsSync(CERTBOT_CREDENTIALS_DIR)) {
    fs.mkdirSync(CERTBOT_CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }

  // Generate credential file content
  const content = provider.credentialFileFormat(credentials);

  // Determine file extension
  const extension = providerId === 'google' ? '.json' : '.ini';
  const filename = `${credentialName}-${providerId}${extension}`;
  const filePath = path.join(CERTBOT_CREDENTIALS_DIR, filename);

  // Write credential file with restrictive permissions
  fs.writeFileSync(filePath, content, { mode: 0o600 });

  return filePath;
}

/**
 * Delete credential file
 * @param {String} filePath - Path to credential file
 */
function deleteCredentialFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Build certbot command arguments for DNS challenge
 * @param {String} providerId - Provider ID
 * @param {String} credentialPath - Path to credential file
 * @param {Number} propagationSeconds - DNS propagation delay (10-120)
 * @param {String} email - Contact email for Let's Encrypt
 * @param {Array} domains - Array of domains to certify
 * @param {Object} certbotDirs - Certbot directory paths
 * @param {Boolean} dryRun - Test mode using staging server (optional)
 * @returns {Array} Array of certbot command arguments
 */
function buildCertbotCommand(providerId, credentialPath, propagationSeconds, email, domains, certbotDirs, dryRun = false) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Validate propagation seconds
  const propSeconds = Math.max(10, Math.min(120, parseInt(propagationSeconds) || 10));

  // Base certbot arguments
  const args = [
    'certonly',
    '--non-interactive',
    '--agree-tos',
    `--email=${email}`,
    '--preferred-challenges=dns'
  ];

  // Add directory arguments if provided
  if (certbotDirs) {
    args.push(
      `--config-dir=${certbotDirs.configDir}`,
      `--work-dir=${certbotDirs.workDir}`,
      `--logs-dir=${certbotDirs.logsDir}`
    );
  }

  // Add dry-run/staging flags if requested
  if (dryRun) {
    args.push('--dry-run', '--staging');
  }

  // Add provider-specific arguments
  const providerArgs = provider.getCertbotArgs(credentialPath, propSeconds);
  args.push(...providerArgs);

  // Add domains
  for (const domain of domains) {
    args.push('-d', domain.trim());
  }

  return args;
}

/**
 * Get installation instructions for a provider
 * @param {String} providerId - Provider ID
 * @returns {Object} Installation instructions
 */
function getInstallationInstructions(providerId) {
  const provider = getProvider(providerId);
  if (!provider) {
    return null;
  }

  return {
    provider: provider.name,
    plugin: provider.plugin,
    command: provider.installCommand,
    docsUrl: provider.docsUrl,
    instructions: [
      `Install the ${provider.name} DNS plugin for Certbot:`,
      `  ${provider.installCommand}`,
      '',
      'This plugin allows Certbot to automatically configure DNS records',
      `for domain validation. See ${provider.docsUrl} for more details.`
    ].join('\n')
  };
}

/**
 * Check if provider plugin is installed
 * @param {String} providerId - Provider ID
 * @returns {Promise<Boolean>} True if installed
 */
async function isProviderInstalled(providerId) {
  const { execSync } = require('child_process');
  const provider = getProvider(providerId);

  if (!provider) {
    return false;
  }

  try {
    // Try to get certbot plugin list
    const output = execSync('certbot plugins --prepare', { encoding: 'utf8', stdio: 'pipe' });
    return output.includes(provider.plugin);
  } catch (error) {
    return false;
  }
}

module.exports = {
  DNS_PROVIDERS,
  CERTBOT_CREDENTIALS_DIR,
  getProviders,
  getProvider,
  validateCredentials,
  createCredentialFile,
  deleteCredentialFile,
  buildCertbotCommand,
  getInstallationInstructions,
  isProviderInstalled
};
