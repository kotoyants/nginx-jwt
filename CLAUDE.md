# JWT Auth Test Stand

Minimal test stand for JWT-based authentication and access control at the NGINX level.

## Stack

- **Node.js v22** — Express app (auth logic, protected pages)
- **NGINX 1.27 + LuaJIT** — reverse proxy with compiled `ngx_http_lua_module` for JWT validation
- **Docker / Docker Compose** — single-command deployment

## Project Structure

```
.
├── src/index.js          # Express app — all endpoints and HTML templates
├── nginx/
│   ├── Dockerfile        # Multi-stage: builds ngx_http_lua_module + cjson against custom LuaJIT
│   ├── lua/jwt.lua       # Lua script: HMAC-SHA256 JWT validation via LuaJIT FFI (runs in NGINX)
│   └── jwt.js            # Legacy njs version (kept for reference)
├── nginx.conf            # NGINX config: routing, access_by_lua_block, rate limiting
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

## Auth Flow

```
Browser → NGINX
           ├─ public paths (/auth-page, /login, /logout) → proxy to Node.js
           └─ protected paths (everything else via location /)
                  ├─ access_by_lua_block: jwt.validate()  ← LuaJIT FFI + OpenSSL HMAC, no Node.js hop
                  │       ├─ invalid/expired token → ngx.exit(401)
                  │       └─ valid → ngx.req.set_header(X-User-Login / X-User-Name / X-User-Role)
                  └─ proxy to Node.js (reads X-User-* headers injected by Lua)
```

JWT is validated entirely inside NGINX via **LuaJIT FFI** calling OpenSSL's `HMAC()`. Node.js never receives unvalidated requests — it only reads the `X-User-*` headers that NGINX injects after a successful check.

**Why `access_by_lua_block` instead of `auth_request` + `content_by_lua_block`:**
The `$upstream_http_*` variables used by `auth_request_set` are only populated from `proxy_pass` upstream connections. A `content_by_lua_block` handler generates the response locally, so its response headers never reach `r->upstream->headers_in`. Using `access_by_lua_block` with `ngx.req.set_header()` injects directly into the request that gets proxied upstream — the correct approach.

## Token Storage

JWT is stored as an **HttpOnly cookie** (`auth_token`). The Lua handler reads it via `ngx.var.cookie_auth_token`. Bearer token in `Authorization` header is also accepted (checked first).

## Hardcoded Users

| Login | Password | Role |
|-------|----------|------|
| `admin` | `admin123` | admin |
| `user` | `user123` | user |

Defined in `src/index.js` — `USERS` constant at the top of the file.

## NGINX Key Config Points

- `load_module /usr/lib/nginx/modules/ndk_http_module.so` — ngx_devel_kit (required by lua module)
- `load_module /usr/lib/nginx/modules/ngx_http_lua_module.so` — Lua module (LuaJIT statically linked)
- `env JWT_SECRET` — exposes env var to Lua (`os.getenv("JWT_SECRET")`)
- `lua_package_path "/etc/nginx/lua/?.lua;;"` — Lua module search path
- `lua_package_cpath "/etc/nginx/lua/?.so;;"` — Lua C extension search path (cjson.so)
- `limit_req_zone` — rate limiting zone (10 req/min, applied to `/auth-page` and `/login`)
- `location / { access_by_lua_block { require("jwt").validate() } }` — catch-all protected block

## Lua JWT Validation (nginx/lua/jwt.lua)

Validates HS256 tokens without a Node.js roundtrip using LuaJIT FFI + OpenSSL:
1. Extracts token from `Authorization: Bearer` header or `auth_token` cookie
2. Calls `HMAC(EVP_sha256(), ...)` via FFI to recompute signature
3. Compares base64url-encoded result with token signature
4. Checks `exp` claim for expiry
5. On success: `ngx.req.set_header("X-User-Login/Name/Role", ...)` → proxied to Node.js
6. On failure: `ngx.exit(ngx.HTTP_UNAUTHORIZED)`

`EVP_sha256()` and the SECRET are computed once at module load, cached per worker.

## NGINX Module Build (nginx/Dockerfile)

Multi-stage build on `nginx:1.27-alpine`:
1. **Builder stage** — clones OpenResty's `luajit2` fork (FFI-enabled), builds as static library with `XCFLAGS="-fPIC"`. Alpine's packaged `luajit` has `LUAJIT_DISABLE_FFI` set; the custom build is required.
2. Compiles `ngx_devel_kit` + `lua-nginx-module` as dynamic modules using `nginx -V` configure args + `eval` (needed because args contain single-quoted `--with-cc-opt='...'` strings).
3. Compiles `lua-cjson` C extension.
4. Clones `lua-resty-core` + `lua-resty-lrucache` (required at init time by recent `lua-nginx-module`).
5. **Runtime stage** — copies modules, Lua files, adds `libgcc` (GCC C++ ABI) and `libcrypto.so` symlink (Alpine only ships `libcrypto.so.3`).

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

# Reload NGINX config without restart (does NOT reload jwt.lua — requires rebuild)
docker compose exec nginx nginx -s reload

# Test JWT manually
TOKEN=$(curl -s -X POST http://localhost:8000/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin123"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/profile

# Test cookie auth
curl --cookie "auth_token=$TOKEN" http://localhost:8000/server
```
