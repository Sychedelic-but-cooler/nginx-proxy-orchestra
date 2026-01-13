/**
 * Debug script to check certificate-proxy relationships
 * Run with: node server/debug-certs.js
 */

const { db } = require('./db');
const { extractStructuredFields, findCertificateByPaths } = require('./utils/nginx-parser');

console.log('=== SSL Certificates in Database ===');
const certs = db.prepare('SELECT id, name, cert_path, key_path FROM ssl_certificates').all();
console.log(`Found ${certs.length} certificates:\n`);
certs.forEach(c => {
  console.log(`ID: ${c.id}`);
  console.log(`Name: ${c.name}`);
  console.log(`Cert Path: ${c.cert_path}`);
  console.log(`Key Path: ${c.key_path}`);
  console.log('');
});

console.log('\n=== Proxy Hosts with SSL Enabled ===');
const proxies = db.prepare(`
  SELECT id, name, type, ssl_enabled, ssl_cert_id, advanced_config 
  FROM proxy_hosts 
  WHERE ssl_enabled = 1
`).all();

console.log(`Found ${proxies.length} proxies with SSL enabled:\n`);

proxies.forEach(p => {
  console.log(`\nProxy ID: ${p.id}`);
  console.log(`Name: ${p.name}`);
  console.log(`Type: ${p.type}`);
  console.log(`Current ssl_cert_id: ${p.ssl_cert_id || 'NULL'}`);
  
  if (p.advanced_config) {
    console.log('\nExtracting from advanced_config...');
    
    // Show what's in the config
    const certMatch = p.advanced_config.match(/ssl_certificate\s+([^;]+);/);
    const keyMatch = p.advanced_config.match(/ssl_certificate_key\s+([^;]+);/);
    
    if (certMatch) console.log(`  Found ssl_certificate directive: ${certMatch[1]}`);
    if (keyMatch) console.log(`  Found ssl_certificate_key directive: ${keyMatch[1]}`);
    
    // Try extraction
    const extracted = extractStructuredFields(p.advanced_config, p.type);
    console.log(`  Extracted ssl_enabled: ${extracted.ssl_enabled}`);
    console.log(`  Extracted ssl_cert_path: ${extracted.ssl_cert_path || 'NULL'}`);
    console.log(`  Extracted ssl_key_path: ${extracted.ssl_key_path || 'NULL'}`);
    
    // Try to find matching cert
    if (extracted.ssl_cert_path && extracted.ssl_key_path) {
      const matchedCertId = findCertificateByPaths(db, extracted.ssl_cert_path, extracted.ssl_key_path);
      console.log(`  Matched certificate ID: ${matchedCertId || 'NOT FOUND'}`);
      
      if (!matchedCertId) {
        console.log('\n  Searching for partial matches...');
        certs.forEach(c => {
          if (c.cert_path.includes(extracted.ssl_cert_path) || extracted.ssl_cert_path.includes(c.cert_path)) {
            console.log(`    Possible match with cert ${c.id} (${c.name})`);
            console.log(`      DB cert_path: ${c.cert_path}`);
            console.log(`      Config cert_path: ${extracted.ssl_cert_path}`);
          }
        });
      }
    }
  } else {
    console.log('  No advanced_config (uses structured fields)');
  }
  
  console.log('-'.repeat(80));
});

// Check what certificates are actually being used
console.log('\n\n=== Certificate Usage Summary ===');
certs.forEach(c => {
  const proxiesUsingCert = db.prepare(`
    SELECT id, name FROM proxy_hosts WHERE ssl_cert_id = ?
  `).all(c.id);
  
  console.log(`\nCertificate: ${c.name} (ID: ${c.id})`);
  if (proxiesUsingCert.length > 0) {
    console.log(`  Used by ${proxiesUsingCert.length} proxies:`);
    proxiesUsingCert.forEach(p => console.log(`    - ${p.name} (ID: ${p.id})`));
  } else {
    console.log('  NOT IN USE');
  }
});

console.log('\n\nDone!');
