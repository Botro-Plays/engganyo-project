# Engganyo Project Deployment Guide

This guide covers all necessary commands to set up and deploy the Engganyo project from scratch.

## Prerequisites

- Ubuntu/Debian VPS with Docker and Docker Compose installed
- Git access
- SSH access to VPS

## Step 1: Clone the Repository

```bash
# SSH into your VPS
ssh engganyo@134.255.225.158

# Clone the repository (if not already cloned)
cd /opt
git clone https://github.com/Botro-Plays/engganyo-project.git
cd engganyo-project
```

## Step 2: Place SSL Certificates

Before starting services, place your Cloudflare Origin Certificates:

```bash
# See infra/nginx/ssl/README.md for how to generate these
nano /opt/engganyo-project/infra/nginx/ssl/cert.pem   # paste certificate
nano /opt/engganyo-project/infra/nginx/ssl/key.pem    # paste private key
chmod 644 infra/nginx/ssl/cert.pem
chmod 600 infra/nginx/ssl/key.pem
```

## Step 3: Configure Environment Variables

```bash
# Copy the production environment template
cp .env.production.example .env

# Edit the .env file with your actual values
nano .env
```

**Required environment variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT token signing
- `COOKIE_SECRET` - Secret for cookie encryption
- `ENCRYPTION_KEY` - Encryption key for sensitive data
- `ADMIN_EMAIL` - Admin account email
- `ADMIN_PASSWORD` - Admin account password

## Step 4: Start Infrastructure Services

```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis
```

## Step 5: Run Database Migrations

```bash
# Run Prisma migrations to create database tables
docker-compose exec -T api npx prisma migrate deploy
```

## Step 6: Seed Database with Initial Data

```bash
# Run the seed script to create admin user and initial data
docker-compose exec -T api npx prisma db seed
```

## Step 7: Start All Services

```bash
# Start API, web, and nginx
docker-compose up -d --build
```

## Step 8: Verify Services are Running

```bash
# Check all containers are running
docker-compose ps

# Check logs if needed
docker-compose logs -f api
docker-compose logs -f web
docker-compose logs -f nginx
```

## Step 9: Access the Application

- **Main Application:** `https://engganyo.com`
- **Admin Dashboard:** `https://engganyo.com/admin`

Default admin credentials (from seed):
- Email: `admin@engganyo.com` (or your `ADMIN_EMAIL` env var)
- Password: `Admin@123456` (or your `ADMIN_PASSWORD` env var)

---

## Auto-Deployment Setup

The project includes a systemd service for automatic deployment on VPS boot.

### Setup Auto-Deploy Service (One-time Setup)

```bash
# Copy the systemd service file
sudo cp infra/scripts/auto-deploy.service /etc/systemd/system/

# Make the script executable
chmod +x infra/scripts/auto-deploy.sh

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable auto-deploy

# Start the service now
sudo systemctl start auto-deploy
```

### Manual Deployment After Code Changes

When you push new code to GitHub, deploy it to VPS:

```bash
# SSH into VPS
ssh engganyo@134.255.225.158

# Navigate to project directory
cd /opt/engganyo-project

# Pull latest changes
git pull origin main

# Trigger auto-deploy
sudo systemctl start auto-deploy
```

### Check Auto-Deploy Logs

```bash
# View deployment logs
tail -f /opt/engganyo-project/auto-deploy.log

# Check service status
sudo systemctl status auto-deploy
```

---

## Common Maintenance Commands

### Restart All Services

```bash
docker-compose restart
```

### Rebuild Specific Service

```bash
# Rebuild API only
docker-compose up -d --build api

# Rebuild Web only
docker-compose up -d --build web
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f web
docker-compose logs -f nginx
```

### Stop All Services

```bash
docker-compose down
```

### Stop and Remove All Data (⚠️ Destructive)

```bash
docker-compose down -v
```

### Run Migrations Only

```bash
docker-compose exec -T api npx prisma migrate deploy
```

### Seed Database Only

```bash
docker-compose exec -T api npx prisma db seed
```

---

## Troubleshooting

### Containers Won't Start

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs

# Check disk space
df -h
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Restart PostgreSQL
docker-compose restart postgres
```

### Permission Denied on Auto-Deploy

```bash
# Ensure script is executable
chmod +x infra/scripts/auto-deploy.sh

# Check service status
sudo systemctl status auto-deploy
```

### Port Already in Use

```bash
# Check what's using the port
sudo netstat -tlnp | grep :3000
sudo netstat -tlnp | grep :3001

# Kill the process if needed
sudo kill -9 <PID>
```

---

## Security Notes

- Keep your `.env` file secure and never commit it to git
- Use strong passwords for `ADMIN_PASSWORD`, `JWT_SECRET`, and `COOKIE_SECRET`
- Regularly update Docker images: `docker-compose pull && docker-compose up -d --build`
- Monitor logs for suspicious activity
- Keep your VPS updated: `sudo apt update && sudo apt upgrade`
- Uploads are protected by JWT authentication - only authenticated users can access proof files
- Upload volume `engganyo_uploads` persists across container rebuilds

---

## Email Verification Configuration

To enable/disable email verification for new user registrations:

```bash
# Edit .env file
nano .env

# Set to true to enable, false to disable
ENABLE_EMAIL_VERIFICATION=false

# Restart API
docker-compose restart api
```

When enabled, new users will have `PENDING_VERIFICATION` status and must be approved by admin in the admin dashboard.
