var crypto = require('crypto');

var SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function b64urlToB64(s) { return s.replace(/-/g, '+').replace(/_/g, '/'); }
function b64ToB64url(s) { return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }

function validate(r) {
    var token = null;

    var auth = r.headersIn['Authorization'] || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();

    if (!token) {
        var m = (r.headersIn['Cookie'] || '').match(/(?:^|;\s*)auth_token=([^;]+)/);
        if (m) token = m[1];
    }

    if (!token) { r.return(401); return; }

    var parts = token.split('.');
    if (parts.length !== 3) { r.return(401); return; }

    var headerB64  = parts[0];
    var payloadB64 = parts[1];
    var sigB64     = parts[2];

    var expected = b64ToB64url(
        crypto.createHmac('sha256', SECRET)
              .update(headerB64 + '.' + payloadB64)
              .digest('base64')
    );
    if (expected !== sigB64) { r.return(401); return; }

    var payload;
    try {
        payload = JSON.parse(Buffer.from(b64urlToB64(payloadB64), 'base64').toString());
    } catch (e) { r.return(401); return; }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        r.return(401); return;
    }

    r.headersOut['X-User-Login'] = payload.sub  || '';
    r.headersOut['X-User-Name']  = payload.name || '';
    r.headersOut['X-User-Role']  = payload.role || '';
    r.return(200);
}

export default { validate };
