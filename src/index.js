'use strict';

const express      = require('express');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const os           = require('os');

const app        = express();
const PORT       = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const USERS = {
  admin: { password: 'admin123', role: 'admin', name: 'Administrator' },
  user:  { password: 'user123',  role: 'user',  name: 'Regular User'  },
};

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Access log ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const ip    = req.ip || req.socket.remoteAddress;

  res.on('finish', () => {
    const ms      = Date.now() - start;
    const color   = res.statusCode >= 500 ? 31
                  : res.statusCode >= 400 ? 33
                  : res.statusCode >= 300 ? 36
                  : 32;
    const status  = `\x1b[${color}m${res.statusCode}\x1b[0m`;
    const ts      = new Date().toISOString();
    console.log(`${ts} ${req.method} ${req.path} ${status} ${ms}ms - ${ip}`);
  });

  next();
});

// ── POST /login ───────────────────────────────────────────────────────────────
app.post('/login', (req, res) => {
  const { login, password } = req.body ?? {};
  const user = USERS[login];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid login or password' });
  }

  const token = jwt.sign(
    { sub: login, name: user.name, role: user.role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   3600 * 1000,
    // secure: true — enable when switching to HTTPS
  });

  return res.json({ token, user: { login, name: user.name, role: user.role } });
});

// ── GET /logout ───────────────────────────────────────────────────────────────
app.get('/logout', (_req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/auth-page');
});

// ── GET /auth-page ────────────────────────────────────────────────────────────
app.get('/auth-page', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(AUTH_PAGE_HTML);
});

// ── GET /validate  (internal — called only via NGINX auth_request) ────────────
app.get('/validate', (req, res) => {
  const token =
    extractBearer(req.headers['authorization']) ||
    req.cookies?.auth_token ||
    null;

  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    res.setHeader('X-User-Login', decoded.sub);
    res.setHeader('X-User-Name',  decoded.name);
    res.setHeader('X-User-Role',  decoded.role);
    return res.sendStatus(200);
  } catch {
    return res.sendStatus(401);
  }
});

// ── GET /profile  (protected via NGINX auth_request) ─────────────────────────
app.get('/profile', (req, res) => {
  const login = req.headers['x-user-login'] || 'unknown';
  const name  = req.headers['x-user-name']  || 'Unknown';
  const role  = req.headers['x-user-role']  || 'unknown';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(profilePage(login, name, role));
});

// ── GET /server  (protected via NGINX auth_request) ──────────────────────────
app.get('/server', (req, res) => {
  const login = req.headers['x-user-login'] || 'unknown';

  const mem = process.memoryUsage();
  const mb  = v => (v / 1024 / 1024).toFixed(1) + ' MB';

  const info = {
    nodeVersion: process.version,
    platform:    process.platform,
    arch:        process.arch,
    uptime:      formatUptime(process.uptime()),
    hostname:    os.hostname(),
    memory: {
      rss:       mb(mem.rss),
      heapUsed:  mb(mem.heapUsed),
      heapTotal: mb(mem.heapTotal),
    },
  };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(serverPage(login, info));
});

// ── helpers ───────────────────────────────────────────────────────────────────
function extractBearer(header) {
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML templates ────────────────────────────────────────────────────────────
const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .card {
    background: #1e293b;
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  h1 { font-size: 1.4rem; margin-bottom: 1.5rem; color: #f8fafc; }
  h2 { font-size: .8rem; color: #64748b; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .75rem; }
  .field { margin-bottom: 1rem; }
  label { display: block; font-size: .85rem; color: #94a3b8; margin-bottom: .4rem; }
  input[type=text], input[type=password] {
    width: 100%;
    padding: .6rem .85rem;
    border-radius: 8px;
    border: 1px solid #334155;
    background: #0f172a;
    color: #f1f5f9;
    font-size: 1rem;
    outline: none;
    transition: border-color .15s;
  }
  input:focus { border-color: #6366f1; }
  .btn {
    width: 100%;
    padding: .7rem 1rem;
    border-radius: 8px;
    border: none;
    background: #6366f1;
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: .5rem;
    transition: background .15s;
  }
  .btn:hover { background: #4f46e5; }
  .error { color: #f87171; font-size: .85rem; margin-top: .75rem; min-height: 1.2em; }
  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: .55rem 0;
    border-bottom: 1px solid #1e3a5f22;
    font-size: .9rem;
  }
  .info-row:last-child { border-bottom: none; }
  .lbl { color: #64748b; }
  .val { color: #a5f3fc; font-weight: 500; font-family: monospace; }
  .badge {
    display: inline-block;
    padding: .2rem .65rem;
    border-radius: 999px;
    font-size: .75rem;
    font-weight: 700;
    letter-spacing: .03em;
  }
  .badge-admin { background: #4c1d95; color: #ddd6fe; }
  .badge-user  { background: #0c4a6e; color: #bae6fd; }
  .nav {
    display: flex;
    gap: .5rem;
    margin-bottom: 1.75rem;
    flex-wrap: wrap;
  }
  .nav a {
    color: #94a3b8;
    text-decoration: none;
    font-size: .8rem;
    padding: .3rem .75rem;
    border-radius: 6px;
    border: 1px solid #334155;
    transition: background .15s, color .15s;
  }
  .nav a:hover, .nav a.active { background: #334155; color: #f1f5f9; }
  .nav a.danger { color: #f87171; border-color: #7f1d1d; }
  .nav a.danger:hover { background: #450a0a; }
  .section { margin-bottom: 1.5rem; }
  .section:last-child { margin-bottom: 0; }
  .divider { border: none; border-top: 1px solid #334155; margin: 1.25rem 0; }
`;

const AUTH_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign In</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="card">
  <h1>Sign In</h1>
  <div class="field">
    <label for="login">Login</label>
    <input id="login" type="text" placeholder="admin or user" autocomplete="username" autofocus>
  </div>
  <div class="field">
    <label for="password">Password</label>
    <input id="password" type="password" placeholder="••••••••" autocomplete="current-password">
  </div>
  <button class="btn" id="btn">Sign In</button>
  <div class="error" id="error" role="alert"></div>
</div>
<script>
const loginEl = document.getElementById('login');
const passEl  = document.getElementById('password');
const btnEl   = document.getElementById('btn');
const errEl   = document.getElementById('error');

async function doLogin() {
  errEl.textContent = '';
  const login    = loginEl.value.trim();
  const password = passEl.value;

  if (!login || !password) {
    errEl.textContent = 'Please fill in all fields';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Signing in…';

  try {
    const res  = await fetch('/login', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ login, password }),
      credentials: 'same-origin',
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Authentication error';
      return;
    }

    window.location.href = '/profile';
  } catch {
    errEl.textContent = 'Network error. Please try again.';
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Sign In';
  }
}

btnEl.addEventListener('click', doLogin);
[loginEl, passEl].forEach(el =>
  el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
);
</script>
</body>
</html>`;

function profilePage(login, name, role) {
  const badgeClass = role === 'admin' ? 'badge-admin' : 'badge-user';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Profile — ${esc(name)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="card">
  <nav class="nav">
    <a href="/profile" class="active">Profile</a>
    <a href="/server">Server</a>
    <a href="/logout" class="danger">Sign Out</a>
  </nav>
  <h1>User Profile</h1>
  <div class="section">
    <h2>Account</h2>
    <div class="info-row">
      <span class="lbl">Login</span>
      <span class="val">${esc(login)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Name</span>
      <span class="val">${esc(name)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Role</span>
      <span class="val"><span class="badge ${badgeClass}">${esc(role)}</span></span>
    </div>
  </div>
  <hr class="divider">
  <div class="section">
    <h2>Security</h2>
    <div class="info-row">
      <span class="lbl">Token Algorithm</span>
      <span class="val">HS256 / JWT</span>
    </div>
    <div class="info-row">
      <span class="lbl">Storage</span>
      <span class="val">HttpOnly cookie</span>
    </div>
    <div class="info-row">
      <span class="lbl">Validation</span>
      <span class="val">NGINX auth_request</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function serverPage(login, info) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Info</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="card">
  <nav class="nav">
    <a href="/profile">Profile</a>
    <a href="/server" class="active">Server</a>
    <a href="/logout" class="danger">Sign Out</a>
  </nav>
  <h1>Server Info</h1>
  <div class="section">
    <h2>Node.js</h2>
    <div class="info-row">
      <span class="lbl">Version</span>
      <span class="val">${esc(info.nodeVersion)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Platform</span>
      <span class="val">${esc(info.platform)} / ${esc(info.arch)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Uptime</span>
      <span class="val">${esc(info.uptime)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Host</span>
      <span class="val">${esc(info.hostname)}</span>
    </div>
  </div>
  <hr class="divider">
  <div class="section">
    <h2>Memory</h2>
    <div class="info-row">
      <span class="lbl">RSS</span>
      <span class="val">${esc(info.memory.rss)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Heap Used</span>
      <span class="val">${esc(info.memory.heapUsed)}</span>
    </div>
    <div class="info-row">
      <span class="lbl">Heap Total</span>
      <span class="val">${esc(info.memory.heapTotal)}</span>
    </div>
  </div>
  <hr class="divider">
  <div class="section">
    <h2>Request From</h2>
    <div class="info-row">
      <span class="lbl">Login</span>
      <span class="val">${esc(login)}</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JWT auth test stand listening on :${PORT}`);
});
