# Auto-Deploy Setup for VPS

This directory contains scripts for automatic deployment on VPS boot.

## Files

- `auto-deploy.service` - Systemd service configuration
- `auto-deploy.sh` - Deployment script that pulls git and rebuilds containers

## Installation

Run these commands on your VPS:

```bash
# Copy the systemd service file
sudo cp /opt/engganyo-project/infra/scripts/auto-deploy.service /etc/systemd/system/

# Make the deploy script executable
chmod +x /opt/engganyo-project/infra/scripts/auto-deploy.sh

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable auto-deploy

# Start the service manually (optional, to test)
sudo systemctl start auto-deploy

# Check service status
sudo systemctl status auto-deploy
```

## What it does

When the VPS boots, the auto-deploy service will:
1. Pull latest changes from git
2. Stop existing Docker containers
3. Rebuild and start Docker containers
4. Run Prisma migrations
5. Run database seed

## Logs

Logs are written to `/var/log/engganyo-auto-deploy.log`

## Manual deployment

To manually trigger deployment without rebooting:

```bash
sudo systemctl start auto-deploy
```
