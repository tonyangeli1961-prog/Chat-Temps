# Trailer Temperature V3 — Production Deployment

## Target
Railway + PostgreSQL + HTTPS + Android client + browser admin portal.

### Railway services
Create PostgreSQL and API services. The API is built from `server/Dockerfile`; the Railway service root directory should be `server`.

### Secure secrets
Set Railway service variables for `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_INITIALS`, `CORS_ORIGIN`, `PGSSL=true`, and the PostgreSQL `DATABASE_URL` reference. Never commit secrets.

### HTTPS
Use the Railway-generated HTTPS domain or a custom HTTPS domain for the API. The Android client must use HTTPS in production.

### PostgreSQL backups
Use Railway's managed PostgreSQL backup capability and periodically test restores. The optional `backup.sh` is for a separately configured backup worker/storage destination.

### Temperature rules
- Freezer: -10°F through 10°F
- Cooler: 34°F through 40°F

### Admin portal
The API serves the browser dashboard at `/`. It provides inspection counts, out-of-range reporting, inspection history, Excel export, operator account management, and fixed standards display.
