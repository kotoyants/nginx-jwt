# nginx-jwt

Minimal test stand for JWT-based authentication at the NGINX level using LuaJIT FFI + OpenSSL. Token validation happens entirely inside NGINX — Node.js only receives pre-validated requests with injected `X-User-*` headers.

## Auth Flow

```
Browser / curl
     │
     ▼
  NGINX :8000
     │
     ├─ POST /login, GET /auth-page, GET /logout ──────────────────► Node.js :3000
     │   (public — no auth check)                                         │
     │                                                                     ▼
     │                                                              returns JWT token
     │                                                          sets auth_token cookie
     │
     └─ GET /profile, GET /server, GET /* (protected)
          │
          ▼
     access_by_lua_block
          │
          ├─ read token from Authorization: Bearer header
          │  or auth_token cookie
          │
          ├─ HMAC-SHA256 via LuaJIT FFI → OpenSSL
          │  recompute signature, compare with token
          │
          ├─ check exp claim
          │
          ├─ [FAIL] → 401 Unauthorized (Node.js never reached)
          │
          └─ [OK] → set X-User-Login / X-User-Name / X-User-Role headers
                         │
                         ▼
                    proxy_pass → Node.js :3000
                    (reads X-User-* headers, renders page)
```

## Quick Start

```bash
cp .env.example .env          # set JWT_SECRET (optional, has dev default)
docker compose up --build
```

App: `http://localhost:8000`  
Node.js direct (bypasses NGINX auth): `http://localhost:3000`

## Endpoints

| Path | Auth | Description |
|------|------|-------------|
| `GET /` | No | Redirects to `/auth-page` |
| `GET /auth-page` | No | Login form (rate limited) |
| `POST /login` | No | Returns JWT + sets `auth_token` cookie (rate limited) |
| `GET /logout` | No | Clears cookie, redirects to `/auth-page` |
| `GET /profile` | Yes | Shows user claims from token |
| `GET /server` | Yes | Shows Node.js version and process info |

## Users

| Login | Password | Role |
|-------|----------|------|
| `admin` | `admin123` | admin |
| `user` | `user123` | user |

## Example Requests

### Login and get a token

```bash
# Login as admin
TOKEN=$(curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin123"}' | jq -r .token)

echo $TOKEN
```

```bash
# Login as regular user
TOKEN=$(curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"user","password":"user123"}' | jq -r .token)
```

### Access protected routes

```bash
# Bearer token in Authorization header
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/profile

# Bearer token — server info page
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/server
```

```bash
# Cookie-based auth (simulates browser session)
curl --cookie "auth_token=$TOKEN" http://localhost:8000/profile
```

### Error cases

```bash
# No token → 401
curl -i http://localhost:8000/profile

# Wrong credentials → 401
curl -i -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"wrong"}'

# Tampered token → 401
curl -i -H "Authorization: Bearer ${TOKEN}x" http://localhost:8000/profile
```

### Full login → profile flow (one-liner)

```bash
curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin123"}' \
  | jq -r .token \
  | xargs -I{} curl -s -H "Authorization: Bearer {}" http://localhost:8000/profile
```

## Useful Commands

```bash
# View logs
docker compose logs -f
docker logs test-app-1        # Node.js access log
docker logs test-nginx-1      # NGINX access + error log

# Reload NGINX config (does NOT reload jwt.lua — requires rebuild)
docker compose exec nginx nginx -s reload
```
