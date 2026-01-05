const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Parse certificate content to extract metadata
 */
function parseCertificate(certContent) {
  try {
    // Create a temporary file for the certificate
    const tempFile = path.join('/tmp', `cert-${crypto.randomBytes(8).toString('hex')}.pem`);
    fs.writeFileSync(tempFile, certContent);

    try {
      // Use openssl to parse the certificate
      const output = execSync(`openssl x509 -in ${tempFile} -noout -subject -issuer -dates -ext subjectAltName -nameopt multiline`, {
        encoding: 'utf8'
      });

      // Parse the output
      const lines = output.split('\n');
      const certInfo = {
        subject: {},
        issuer: {},
        domains: [],
        notBefore: null,
        notAfter: null
      };

      let currentSection = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('subject=')) {
          currentSection = 'subject';
          continue;
        } else if (line.startsWith('issuer=')) {
          currentSection = 'issuer';
          continue;
        } else if (line.startsWith('notBefore=')) {
          certInfo.notBefore = new Date(line.split('=')[1]);
        } else if (line.startsWith('notAfter=')) {
          certInfo.notAfter = new Date(line.split('=')[1]);
        } else if (line.includes('DNS:')) {
          // Extract SANs (Subject Alternative Names)
          const dnsMatch = line.match(/DNS:([^,\s]+)/g);
          if (dnsMatch) {
            certInfo.domains.push(...dnsMatch.map(d => d.replace('DNS:', '')));
          }
        } else if (currentSection && line.includes('=')) {
          // Parse subject/issuer fields
          const match = line.match(/^\s*([^=]+)\s*=\s*(.+)$/);
          if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            certInfo[currentSection][key] = value;
          }
        }
      }

      // If no SANs found, try to extract CN from subject
      if (certInfo.domains.length === 0 && certInfo.subject.commonName) {
        certInfo.domains.push(certInfo.subject.commonName);
      }

      // Clean up temp file
      fs.unlinkSync(tempFile);

      return certInfo;
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  } catch (error) {
    throw new Error(`Failed to parse certificate: ${error.message}`);
  }
}

/**
 * Validate certificate and key pair
 */
function validateCertificateKeyPair(certContent, keyContent) {
  try {
    // Create temporary files
    const certFile = path.join('/tmp', `cert-${crypto.randomBytes(8).toString('hex')}.pem`);
    const keyFile = path.join('/tmp', `key-${crypto.randomBytes(8).toString('hex')}.pem`);
    
    fs.writeFileSync(certFile, certContent);
    fs.writeFileSync(keyFile, keyContent);

    try {
      // Get certificate modulus
      const certModulus = execSync(`openssl x509 -noout -modulus -in ${certFile}`, {
        encoding: 'utf8'
      }).trim();

      // Get key modulus
      const keyModulus = execSync(`openssl rsa -noout -modulus -in ${keyFile}`, {
        encoding: 'utf8'
      }).trim();

      // Clean up
      fs.unlinkSync(certFile);
      fs.unlinkSync(keyFile);

      // Compare moduli
      return certModulus === keyModulus;
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(certFile)) fs.unlinkSync(certFile);
      if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile);
      throw error;
    }
  } catch (error) {
    throw new Error(`Failed to validate certificate/key pair: ${error.message}`);
  }
}

/**
 * Save certificate and key to disk
 */
function saveCertificateFiles(certContent, keyContent, name) {
  const sslDir = process.env.SSL_DIR || path.join(__dirname, '../../data/ssl');
  
  // Create SSL directory if it doesn't exist
  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true, mode: 0o700 });
  }

  // Generate safe filename from name
  const safeFilename = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const certPath = path.join(sslDir, `${safeFilename}.crt`);
  const keyPath = path.join(sslDir, `${safeFilename}.key`);

  // Save files with appropriate permissions
  fs.writeFileSync(certPath, certContent, { mode: 0o644 });
  fs.writeFileSync(keyPath, keyContent, { mode: 0o600 });

  return { certPath, keyPath };
}

/**
 * Delete certificate files from disk
 */
function deleteCertificateFiles(certPath, keyPath) {
  try {
    if (fs.existsSync(certPath)) {
      fs.unlinkSync(certPath);
    }
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
    }
  } catch (error) {
    console.error('Error deleting certificate files:', error);
    // Don't throw - file deletion is not critical
  }
}

module.exports = {
  parseCertificate,
  validateCertificateKeyPair,
  saveCertificateFiles,
  deleteCertificateFiles
};
