/**
 * Migration 016: Clean Nested Server Blocks from advanced_config
 * 
 * Problem: Some proxies have full nginx configs (with server blocks) stored in 
 * advanced_config field from before the text editor migration. When generateServerBlock()
 * runs, it inserts this into the location block, causing nested server blocks.
 * 
 * Solution: Clear advanced_config for proxies that have server blocks in it, since
 * these proxies should be using the structured config generation flow, not storing
 * full custom configs.
 */

function migrate(db) {
  console.log('Running migration 016: Clean nested server blocks from advanced_config...');
  
  try {
    // Find all proxies with advanced_config that contains server blocks
    const proxiesWithServerBlocks = db.prepare(`
      SELECT id, name, advanced_config 
      FROM proxy_hosts 
      WHERE advanced_config IS NOT NULL 
        AND advanced_config != ''
        AND advanced_config LIKE '%server {%'
    `).all();
    
    if (proxiesWithServerBlocks.length === 0) {
      console.log('No proxies found with nested server blocks in advanced_config');
      return;
    }
    
    console.log(`Found ${proxiesWithServerBlocks.length} proxies with server blocks in advanced_config:`);
    
    // Clear advanced_config for these proxies
    const updateStmt = db.prepare(`
      UPDATE proxy_hosts 
      SET advanced_config = NULL 
      WHERE id = ?
    `);
    
    for (const proxy of proxiesWithServerBlocks) {
      console.log(`  - Proxy ${proxy.id}: ${proxy.name}`);
      updateStmt.run(proxy.id);
    }
    
    console.log('✓ Migration 016 complete: Cleared advanced_config with nested server blocks');
    console.log('Note: These proxies will now use structured config generation with modules.');
    console.log('If any proxy needs custom configuration, edit it via the text editor in the UI.');
    
  } catch (error) {
    console.error('Migration 016 failed:', error);
    throw error;
  }
}

module.exports = { migrate };
