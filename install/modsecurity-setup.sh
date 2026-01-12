#!/bin/bash

#############################################################################
# ModSecurity + OWASP CRS Installation Script
# For Nginx Proxy Orchestra WAF Integration
#
# This script installs:
# - ModSecurity 3.x library (libmodsecurity)
# - ModSecurity nginx connector
# - OWASP Core Rule Set (CRS) 4.x
# - Apprise (Python notification library)
#
# Supported OS: Debian/Ubuntu, RHEL/CentOS/Rocky
#############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MODSEC_DIR="/etc/nginx/modsec"
MODSEC_LOG_DIR="/var/log/modsec"
CRS_VERSION="v4.0.0"
MODSEC_VERSION="v3.0.12"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   ModSecurity + OWASP CRS Installation${NC}"
echo -e "${BLUE}   Nginx Proxy Orchestra WAF Integration${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: This script must be run as root${NC}"
  echo "Please run: sudo $0"
  exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  OS_VERSION=$VERSION_ID
else
  echo -e "${RED}Error: Cannot detect OS${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Detected OS: $OS $OS_VERSION${NC}\n"

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

#############################################################################
# 1. Install System Dependencies
#############################################################################

echo -e "${YELLOW}[1/7] Installing system dependencies...${NC}"

if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
  apt-get update
  apt-get install -y \
    git \
    build-essential \
    libpcre3 libpcre3-dev \
    libssl-dev \
    libtool \
    autoconf \
    automake \
    libxml2 libxml2-dev \
    libcurl4 libcurl4-openssl-dev \
    libyajl-dev \
    libgeoip-dev \
    libmaxminddb-dev \
    python3 \
    python3-pip \
    doxygen

elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]]; then
  yum groupinstall -y "Development Tools"
  yum install -y \
    git \
    pcre pcre-devel \
    openssl openssl-devel \
    libtool \
    autoconf \
    automake \
    libxml2 libxml2-devel \
    libcurl libcurl-devel \
    yajl yajl-devel \
    GeoIP-devel \
    libmaxminddb-devel \
    python3 \
    python3-pip \
    doxygen

else
  echo -e "${RED}Error: Unsupported OS: $OS${NC}"
  exit 1
fi

echo -e "${GREEN}✓ System dependencies installed${NC}\n"

#############################################################################
# 2. Check if ModSecurity is already installed
#############################################################################

echo -e "${YELLOW}[2/7] Checking existing ModSecurity installation...${NC}"

if command_exists modsec-test && [ -f /usr/local/modsecurity/lib/libmodsecurity.so ]; then
  echo -e "${GREEN}✓ ModSecurity library already installed${NC}"
  MODSEC_INSTALLED=true
else
  echo -e "${BLUE}  ModSecurity not found, will install${NC}"
  MODSEC_INSTALLED=false
fi

#############################################################################
# 3. Install ModSecurity Library
#############################################################################

if [ "$MODSEC_INSTALLED" = false ]; then
  echo -e "${YELLOW}[3/7] Installing ModSecurity library...${NC}"

  cd /tmp

  # Clone ModSecurity
  if [ -d "ModSecurity" ]; then
    rm -rf ModSecurity
  fi

  git clone --depth 1 -b $MODSEC_VERSION --single-branch https://github.com/SpiderLabs/ModSecurity
  cd ModSecurity

  # Build and install
  git submodule init
  git submodule update
  ./build.sh
  ./configure
  make -j$(nproc)
  make install

  # Create symlink for library
  ldconfig

  echo -e "${GREEN}✓ ModSecurity library installed${NC}\n"
else
  echo -e "${YELLOW}[3/7] Skipping ModSecurity installation (already installed)${NC}\n"
fi

#############################################################################
# 4. Check Nginx ModSecurity Module
#############################################################################

echo -e "${YELLOW}[4/7] Checking nginx ModSecurity module...${NC}"

if nginx -V 2>&1 | grep -q "modsecurity"; then
  echo -e "${GREEN}✓ Nginx already compiled with ModSecurity module${NC}\n"
else
  echo -e "${RED}✗ Nginx not compiled with ModSecurity module${NC}"
  echo -e "${YELLOW}  You need to recompile nginx with --add-module flag${NC}"
  echo -e "${YELLOW}  Or install nginx-modsecurity package${NC}\n"
  echo -e "${BLUE}  Installation will continue, but WAF won't work until nginx is recompiled${NC}\n"
fi

#############################################################################
# 5. Install OWASP Core Rule Set
#############################################################################

echo -e "${YELLOW}[5/7] Installing OWASP Core Rule Set...${NC}"

# Create ModSecurity directories
mkdir -p $MODSEC_DIR
mkdir -p $MODSEC_LOG_DIR
chmod 755 $MODSEC_DIR
chmod 755 $MODSEC_LOG_DIR

# Download OWASP CRS
cd $MODSEC_DIR

if [ -d "coreruleset" ]; then
  echo -e "${BLUE}  Updating existing OWASP CRS...${NC}"
  cd coreruleset
  git pull
  cd ..
else
  echo -e "${BLUE}  Downloading OWASP CRS ${CRS_VERSION}...${NC}"
  git clone https://github.com/coreruleset/coreruleset.git
  cd coreruleset
  git checkout tags/$CRS_VERSION
  cd ..
fi

# Setup CRS configuration
cd $MODSEC_DIR/coreruleset
if [ ! -f "crs-setup.conf" ]; then
  cp crs-setup.conf.example crs-setup.conf
  echo -e "${GREEN}✓ Created crs-setup.conf${NC}"
fi

echo -e "${GREEN}✓ OWASP Core Rule Set installed${NC}\n"

#############################################################################
# 6. Install Apprise for Notifications
#############################################################################

echo -e "${YELLOW}[6/7] Installing Apprise notification library...${NC}"

if command_exists apprise; then
  echo -e "${GREEN}✓ Apprise already installed${NC}"
  apprise --version
else
  pip3 install apprise
  echo -e "${GREEN}✓ Apprise installed${NC}"
  apprise --version
fi

echo ""

#############################################################################
# 7. Create Initial Configuration
#############################################################################

echo -e "${YELLOW}[7/7] Creating initial ModSecurity configuration...${NC}"

# Create main.conf placeholder (will be generated by Node.js app)
cat > $MODSEC_DIR/main.conf.example << 'EOF'
# ModSecurity Main Configuration
# This file will be auto-generated by Nginx Proxy Orchestra
# DO NOT EDIT MANUALLY

# Example configuration structure:
#
# SecRuleEngine DetectionOnly
# SecRequestBodyAccess On
# SecRequestBodyLimit 13107200
# SecRequestBodyNoFilesLimit 131072
# SecAuditEngine RelevantOnly
# SecAuditLog /var/log/modsec/audit.log
#
# Include /etc/nginx/modsec/coreruleset/crs-setup.conf
# Include /etc/nginx/modsec/coreruleset/rules/*.conf
EOF

# Create profile directory
mkdir -p /nginx-proxy-orchestra/data/modsec-profiles
chmod 755 /nginx-proxy-orchestra/data/modsec-profiles

# Set permissions
chown -R www-data:www-data $MODSEC_LOG_DIR 2>/dev/null || chown -R nginx:nginx $MODSEC_LOG_DIR 2>/dev/null || true
chmod 755 $MODSEC_LOG_DIR

echo -e "${GREEN}✓ Initial configuration created${NC}\n"

#############################################################################
# Installation Complete
#############################################################################

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   Installation Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}\n"

echo -e "${BLUE}Installed Components:${NC}"
echo -e "  ✓ ModSecurity library: /usr/local/modsecurity"
echo -e "  ✓ OWASP CRS: $MODSEC_DIR/coreruleset"
echo -e "  ✓ Apprise: $(which apprise)"
echo ""

echo -e "${BLUE}Configuration Directories:${NC}"
echo -e "  • ModSecurity config: $MODSEC_DIR"
echo -e "  • WAF profiles: /nginx-proxy-orchestra/data/modsec-profiles"
echo -e "  • Log directory: $MODSEC_LOG_DIR"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT NEXT STEPS:${NC}"
echo ""

# Check nginx module status
if nginx -V 2>&1 | grep -q "modsecurity"; then
  echo -e "${GREEN}  ✓ Nginx ModSecurity module is installed${NC}"
  echo -e "  ${BLUE}→ You can enable WAF immediately in the web UI${NC}"
else
  echo -e "${RED}  ✗ Nginx needs to be recompiled with ModSecurity module${NC}"
  echo ""
  echo -e "  ${YELLOW}To recompile nginx with ModSecurity:${NC}"
  echo -e "  1. Download nginx source matching your version"
  echo -e "  2. Clone ModSecurity-nginx connector:"
  echo -e "     git clone https://github.com/SpiderLabs/ModSecurity-nginx"
  echo -e "  3. Recompile nginx with: --add-module=/path/to/ModSecurity-nginx"
  echo -e "  4. Reinstall nginx"
  echo ""
  echo -e "  ${YELLOW}Alternative: Install pre-built nginx-modsecurity package${NC}"
  if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    echo -e "  sudo apt-get install libnginx-mod-security"
  fi
fi

echo ""
echo -e "${BLUE}Configuration:${NC}"
echo -e "  1. Restart nginx-proxy-orchestra to apply database migrations"
echo -e "  2. Login to web UI at https://your-server:81"
echo -e "  3. Navigate to Security → WAF Management"
echo -e "  4. Enable WAF and assign profiles to proxies"
echo -e "  5. Configure notifications (optional) for attack alerts"
echo ""

echo -e "${BLUE}Testing:${NC}"
echo -e "  • Test apprise: apprise --version"
echo -e "  • Test notification: apprise -t 'Test' -b 'Hello' 'discord://webhook'"
echo -e "  • Check nginx: nginx -V 2>&1 | grep modsecurity"
echo ""

echo -e "${GREEN}For more information, see the WAF implementation documentation.${NC}\n"

exit 0
