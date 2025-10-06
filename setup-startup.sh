#!/bin/bash

# Pastebin Startup Script
# This script sets up the pastebin application to run on Ubuntu startup

echo "Setting up Pastebin to run on startup..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

# Install Node.js if not already installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt-get install -y nodejs
fi

# Create application directory
echo "Creating application directory..."
mkdir -p /opt/pastebin
chown www-data:www-data /opt/pastebin

# Copy application files
echo "Copying application files..."
cp -r . /opt/pastebin/
cd /opt/pastebin

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Create systemd service
echo "Creating systemd service..."
cp pastebin.service /etc/systemd/system/

# Reload systemd and enable service
echo "Enabling service..."
systemctl daemon-reload
systemctl enable pastebin.service

# Start the service
echo "Starting service..."
systemctl start pastebin.service

# Check status
echo "Checking service status..."
systemctl status pastebin.service

echo ""
echo "✅ Pastebin is now set up to run on startup!"
echo "🌐 Access your application at: http://localhost:3000"
echo ""
echo "Useful commands:"
echo "  sudo systemctl start pastebin    # Start service"
echo "  sudo systemctl stop pastebin     # Stop service"
echo "  sudo systemctl restart pastebin  # Restart service"
echo "  sudo systemctl status pastebin   # Check status"
echo "  sudo journalctl -u pastebin -f   # View logs"

