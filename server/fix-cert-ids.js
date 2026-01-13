/**
 * Force update ssl_cert_id for all SSL-enabled proxies
 * Run with: node server/fix-cert-ids.js
 */

const { db } = require('./db');
const { extractStructuredFields, findCertificateByPaths } = require('./utils/nginx-parser');

console.log('=== Forcing Certificate ID Updates ===\n');

// Get all SSL-enabled proxies that don't have ssl_cert_id set
const proxies = db.prepare(`
  SELECT id, name, type, advanced_config 
  FROM proxy_hosts 
  WHERE ssl_enabled = 1 
    AND ssl_cert_id IS NULL
    AND advanced_config IS NOT NULL 
    AND advanced_config != ''
`).all();

console.log(`Found ${proxies.length} proxies to update\n`);

let successCount = 0;
let failCount = 0;

for (const proxy of proxies) {
  try {
    const extractedFields = extractStructuredFields(proxy.advanced_config, proxy.type || 'reverse');
    
    // Try to find matching certificate by paths
    if (extractedFields.ssl_enabled && extractedFields.ssl_cert_path && extractedFields.ssl_key_path) {
      const certId = findCertificateByPaths(db, extractedFields.ssl_cert_path, extractedFields.ssl_key_path);
      
      if (certId) {
        // Update the proxy with the certificate ID
        db.prepare(`
          UPDATE proxy_hosts
          SET ssl_cert_id = ?
          WHERE id = ?
        `).run(certId, proxy.id);
        
        console.log(`✓ Updated proxy "${proxy.name}" (ID: ${proxy.id}) with cert ID: ${certId}`);
        successCount++;
      } else {
        console.log(`✗ No matching certificate found for proxy "${proxy.name}" (ID: ${proxy.id})`);
        console.log(`  Cert path: ${extractedFields.ssl_cert_path}`);
        console.log(`  Key path: ${extractedFields.ssl_key_path}`);
        failCount++;
      }
    } else {
      console.log(`⊘ Proxy "${proxy.name}" (ID: ${proxy.id}) - SSL not properly configured in advanced_config`);
      failCount++;
    }
  } catch (err) {
    console.error(`✗ Failed to process proxy "${proxy.name}" (ID: ${proxy.id}):`, err.message);
    failCount++;
  }
}

console.log(`\n=== Summary ===`);
console.log(`Successfully updated: ${successCount} proxies`);
console.log(`Failed/Skipped: ${failCount} proxies`);

// Show the updated usage
console.log(`\n=== Updated Certificate Usage ===`);
const certs = db.prepare('SELECT id, name FROM ssl_certificates ORDER BY id').all();

certs.forEach(cert => {
  const proxiesUsingCert = db.prepare(`
    SELECT id, name FROM proxy_hosts WHERE ssl_cert_id = ?
  `).all(cert.id);
  
  console.log(`\nCertificate: ${cert.name} (ID: ${cert.id})`);
  if (proxiesUsingCert.length > 0) {
    console.log(`  In Use by ${proxiesUsingCert.length} proxies:`);
    proxiesUsingCert.forEach(p => console.log(`    - ${p.name} (ID: ${p.id})`));
  } else {
    console.log('  NOT IN USE');
  }
});

console.log('\n✓ Done! The certificate usage should now display correctly in the UI.');
console.log('  Refresh the Certificates page to see the updated usage information.\n');
