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

## Step 7: Pull Pre-built Images and Start All Services

On first VPS setup, pull the latest images from GHCR (built by GitHub Actions) then start:

```bash
# Authenticate to GHCR (requires GHCR_TOKEN in .env — see GitHub Secrets section below)
set -a; source .env; set +a
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

# Pull pre-built images
docker pull ghcr.io/botro-plays/engganyo-project/api:latest
docker pull ghcr.io/botro-plays/engganyo-project/web:latest

# Start all services (no --build; uses pulled images)
docker-compose up -d
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

## Automated Deployment (GitHub Actions → GHCR → VPS)

Deployments are **fully automated** on every push to `main`:

1. **CI** (`ci.yml`) — lint, test, build
2. **Deploy** (`deploy.yml`) — triggered when CI passes:
   - Builds Docker images on GitHub's fast servers
   - Pushes to GitHub Container Registry (GHCR)
   - SSHes into VPS → pulls pre-built images → restarts containers → runs migrations

**No manual action required.** Deploy time: ~3 minutes (down from ~15 min).

---

### Required GitHub Secrets

Configure these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS IP address or domain (e.g. `134.255.225.158`) |
| `VPS_USER` | SSH username (e.g. `engganyo`, `ubuntu`, or `root`) |
| `VPS_SSH_KEY` | **Full contents** of the VPS SSH private key (`~/.ssh/id_rsa`) |
| `NEXT_PUBLIC_API_URL` | Production API URL baked into Next.js build (e.g. `https://engganyo.com/api`) |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Google reCAPTCHA v3 site key (public, baked into Next.js bundle) |

> `GITHUB_TOKEN` is **automatic** — no setup needed. It is used to push images to GHCR and for the VPS pull.

---

### Setup Auto-Deploy Service (One-time, Manual Fallback)

The systemd service is a **manual fallback** only (e.g., if GitHub Actions is unavailable).

```bash
# Copy the systemd service file
sudo cp infra/scripts/auto-deploy.service /etc/systemd/system/

# Make the script executable
chmod +x infra/scripts/auto-deploy.sh

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable on boot (optional)
sudo systemctl enable auto-deploy
```

For the manual fallback to work, add these two lines to `/opt/engganyo-project/.env`:

```bash
GHCR_TOKEN=<GitHub PAT with read:packages scope>
GHCR_USER=<your GitHub username, e.g. botro-plays>
```

To trigger a manual deploy:

```bash
sudo systemctl start auto-deploy
```

### Check Deployment Logs

```bash
# View deployment logs (manual fallback)
tail -f /opt/engganyo-project/auto-deploy.log

# Check systemd service status
sudo systemctl status auto-deploy

# GitHub Actions deploys: check the Deploy workflow on github.com/Botro-Plays/engganyo-project/actions
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

---

## Database Backup Strategy

### Current Infrastructure

- **PostgreSQL service**: `engganyo_postgres`
- **Database volume**: `engganyo_pgdata` (mounted at `/var/lib/postgresql/data` in container)
- **Project directory**: `/opt/engganyo-project`
- **Backup directory**: `/opt/engganyo-project/backups` (recommended)

### Manual Database Backup

```bash
# Create backup directory
mkdir -p /opt/engganyo-project/backups

# Backup PostgreSQL database (compressed)
docker-compose exec -T postgres pg_dump -U engganyo engganyo_db | gzip > /opt/engganyo-project/backups/engganyo_db_$(date +%Y%m%d_%H%M%S).sql.gz

# Verify backup was created
ls -lh /opt/engganyo-project/backups/
```

### Backup Naming Convention

Format: `engganyo_db_YYYYMMDD_HHMMSS.sql.gz`

Examples:
- `engganyo_db_20260521_030000.sql.gz` (daily backup at 3:00 AM UTC)
- `engganyo_db_20260521_120000.sql.gz` (manual backup)
- `engganyo_db_20260521_235959.sql.gz` (end-of-day backup)

### Backup Retention Policy

**Recommended retention**:
- **Daily backups**: Keep last 7 days
- **Weekly backups**: Keep last 4 weeks
- **Monthly backups**: Keep last 3 months

**Backup directory structure**:
```
/opt/engganyo-project/backups/
├── daily/
│   ├── engganyo_db_20260521_030000.sql.gz
│   ├── engganyo_db_20260520_030000.sql.gz
│   └── ...
├── weekly/
│   ├── engganyo_db_week_20260521.sql.gz
│   └── ...
└── monthly/
    ├── engganyo_db_month_202605.sql.gz
    └── ...
```

### Manual Backup Rotation

```bash
# Delete backups older than 7 days
find /opt/engganyo-project/backups/daily -name "*.sql.gz" -mtime +7 -delete

# Delete weekly backups older than 4 weeks
find /opt/engganyo-project/backups/weekly -name "*.sql.gz" -mtime +28 -delete

# Delete monthly backups older than 3 months
find /opt/engganyo-project/backups/monthly -name "*.sql.gz" -mtime +90 -delete
```

### Restore Verification

After creating a backup, verify it can be restored:

```bash
# Test restore to a temporary database
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "CREATE DATABASE engganyo_test_restore;"
gunzip -c /opt/engganyo-project/backups/engganyo_db_20260521_030000.sql.gz | docker-compose exec -T postgres psql -U engganyo -d engganyo_test_restore
docker-compose exec -T postgres psql -U engganyo -d engganyo_test_restore -c "\dt"
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "DROP DATABASE engganyo_test_restore;"
```

---

## Automated Backup Flow

### Cron Job Setup

Add a cron job to run daily backups at 3:00 AM UTC:

```bash
# Open crontab for root
sudo crontab -e

# Add the following line (runs daily at 3:00 AM UTC)
0 3 * * * mkdir -p /opt/engganyo-project/backups/daily && cd /opt/engganyo-project && /usr/bin/docker-compose exec -T postgres pg_dump -U engganyo engganyo_db | gzip > /opt/engganyo-project/backups/daily/engganyo_db_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz && find /opt/engganyo-project/backups/daily -name "*.sql.gz" -mtime +7 -delete >> /opt/engganyo-project/backups/backup.log 2>&1

# Save and exit
```

### Weekly Backup Cron Job

```bash
# Add weekly backup (Sundays at 4:00 AM UTC)
0 4 * * 0 mkdir -p /opt/engganyo-project/backups/weekly && cd /opt/engganyo-project && /usr/bin/docker-compose exec -T postgres pg_dump -U engganyo engganyo_db | gzip > /opt/engganyo-project/backups/weekly/engganyo_db_week_$(date +\%Y\%m\%d).sql.gz && find /opt/engganyo-project/backups/weekly -name "*.sql.gz" -mtime +28 -delete >> /opt/engganyo-project/backups/backup.log 2>&1
```

### Monthly Backup Cron Job

```bash
# Add monthly backup (1st of month at 5:00 AM UTC)
0 5 1 * * mkdir -p /opt/engganyo-project/backups/monthly && cd /opt/engganyo-project && /usr/bin/docker-compose exec -T postgres pg_dump -U engganyo engganyo_db | gzip > /opt/engganyo-project/backups/monthly/engganyo_db_month_$(date +\%Y\%m).sql.gz && find /opt/engganyo-project/backups/monthly -name "*.sql.gz" -mtime +90 -delete >> /opt/engganyo-project/backups/backup.log 2>&1
```

### Safe Backup Timing

**Recommended backup schedule**:
- **Daily**: 3:00 AM UTC (lowest traffic period)
- **Weekly**: Sunday 4:00 AM UTC
- **Monthly**: 1st of month 5:00 AM UTC

**Avoid backing up during**:
- Active deployment (auto-deploy.sh runs `docker-compose down`)
- Prisma migrations (database schema changes)
- High-traffic periods

### Log Output Strategy

Backup logs are written to `/opt/engganyo-project/backups/backup.log`

```bash
# View backup logs
tail -f /opt/engganyo-project/backups/backup.log

# Check last backup status
tail -20 /opt/engganyo-project/backups/backup.log
```

---

## Disaster Recovery

### Full PostgreSQL Restore

```bash
# Stop application services (keeps PostgreSQL running)
docker-compose stop api web nginx

# Restore from backup
gunzip -c /opt/engganyo-project/backups/daily/engganyo_db_20260521_030000.sql.gz | docker-compose exec -T postgres psql -U engganyo -d engganyo_db

# Restart application services
docker-compose start api web nginx

# Verify services are running
docker-compose ps
```

### Restoring Uploads Directory

**Current status**: Uploads ARE persisted via Docker volume `engganyo_uploads` (mounted at `/app/uploads` in API container). The volume persists across container rebuilds.

**If volume is corrupted or lost**:

```bash
# Check if volume exists
docker volume ls | grep engganyo_uploads

# If volume exists but data is corrupted, restore from backup (if you have off-site backup)
# Currently, there is NO automated off-site backup for uploads - this is a gap

# Recommended: Add rsync to remote storage for uploads backup
# (See Future Recommendations below)
```

### Restoring Docker Services

```bash
# If all containers are down
cd /opt/engganyo-project

# Start infrastructure services
docker-compose up -d postgres redis

# Wait for services to be healthy
sleep 10

# Start application services
docker-compose up -d api web nginx

# Verify services
docker-compose ps
```

### Restore Order

**Recommended restore sequence**:
1. Stop application services (`docker-compose stop api web nginx`)
2. Restore PostgreSQL database from backup
3. Verify database integrity (`docker-compose exec postgres psql -U engganyo -d engganyo_db -c "\dt"`)
4. Start application services (`docker-compose start api web nginx`)
5. Verify application functionality
6. Check logs for errors (`docker-compose logs -f api web`)

### Verification Steps After Restore

```bash
# 1. Check database tables exist
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "\dt"

# 2. Check user count
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "SELECT COUNT(*) FROM \"User\";"

# 3. Check wallet balances
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "SELECT COUNT(*) FROM Wallet;"

# 4. Check API is responding
curl -f https://engganyo.com/api/v1/health || echo "API not responding"

# 5. Check web is responding
curl -f https://engganyo.com || echo "Web not responding"

# 6. Check container logs
docker-compose logs api web nginx
```

---

## Uploads Persistence Status

### Current Implementation

**Uploads ARE persisted via Docker volume**:
- Volume name: `engganyo_uploads`
- Mount point: `/app/uploads` in API container
- Docker Compose configuration: `uploads_data:/app/uploads` (line 64 in docker-compose.yml)
- Persistence: Volume persists across container rebuilds and restarts

### Verification

```bash
# Check volume exists
docker volume ls | grep engganyo_uploads

# Check volume details
docker volume inspect engganyo_uploads

# Check uploads directory in container
docker-compose exec api ls -la /app/uploads
```

### Current Risk

**LOW RISK**: Uploads are persisted via Docker volume and will survive:
- Container restarts
- Container rebuilds
- Service restarts
- Auto-deploy script execution

**MEDIUM RISK**: Uploads will be lost if:
- Docker volume is manually deleted (`docker volume rm engganyo_uploads`)
- VPS suffers catastrophic disk failure
- Volume corruption occurs

**NO OFF-SITE BACKUP**: Currently, uploads are NOT backed up to external storage. This is a gap for disaster recovery.

### Recommended Future Fix

Add off-site backup for uploads directory:

```bash
# Example: rsync uploads to remote storage (not yet implemented)
# This would require:
# 1. Remote storage service (S3, Backblaze B2, or remote VPS)
# 2. rsync or rclone configuration
# 3. Cron job for periodic sync
# 4. Encryption for sensitive uploads
```

---

## Operational Safety Notes

### Testing Restores Periodically

**Recommended**: Test restore process monthly

```bash
# Monthly restore test procedure:
# 1. Take a fresh backup
docker-compose exec -T postgres pg_dump -U engganyo engganyo_db | gzip > /opt/engganyo-project/backups/test_restore_$(date +%Y%m%d).sql.gz

# 2. Create test database
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "CREATE DATABASE engganyo_test_restore;"

# 3. Restore to test database
gunzip -c /opt/engganyo-project/backups/test_restore_$(date +%Y%m%d).sql.gz | docker-compose exec -T postgres psql -U engganyo -d engganyo_test_restore

# 4. Verify data integrity
docker-compose exec -T postgres psql -U engganyo -d engganyo_test_restore -c "SELECT COUNT(*) FROM \"User\";"

# 5. Drop test database
docker-compose exec -T postgres psql -U engganyo -d engganyo_db -c "DROP DATABASE engganyo_test_restore;"

# 6. Document results in backup log
echo "$(date): Monthly restore test completed successfully" >> /opt/engganyo-project/backups/backup.log
```

### Verifying Backup Integrity

```bash
# Check backup file size (should be > 0)
ls -lh /opt/engganyo-project/backups/daily/

# Verify backup is valid gzip file
gunzip -t /opt/engganyo-project/backups/daily/engganyo_db_20260521_030000.sql.gz

# Check backup content (first few lines)
gunzip -c /opt/engganyo-project/backups/daily/engganyo_db_20260521_030000.sql.gz | head -20
```

### Off-Site Backup Recommendations

**Current status**: No off-site backup configured

**Recommended**: Add off-site backup for disaster recovery

**Options**:
1. **S3-compatible storage** (AWS S3, DigitalOcean Spaces, Wasabi)
2. **Backblaze B2** (cost-effective object storage)
3. **Remote VPS** (rsync to backup server)
4. **GitHub Actions artifact** (for smaller databases)

**Example cron job for S3 sync** (requires AWS CLI setup):
```bash
# Install AWS CLI
sudo apt install awscli

# Configure AWS credentials
aws configure

# Sync backups to S3 (not yet implemented)
# 0 6 * * * aws s3 sync /opt/engganyo-project/backups/ s3://engganyo-backups/ --delete >> /opt/engganyo-project/backups/s3-sync.log 2>&1
```

### Disk Space Monitoring

```bash
# Check disk space
df -h

# Check backup directory size
du -sh /opt/engganyo-project/backups/

# Set up disk space alert (add to crontab)
# Alert if disk usage > 80%
0 */6 * * * df -h | awk '$5 > 80 {print "Disk usage warning: " $0}' | mail -s "Disk space alert" admin@engganyo.com
```

### Avoiding Backup During Migrations

**Risk**: Backing up during Prisma migrations can capture inconsistent database state

**Mitigation**:
1. Schedule backups outside of deployment windows
2. Auto-deploy.sh runs migrations after `docker-compose up -d --build`
3. Avoid running manual backups during deployment
4. Check deployment log before running manual backup

**Recommended**: Run backups at least 1 hour after any deployment

```bash
# Check last deployment time
tail -20 /opt/engganyo-project/auto-deploy.log

# If recent deployment, wait before manual backup
```

---

## Future Recommendations

### High Priority
1. **Add off-site backup for PostgreSQL**: Use S3, Backblaze B2, or remote VPS
2. **Add off-site backup for uploads**: Sync `engganyo_uploads` volume to remote storage
3. **Add backup monitoring**: Alert on backup failure, disk space issues
4. **Add automated restore testing**: Monthly restore test with automated verification

### Medium Priority
1. **Add point-in-time recovery**: Configure PostgreSQL WAL archiving
2. **Add backup encryption**: Encrypt backups before off-site sync
3. **Add backup compression optimization**: Use pg_dump custom format for faster restores
4. **Add multi-region backup**: Store backups in different geographic region

### Low Priority
1. **Add backup dashboard**: Web UI for backup status monitoring
2. **Add one-click restore**: Scripted restore with confirmation
3. **Add backup retention policies per environment**: Different policies for dev/staging/prod
4. **Add backup cost optimization**: Lifecycle policies for off-site storage

---
