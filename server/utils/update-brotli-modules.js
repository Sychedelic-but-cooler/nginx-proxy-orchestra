/**
 * Update Brotli modules to uncommented versions
 * Run this after installing nginx-mod-brotli
 */

const { db } = require('../db');

function updateBrotliModules() {
  console.log('Updating Brotli modules...');

  // Brotli Compression (standard)
  const brotliStandard = `brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`;

  // Brotli Compression (aggressive)
  const brotliAggressive = `brotli on;
brotli_comp_level 11;
brotli_min_length 256;
brotli_types
  application/atom+xml
  application/geo+json
  application/javascript
  application/x-javascript
  application/json
  application/ld+json
  application/manifest+json
  application/rdf+xml
  application/rss+xml
  application/vnd.ms-fontobject
  application/wasm
  application/x-web-app-manifest+json
  application/xhtml+xml
  application/xml
  font/eot
  font/otf
  font/ttf
  image/bmp
  image/svg+xml
  text/cache-manifest
  text/calendar
  text/css
  text/javascript
  text/markdown
  text/plain
  text/xml;`;

  try {
    // Update Brotli Compression module
    const standardResult = db.prepare(`
      UPDATE modules
      SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE name = 'Brotli Compression'
    `).run(brotliStandard);

    if (standardResult.changes > 0) {
      console.log('✓ Updated "Brotli Compression" module');
    } else {
      console.log('⚠ "Brotli Compression" module not found');
    }

    // Update Brotli Compression (Aggressive) module
    const aggressiveResult = db.prepare(`
      UPDATE modules
      SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE name = 'Brotli Compression (Aggressive)'
    `).run(brotliAggressive);

    if (aggressiveResult.changes > 0) {
      console.log('✓ Updated "Brotli Compression (Aggressive)" module');
    } else {
      console.log('⚠ "Brotli Compression (Aggressive)" module not found');
    }

    console.log('\n✅ Brotli modules updated successfully!');
    console.log('\nYou can now use these modules when creating proxy hosts.');
    console.log('The Brotli compression will only be applied to hosts that have the module selected.\n');

  } catch (error) {
    console.error('❌ Error updating Brotli modules:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  updateBrotliModules();
  process.exit(0);
}

module.exports = { updateBrotliModules };
