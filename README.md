# Project Overview

Over my years of homelabbing, I have not been very happy with the existing options for **WAF / Proxy combinations**, and so this side project was born. Most WAF solutions I have encountered are either:

- Far too bulky, adding massive processing overhead, or
- Lacking features or implementing them in a way that is not user-friendly

Homelabbing should be **fun**, not tedious.

This project aims to offer a **simple and intuitive management framework** for deploying and managing proxies via **Nginx**, with added **Nginx security features** and **WAF capabilities**. Commonly known *“enterprise”* features will **always be free**.

---

## Technology Stack

### Backend

- **Node.js**  
  Custom HTTP server built on Node.js.

- **Better-SQLite3**  
  SQLite3 runs in a dual-database configuration:
  - **WAF-DB**: Handles high-volume activity specifically for WAF tasks.
  - **Nginx-DB**: Handles all other application data as the primary database.  
  - https://github.com/WiseLibs/better-sqlite3

- **Authentication & Security**
  - JWT authentication with **7-day key rotation**
  - **bcrypt** password hashing  
  - https://github.com/kelektiv/node.bcrypt.js  
  - https://github.com/auth0/node-jsonwebtoken

- **PM2**  
  PM2 is the preferred process manager for this project, though it is not required.  
  - https://github.com/Unitech/pm2

---

### Frontend

- **Vanilla JavaScript**
  - Hash-based routing
  - No frontend frameworks

- **Chart.js**
  - Used for all visualizations  
  - This is the **only external frontend library**  
  - https://www.chartjs.org/

- **Custom UI**
  - All JavaScript and CSS components are custom-built
  - No framework vulnerabilities to worry about

---

## Core Infrastructure

- **Nginx**
  - Core proxy host and host management framework  
  - https://nginx.org/

- **ModSecurity**
  - WAF integration using OWASP CRS and Top 10 rules  
  - https://modsecurity.org/

- **Let’s Encrypt / Certbot**
  - Automatic certificate issuance and renewal  
  - https://certbot.eff.org/

- **Apprise**
  - Handles all alerting and notification delivery  
  - https://github.com/caronc/apprise

- **Custom Firewall Integrations**
  - Automatic banning of IPs detected by WAF rules

---

## Architecture Choices

- No external frameworks were used — **fewer dependencies means less risk**
- WAF features are built using **Server-Sent Events (SSE)** for real-time responsiveness
- **Modular routing and utilities**
  - Core features are split into modular JavaScript files under `server/routes/`
- Administrators should have **full control** over any application they host  
  - This project was built with **control-first design principles**

---

## Disclosure

This project has used AI to assist with auditing and smaller tasks such as:

- Template generation
- Code cleanup
- Minor refactors

However, **all security functions, core implementations, and architectural design decisions** have been implemented by human developers.

AI is useful — but it is not smart.  
Always verify the output and implementations it produces.
