This is my list of late night ideas; possibly not even workable ideas, please let me know what you would like to see and I will contemplate how much sleep to lose for it.

PLANNED: 
Security Features:
- Multi-Factor Authentication (2FA/TOTP) - Enhance admin security beyond passwords
- Custom WAF Rule Editor - Write custom ModSecurity rules in the UI
- WAF Automated Rule Tuning - ML-assisted exclusion rule suggestions
Backend Features: 
- Prometheus Exporter - Export metrics for external dashboards, graphs make brain happy!
- Automatic Health Check - health monitoring for the server itself to prevent lockups of the management UI
- Response Time and Bandwidth Tracking - Performance metrics per proxy
Frontend Features:
- Custom Error Pages - Upload custom 404, 502, 503 pages for the default server to return
- Certificate Renewal Dry-Run - Allow testing cert ordering without actual renewal
- gRPC Support - gRPC proxy configuration UI

``` 

IN PROGRESS:
- GeoIP Lookup & Blocking - Block traffic by country/region
- OCSP Stapling Configuration - Improve TLS performance

```

COMPLETED:
- Build out rich Audit Log system                                       1/13/2026
- Bulk Operations - Enable/disable/update multiple proxies at once      1/13/2026

```

SUGGESTED:
Security Features:
- Role-Based Access Control (RBAC) - Multiple user roles (admin, operator, viewer)
- IPv6 Support Improvements - Full IPv6 private range support in log parser and all blocking functions

Backend Features: 
- Backup & Restore - One-click backup of all configs and database
- Automatic Backend Health Check - health monitoring for the server itself to prevent lockups of the management UI
- Request/Response Header Manipulation - Easily add/remove/modify headers per prox
- Import/Export Configurations - Migrate configs between instances
- Service Discovery: Scan a subnet to find HTTP / HTTPS services for potential addition to proxy

Frontend Features:
- Custom Report Builder - Create scheduled PDF/CSV, support APPRISE endpoints seperately; reports with metrics and potential bottlenecks
- Proxy Migration Tool - Import from Nginx Proxy Manager, Traefik, and Caddy configs

Miscellaneous Features:
- Access Log Retention Policies - Automated log rotation/archival, keep them zipped for future referencing by that great big security team you have
- Webhook Support - Custom integrations for events (cert expiry, bans, errors), APPRISE can do this but I have not tested
- OCSP Stapling Configuration - Improve TLS performance
- Backend Health Checks - Monitor upstream server availability for configuration errors that sneak through
- Response Time and Bandwidth Tracking - Performance metrics per proxy
- Docker Integration: Wrap this crappy project into a container image for easy deployment