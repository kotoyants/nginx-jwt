# ── Stage 1: compile lua-nginx-module against a custom LuaJIT build ───────────
FROM nginx:1.27-alpine AS builder

RUN apk add --no-cache \
        build-base linux-headers git wget \
        openssl-dev pcre2-dev zlib-dev

# Alpine's luajit package has LUAJIT_DISABLE_FFI set; lua-nginx-module requires
# FFI.  Build OpenResty's LuaJIT2 fork (FFI-enabled) as a static library so
# it can be embedded into ngx_http_lua_module.so with no runtime dependency.
RUN git clone --depth 1 -b v2.1-agentzh \
        https://github.com/openresty/luajit2 /build/luajit_src && \
    cd /build/luajit_src && \
    make -j$(nproc) BUILDMODE=static XCFLAGS="-fPIC" && \
    make install BUILDMODE=static PREFIX=/build/luajit

ENV LUAJIT_LIB=/build/luajit/lib
ENV LUAJIT_INC=/build/luajit/include/luajit-2.1

# Required dependency for lua-nginx-module
RUN git clone --depth 1 https://github.com/vision5/ngx_devel_kit        /build/ndk
# Lua module for nginx
RUN git clone --depth 1 https://github.com/openresty/lua-nginx-module   /build/lua
# cjson (openresty fork, designed for LuaJIT)
RUN git clone --depth 1 https://github.com/openresty/lua-cjson          /build/cjson
# resty.core + lrucache: required at init time by recent lua-nginx-module
RUN git clone --depth 1 https://github.com/openresty/lua-resty-core     /build/resty-core
RUN git clone --depth 1 https://github.com/openresty/lua-resty-lrucache /build/resty-lrucache

# Download the nginx source that matches the installed binary exactly
RUN NGINX_VERSION=$(nginx -v 2>&1 | grep -o '[0-9.]*$') && \
    wget -qO- "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" \
    | tar -xz -C /build && mv /build/nginx-* /build/nginx

# Compile ndk + lua as dynamic modules.  eval is required because nginx -V
# contains --with-cc-opt='...' with single-quoted sub-strings; without eval,
# word splitting turns those inner tokens into bare configure arguments.
RUN CONF=$(nginx -V 2>&1 | sed -n 's/.*configure arguments://p') && \
    cd /build/nginx && \
    eval "./configure $CONF \
        --add-dynamic-module=/build/ndk \
        --add-dynamic-module=/build/lua" && \
    make modules -j$(nproc)

# Compile cjson.so for LuaJIT
RUN cd /build/cjson && \
    make LUA_INCLUDE_DIR="${LUAJIT_INC}" \
         CJSON_CFLAGS="-fPIC"

# ── Stage 2: runtime — standard nginx:1.27-alpine + our compiled modules ──────
FROM nginx:1.27-alpine

# libgcc_s is needed at runtime by ngx_http_lua_module.so (GCC C++ exception ABI)
RUN apk add --no-cache libgcc && \
    ln -sf /usr/lib/libcrypto.so.3 /usr/lib/libcrypto.so

# Nginx dynamic modules (LuaJIT is statically linked into ngx_http_lua_module.so)
COPY --from=builder /build/nginx/objs/ndk_http_module.so      /usr/lib/nginx/modules/
COPY --from=builder /build/nginx/objs/ngx_http_lua_module.so  /usr/lib/nginx/modules/

# cjson C extension and Lua libraries
RUN mkdir -p /etc/nginx/lua
COPY --from=builder /build/cjson/cjson.so          /etc/nginx/lua/cjson.so
COPY --from=builder /build/resty-core/lib/          /etc/nginx/lua/
COPY --from=builder /build/resty-lrucache/lib/      /etc/nginx/lua/
COPY lua/jwt.lua /etc/nginx/lua/jwt.lua
