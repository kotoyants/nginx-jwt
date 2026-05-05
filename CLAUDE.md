# JWT Auth Test Stand

Minimal test stand for JWT-based authentication and access control at the NGINX level.

## Stack

- **Node.js v22** — Express app (auth logic, protected pages)
- **NGINX 1.27** — reverse proxy with njs module for JWT validation
- **Docker / Docker Compose** — single-command deployment

## Project Structure

```
.
├── src/index.js          # Express app — all endpoints and HTML templates
├── nginx/
│   ├── Dockerfile        # nginx:1.27-alpine + nginx-module-njs
│   └── jwt.js            # njs script: HMAC-SHA256 JWT validation (runs in NGINX)
├── nginx.conf            # NGINX config: routing, auth_request, rate limiting
├── Dockerfile            # Node.js app container
├── docker-compose.yml    # Wires app + nginx; exposes :8000
└── .env.example          # JWT_SECRET template
```

## Running

```bash
cp .env.example .env      # set JWT_SECRET (optional, has dev default)
docker compose up --build
```

App is available at `http://localhost:8000`. Node.js app is also directly accessible at `http://localhost:3000` (for debugging only — bypasses NGINX auth).

## Endpoints

| Path | Auth | Description |
|------|------|-------------|
| `GET /` | No | Redirects to `/auth-page` |
| `GET /auth-page` | No | Login form (rate limited) |
| `POST /login` | No | Returns JWT + sets `auth_token` cookie (rate limited) |
| `GET /logout` | No | Clears cookie, redirects to `/auth-page` |
| `GET /profile` | Yes | Shows user claims from token |
| `GET /server` | Yes | Shows Node.js version and process info |
| `GET /validate` | Internal | JWT validation endpoint — NGINX only, blocked externally |

## Auth Flow

```
Browser → NGINX
           ├─ public paths (/auth-page, /login, /logout) → proxy to Node.js
           └─ protected paths (everything else via location /)
                  ├─ auth_request → location /validate (internal)
                  │       └─ js_content jwt.validate  ← njs, no Node.js hop
                  ├─ 200: set X-User-Login / X-User-Name / X-User-Role headers → proxy to Node.js
                  └─ 401: return 401 (see @auth_required)
```

JWT is validated entirely inside NGINX via **njs** (nginx-module-njs). Node.js never receives validation requests — it only reads the `X-User-*` headers that NGINX injects after a successful check.

## Token Storage

JWT is stored as an **HttpOnly cookie** (`auth_token`). NGINX reads it via `$http_cookie` in the `auth_request` subrequest. Bearer token in `Authorization` header is also accepted.

## Hardcoded Users

| Login | Password | Role |
|-------|----------|------|
| `admin` | `admin123` | admin |
| `user` | `user123` | user |

Defined in `src/index.js` — `USERS` constant at the top of the file.

## NGINX Key Config Points

- `load_module modules/ngx_http_js_module.so` — loads njs
- `env JWT_SECRET` — exposes the env var to njs (`process.env.JWT_SECRET`)
- `js_import jwt from /etc/nginx/njs/jwt.js` — imports the validation script
- `limit_req_zone` — rate limiting zone (10 req/min, applied to `/auth-page` and `/login`)
- `location = /validate { internal; js_content jwt.validate; }` — njs handler, not reachable externally
- `location / { auth_request /validate; ... }` — catch-all protected block

## njs JWT Validation (nginx/jwt.js)

Validates HS256 tokens without a Node.js roundtrip:
1. Extracts token from `Authorization: Bearer` header or `auth_token` cookie
2. Recomputes HMAC-SHA256 signature and compares with token signature
3. Checks `exp` claim for expiry
4. On success: sets `X-User-Login`, `X-User-Name`, `X-User-Role` response headers → NGINX passes them to upstream via `auth_request_set` + `proxy_set_header`

njs limitation: array destructuring (`const [a, b] = arr`) is not supported in the Alpine-packaged build — use indexed access (`arr[0]`, `arr[1]`) instead.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `dev-secret-change-in-production` | HMAC signing secret — set in both `app` and `nginx` services |
| `PORT` | `3000` | Node.js listen port (internal) |

## Useful Commands

```bash
# View logs
docker compose logs -f
docker logs test-app-1       # Node.js access log (colored: method path status ms ip)
docker logs test-nginx-1     # NGINX access + error log

# Reload NGINX config without restart
docker compose exec nginx nginx -s reload

# Test JWT manually
TOKEN=$(curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin123"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/profile
```
