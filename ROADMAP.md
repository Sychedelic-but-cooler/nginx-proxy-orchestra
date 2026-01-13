# ROADMAP

This is my list of late-night ideas; possibly not even workable ideas. Below I've grouped, prioritized (HIGH / LOW), and sorted each category with HIGH items first.

---

## Planned

### Security Features
- **HIGH**: Multi-Factor Authentication (2FA/TOTP) - Enhance admin security beyond passwords
- **HIGH**: Custom WAF Rule Editor - Write custom ModSecurity rules in the UI
- **LOW**: WAF Automated Rule Tuning - ML-assisted exclusion rule suggestions

### Backend Features
- **HIGH**: Prometheus Exporter - Export metrics for external dashboards
- **HIGH**: Automatic Health Check - Monitor management server health to avoid UI lockups
- **LOW**: Response Time and Bandwidth Tracking - Performance metrics per proxy

### Frontend Features
- **LOW**: gRPC Support - gRPC proxy configuration UI

---

## In Progress
- **HIGH**: GeoIP Lookup & Blocking - Block traffic by country/region
- **HIGH**: OCSP Stapling Configuration - Improve TLS performance

---

## Completed
- Build out rich Audit Log system — 2026-01-13
- Bulk Operations - Enable/disable/update multiple proxies at once — 2026-01-13
- Certificate Renewal Dry-Run - Allow testing cert ordering without actual renewal — 2026-01-13
- Custom Error Pages - Upload custom 404, 502, 503 pages for the default server and proxies — 2026-01-13

---

## Suggested

### Security Features
- **HIGH**: Role-Based Access Control (RBAC) - Multiple user roles (admin, operator, viewer)
- **LOW**: IPv6 Support Improvements - Full IPv6 private range support in log parser and all blocking functions

### Backend Features
- **HIGH**: Backup & Restore - One-click backup of all configs and database
- **HIGH**: Request/Response Header Manipulation - Easily add/remove/modify headers per proxy
- **MEDIUM**: Import/Export Configurations - Migrate configs between instances
- **LOW**: Service Discovery - Scan a subnet to find HTTP / HTTPS services for potential addition to proxy
- **LOW**: Automatic Backend Health Check - health monitoring for the server itself to prevent lockups of the management UI

### Frontend Features
- **HIGH**: Proxy Migration Tool - Import from Nginx Proxy Manager, Traefik, and Caddy configs
- **LOW**: Custom Report Builder - Create scheduled PDF/CSV, support APPRISE endpoints separately; reports with metrics and potential bottlenecks

### Miscellaneous Features
- **HIGH**: Docker Integration - Provide a supported container image for easy deployment
- **HIGH**: Webhook Support - Custom integrations for events (cert expiry, bans, errors)
- **MEDIUM**: Access Log Retention Policies - Automated log rotation/archival
- **LOW**: Backend Health Checks - Monitor upstream server availability for configuration errors
- **LOW**: Response Time and Bandwidth Tracking - Performance metrics per proxy
- **LOW**: OCSP Stapling Configuration - Improve TLS performance

---

## Notes
- Priorities are suggested based on typical admin needs: security, reliability, backups, and developer experience often provide the most value.
- I marked items that overlap (e.g., OCSP Stapling appears in multiple sections) as LOW in miscellaneous to avoid duplication.

If you'd like, I can:
- Adjust priorities (you can tell me which items you care about most)
- Create issues/tickets for HIGH-priority items
- Start implementing one of the HIGH items now (I can begin with a small one like `Custom Error Pages` or `Request/Response Header Manipulation`).
