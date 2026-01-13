-- Manual SQL script to update ssl_cert_id for existing proxies
-- This extracts certificate paths from advanced_config and matches them to certificates
--
-- Run this with: sqlite3 data/database.db < fix-cert-relationships.sql
--
-- Or manually in sqlite3 CLI

.headers on
.mode column

-- First, let's see what we're working with
SELECT 'Current Certificate Usage:' as info;
SELECT 
  c.id as cert_id,
  c.name as cert_name,
  COUNT(p.id) as proxy_count,
  GROUP_CONCAT(p.name, ', ') as proxy_names
FROM ssl_certificates c
LEFT JOIN proxy_hosts p ON c.id = p.ssl_cert_id
GROUP BY c.id, c.name;

SELECT '';
SELECT 'Proxies with SSL enabled but no ssl_cert_id:' as info;
SELECT 
  id,
  name,
  type,
  ssl_enabled,
  ssl_cert_id,
  CASE 
    WHEN advanced_config LIKE '%ssl_certificate %' THEN 'Has SSL directives in config'
    ELSE 'No SSL directives'
  END as config_status
FROM proxy_hosts
WHERE ssl_enabled = 1 AND ssl_cert_id IS NULL;

-- Note: Automatic matching would require extracting paths from advanced_config
-- which SQLite cannot do easily. This needs to be done by the Node.js migration.
--
-- To manually fix, you would need to:
-- 1. Find the ssl_certificate path in each proxy's advanced_config
-- 2. Match it to a certificate's cert_path
-- 3. UPDATE proxy_hosts SET ssl_cert_id = ? WHERE id = ?
--
-- Example for a specific proxy (replace IDs and paths):
-- UPDATE proxy_hosts 
-- SET ssl_cert_id = 1 
-- WHERE id = 5 
-- AND advanced_config LIKE '%/path/to/your/cert.crt%';
