/**
 * Ban Provider Factory
 *
 * Loads and instantiates ban integration providers
 */

const BanProvider = require('./base-provider');

// Registry of available providers
const PROVIDERS = {
  'unifi': require('./unifi-provider'),
  'firewalld': require('./firewalld-provider'),
  'ufw': require('./ufw-provider'),
  'iptables': require('./iptables-provider'),
  // 'cloudflare': require('./cloudflare-provider'),
  // 'pfsense': require('./pfsense-provider'),
};

/**
 * Get provider instance for an integration
 * @param {object} integration - Integration record from database
 * @returns {BanProvider} Provider instance
 */
function getProvider(integration) {
  const ProviderClass = PROVIDERS[integration.type];

  if (!ProviderClass) {
    throw new Error(`Unknown integration type: ${integration.type}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  return new ProviderClass(integration);
}

/**
 * Get list of supported provider types
 * @returns {Array<string>} List of provider type IDs
 */
function getSupportedProviders() {
  return Object.keys(PROVIDERS);
}

/**
 * Get provider metadata/info
 * @param {string} type - Provider type ID
 * @returns {object} Provider info
 */
function getProviderInfo(type) {
  const providerInfo = {
    unifi: {
      id: 'unifi',
      name: 'UniFi (Ubiquiti)',
      description: 'Block IPs at UniFi gateway/firewall. Supports both Cloud and Local controllers.',
      requires_credential: true,
      credential_fields: [
        { key: 'api_url', label: 'API URL', placeholder: 'https://api.ui.com/v1 or https://controller-ip:8443', required: true },
        { key: 'api_key', label: 'API Key', placeholder: 'Your UniFi API key', required: true },
        { key: 'site_id', label: 'Site ID', placeholder: 'default or your site ID', required: true },
        { key: 'network_id', label: 'Network ID', placeholder: 'Required for cloud controller only', required: false }
      ],
      config_fields: [
        { key: 'rule_priority', label: 'Rule Priority', type: 'number', default: 1, min: 1, max: 1000 }
      ],
      supports_batch: true,
      docs_url: 'https://www.ubntwiki.com/products/software/unifi-controller/api'
    },
    cloudflare: {
      id: 'cloudflare',
      name: 'Cloudflare',
      description: 'Block IPs at CDN edge using Cloudflare API',
      requires_credential: true,
      credential_fields: ['email', 'api_key', 'zone_id'],
      config_fields: [],
      supports_batch: false,
      docs_url: 'https://api.cloudflare.com/'
    },
    pfsense: {
      id: 'pfsense',
      name: 'pfSense',
      description: 'Block IPs on pfSense firewall',
      requires_credential: true,
      credential_fields: ['api_url', 'api_key', 'api_secret'],
      config_fields: [
        { key: 'alias_name', label: 'Firewall Alias Name', type: 'text', default: 'WAF_BlockList' }
      ],
      supports_batch: true,
      docs_url: 'https://docs.netgate.com/pfsense/en/latest/api/'
    },
    opnsense: {
      id: 'opnsense',
      name: 'OPNsense',
      description: 'Block IPs on OPNsense firewall',
      requires_credential: true,
      credential_fields: ['api_url', 'api_key', 'api_secret'],
      config_fields: [
        { key: 'alias_name', label: 'Firewall Alias Name', type: 'text', default: 'WAF_BlockList' }
      ],
      supports_batch: true,
      docs_url: 'https://docs.opnsense.org/development/api.html'
    },
    firewalld: {
      id: 'firewalld',
      name: 'firewalld (RHEL/CentOS/Fedora)',
      description: 'Block IPs locally using firewalld rich rules (requires sudo)',
      requires_credential: false,
      credential_fields: [],
      config_fields: [
        { key: 'zone', label: 'Firewall Zone', type: 'text', default: 'public', placeholder: 'public, dmz, internal, etc.' }
      ],
      supports_batch: true,
      supports_expiry: true,
      docs_url: 'https://firewalld.org/documentation/'
    },
    ufw: {
      id: 'ufw',
      name: 'UFW (Ubuntu/Debian)',
      description: 'Block IPs locally using UFW deny rules (requires sudo)',
      requires_credential: false,
      credential_fields: [],
      config_fields: [
        { key: 'insert_position', label: 'Rule Insert Position', type: 'number', default: 1, min: 1, placeholder: 'Lower = higher priority' }
      ],
      supports_batch: true,
      supports_expiry: false,
      docs_url: 'https://help.ubuntu.com/community/UFW'
    },
    iptables: {
      id: 'iptables',
      name: 'iptables/ipset (Universal)',
      description: 'Block IPs locally using iptables/ipset (requires sudo). Most efficient for large blocklists.',
      requires_credential: false,
      credential_fields: [],
      config_fields: [
        { key: 'ipset_name', label: 'IPSet Name', type: 'text', default: 'waf_blocklist', placeholder: 'Name of ipset to use' },
        { key: 'chain', label: 'iptables Chain', type: 'text', default: 'INPUT', placeholder: 'INPUT, FORWARD, or OUTPUT' },
        { key: 'action', label: 'Action', type: 'text', default: 'DROP', placeholder: 'DROP or REJECT' }
      ],
      supports_batch: true,
      supports_expiry: true,
      docs_url: 'https://ipset.netfilter.org/'
    }
  };

  return type ? providerInfo[type] : providerInfo;
}

/**
 * Register a provider (for dynamic loading)
 * @param {string} type - Provider type ID
 * @param {class} ProviderClass - Provider class
 */
function registerProvider(type, ProviderClass) {
  if (!(ProviderClass.prototype instanceof BanProvider)) {
    throw new Error('Provider must extend BanProvider class');
  }
  PROVIDERS[type] = ProviderClass;
  console.log(`✓ Registered ban provider: ${type}`);
}

module.exports = {
  getProvider,
  getSupportedProviders,
  getProviderInfo,
  registerProvider,
  BanProvider
};
