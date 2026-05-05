local ffi   = require "ffi"
local cjson = require "cjson"

ffi.cdef[[
    typedef struct evp_md_st EVP_MD;
    const EVP_MD *EVP_sha256(void);
    unsigned char *HMAC(const EVP_MD *evp_md,
                        const void *key,       int key_len,
                        const unsigned char *d, size_t n,
                        unsigned char *md,     unsigned int *md_len);
]]

local C       = ffi.load("crypto")
local _sha256 = C.EVP_sha256()
local SECRET  = os.getenv("JWT_SECRET") or "dev-secret-change-in-production"

local function hmac_sha256(data)
    local md  = ffi.new("unsigned char[32]")
    local len = ffi.new("unsigned int[1]")
    C.HMAC(_sha256, SECRET, #SECRET, data, #data, md, len)
    return ffi.string(md, 32)
end

-- ── Base64url helpers ─────────────────────────────────────────────────────────
local function b64url_decode(s)
    s = s:gsub('-', '+'):gsub('_', '/')
    local pad = (4 - #s % 4) % 4
    return ngx.decode_base64(s .. string.rep('=', pad))
end

local function b64url_encode(bytes)
    return ngx.encode_base64(bytes):gsub('+', '-'):gsub('/', '_'):gsub('=', '')
end

-- ── Token extraction ──────────────────────────────────────────────────────────
local function get_token()
    local auth = ngx.req.get_headers()["Authorization"] or ""
    if auth:sub(1, 7) == "Bearer " then
        return auth:sub(8)
    end
    return ngx.var.cookie_auth_token
end

-- ── Main validation handler ───────────────────────────────────────────────────
local _M = {}

function _M.validate()
    local token = get_token()
    if not token or token == "" then
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
        return
    end

    local header_b64, payload_b64, sig_b64 =
        token:match("^([^.]+)%.([^.]+)%.([^.]+)$")
    if not header_b64 then
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
        return
    end

    if b64url_encode(hmac_sha256(header_b64 .. "." .. payload_b64)) ~= sig_b64 then
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
        return
    end

    local raw = b64url_decode(payload_b64)
    if not raw then
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
        return
    end

    local ok, payload = pcall(cjson.decode, raw)
    if not ok or type(payload) ~= "table" then
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
        return
    end

    if payload.exp and payload.exp < ngx.time() then
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
        return
    end

    -- Inject claims as upstream request headers (access phase — sets headers
    -- on the request that nginx then proxies to Node.js)
    ngx.req.set_header("X-User-Login", payload.sub  or "")
    ngx.req.set_header("X-User-Name",  payload.name or "")
    ngx.req.set_header("X-User-Role",  payload.role or "")
end

return _M
