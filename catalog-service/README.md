# Catalog Service

Event catalog microservice with MongoDB Replica Set (3 nodes). Handles CRUD for events with automatic read-only fallback when the replica set loses quorum.

## Stack

- **Runtime**: Node.js 20 + Express
- **Database**: MongoDB 7.0 Replica Set (1 Primary + 2 Secondary)
- **API Gateway**: Traefik (labels pre-configured)

## Quick Start

```bash
# 1. Start all containers (MongoDB RS + Catalog Service)
docker compose up -d

# 2. Wait ~10s for replica set to initialize, then verify
curl http://localhost:3001/health

# Expected response:
# { "status": "ok", "db": { "state": "connected", "readOnly": false } }
```

## API Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| GET | `/health` | Service health + RS status | No |
| GET | `/events` | List events (supports `?category=concert&upcoming=true&page=1&limit=20`) | No |
| GET | `/events/:id` | Get single event | No |
| POST | `/events` | Create event | Yes (JWT) |
| PUT | `/events/:id` | Replace event | Yes (JWT) |
| PATCH | `/events/:id` | Update event fields | Yes (JWT) |
| DELETE | `/events/:id` | Delete event | Yes (JWT) |
| POST | `/events/:id/reserve` | Reserve seats (internal, called by Booking Service) | No |

### Create Event — Request Body

```json
{
  "title": "Rock Concert",
  "description": "Optional description",
  "date": "2025-12-31T20:00:00Z",
  "location": "Kyiv Palace of Sport",
  "totalSeats": 500,
  "price": 750.00,
  "category": "concert"
}
```

**Categories**: `concert`, `conference`, `sport`, `theater`, `festival`, `other`

### Reserve Seats — Request Body (Booking Service → Catalog)

```json
{ "quantity": 2 }
```

Returns `409 Conflict` if not enough seats are available.

## Read-Only Mode

When MongoDB loses quorum (Primary + one Secondary are down), the service automatically enters read-only mode:

- `GET` requests continue to work normally
- `POST / PUT / PATCH / DELETE` return `503 Service Unavailable` with a clear message:

```json
{
  "error": "Service Unavailable",
  "message": "The catalog is currently in read-only mode...",
  "readOnly": true
}
```

The `/health` endpoint reports `"readOnly": true` in this state.

## Replica Set Configuration

```
rs0
├── mongo-primary:27017    priority: 2  (preferred primary)
├── mongo-secondary1:27017 priority: 1
└── mongo-secondary2:27017 priority: 1
```

**Quorum**: 2 of 3 votes required. Losing 2 nodes → no election possible → read-only.

### Manual RS inspection

```bash
# Check replica set status
docker exec mongo-primary mongosh --eval "rs.status()"

# Watch oplog
docker exec mongo-primary mongosh --eval "rs.printReplicationInfo()"

# Check replication lag
docker exec mongo-primary mongosh --eval "rs.printSecondaryReplicationInfo()"
```

## Defense Demo Scenarios

All demos are scripted in `catalog-chaos.sh`:

```bash
# Show current RS state
./catalog-chaos.sh status

# Demo 1: Primary failover → election
./catalog-chaos.sh election

# Demo 2: Kill 2 nodes → read-only mode
./catalog-chaos.sh readonly

# Demo 3: Oplog sync after secondary recovery
./catalog-chaos.sh oplog

# All scenarios (interactive)
./catalog-chaos.sh all
```

### What each demo shows

**Election demo**:
1. Kill `mongo-primary`
2. One secondary wins election and becomes primary in ~3-5s
3. `GET /events` and `POST /events` still work — service never noticed

**Read-only demo**:
1. Kill `mongo-primary` + `mongo-secondary1`
2. `GET /events` still returns data (reads from surviving secondary)
3. `POST /events` returns `503` with a user-friendly error
4. `/health` shows `"readOnly": true`
5. Restore both nodes → service auto-recovers

**Oplog sync demo**:
1. Kill `mongo-secondary2`
2. Create 3 events while it's down
3. Restart `mongo-secondary2`
4. Query it directly — it has all 3 new events (caught up via oplog)

## Integration with Other Services

### Booking Service calls this service

```
POST /events/:id/reserve
Body: { "quantity": 1 }
```

No auth required (service-to-service internal call).

### Auth middleware

Write endpoints forward the JWT Bearer token to `http://auth-service:3000/validate`. Set `AUTH_SERVICE_URL` env var to override. Falls back gracefully if Auth Service is down (reads still allowed).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `MONGO_URI` | replica set URI | Full MongoDB connection string |
| `AUTH_SERVICE_URL` | `http://auth-service:3000` | Auth Service base URL |
| `NODE_ENV` | `development` | Node environment |

## Integration into Project docker-compose.yml (Person 1)

Add these services to the root `docker-compose.yml`:

```yaml
# Copy the mongo-primary, mongo-secondary1, mongo-secondary2,
# mongo-rs-init, and catalog-service services from
# catalog-service/docker-compose.yml into the root compose file.
# Ensure all services share the same network (app-net).
```

The Traefik labels on `catalog-service` are already set — routes `/events` automatically.
