var http = require('http');
var http2 = require('@jsh/http');
var { WebSocketServer } = require('ws');
var { createWSServer } = require('./ws_server');

function runServer(cfg, port, llmClient, mc, registry) {
  var wsHandler = createWSServer(mc, registry, cfg);
  var neoBase = 'http://' + cfg.machbase.host + ':' + cfg.machbase.port;
  var _proxyClient = http2.NewClient();

  setInterval(function () { wsHandler.reapSessions(); }, 5 * 60 * 1000);

  var server = new http.Server({
    network: 'tcp',
    address: '0.0.0.0:' + port,
  });

  // --- Relay helpers ---

  var _jwtToken = '';
  var _jwtExp = 0;

  function authHeaders() {
    if (!cfg.machbase.user) return {};
    if (_jwtToken && Date.now() < _jwtExp) return { 'Authorization': 'Bearer ' + _jwtToken };
    // login synchronously
    try {
      var payload = JSON.stringify({ loginName: cfg.machbase.user, password: cfg.machbase.password });
      var req = http2.NewRequest('POST', neoBase + '/web/api/login');
      req.header.set('Content-Type', 'application/json');
      req.writeString(payload);
      var resp = _proxyClient.do(req);
      var body = resp.string();
      var result = JSON.parse(body);
      if (result.success) {
        _jwtToken = result.accessToken;
        _jwtExp = Date.now() + 5 * 60 * 1000;
        return { 'Authorization': 'Bearer ' + _jwtToken };
      }
    } catch (e) {
      console.println('[Server] JWT login failed: ' + e.message);
    }
    return {};
  }

  function copyResponse(ctx, resp) {
    // Copy response headers
    var headers = resp.headers || {};
    var headerKeys = Object.keys(headers);
    for (var i = 0; i < headerKeys.length; i++) {
      var k = headerKeys[i];
      if (k.toLowerCase() === 'transfer-encoding') continue;
      ctx.setHeader(k, headers[k]);
    }
    ctx.response.status(resp.statusCode);
    var text = '';
    try { text = resp.string(); } catch (e) { /* empty */ }
    ctx.response.write(text);
  }

  function relayError(ctx, route, err) {
    console.println('[Server] proxy ' + route + ' failed: ' + err.message);
    ctx.json(502, { error: 'relay failed: ' + err.message });
  }

  // --- Relay routes (proxy to machbase-neo) ---

  // POST /db/tql → machbase-neo /db/tql
  server.post('/db/tql', function (ctx) {
    var qs = ctx.request.queryString;
    var targetURL = neoBase + '/db/tql' + (qs ? '?' + qs : '');
    console.println('[Server] POST /db/tql — relay → ' + targetURL);
    try {
      var body = ctx.request.body;
      var reqBody = (typeof body === 'string') ? body : JSON.stringify(body);
      var req = http2.NewRequest('POST', targetURL);
      req.header.set('Content-Type', ctx.request.header('Content-Type') || 'text/plain');
      if (reqBody) req.writeString(reqBody);
      copyResponse(ctx, _proxyClient.do(req));
    } catch (e) {
      relayError(ctx, '/db/tql', e);
    }
  });

  // GET /web/* → machbase-neo /web/*
  server.get('/web/*path', function (ctx) {
    var path = '/web/' + ctx.param('path');
    var qs = ctx.request.queryString;
    var targetURL = neoBase + path + (qs ? '?' + qs : '');
    console.println('[Server] GET ' + path + ' — relay → ' + targetURL);
    try {
      var req = http2.NewRequest('GET', targetURL);
      // Passthrough client Authorization header
      var clientAuth = ctx.request.getHeader('Authorization');
      if (clientAuth) req.header.set('Authorization', clientAuth);
      // Server JWT auth (overwrites if user configured)
      var auth = authHeaders();
      if (auth['Authorization']) req.header.set('Authorization', auth['Authorization']);
      copyResponse(ctx, _proxyClient.do(req));
    } catch (e) {
      relayError(ctx, path, e);
    }
  });

  // POST /web/* → machbase-neo /web/*
  server.post('/web/*path', function (ctx) {
    var path = '/web/' + ctx.param('path');
    var qs = ctx.request.queryString;
    var targetURL = neoBase + path + (qs ? '?' + qs : '');
    console.println('[Server] POST ' + path + ' — relay → ' + targetURL);
    try {
      var body = ctx.request.body;
      var reqBody = (typeof body === 'string') ? body : JSON.stringify(body);
      var req = http2.NewRequest('POST', targetURL);
      req.header.set('Content-Type', ctx.request.header('Content-Type') || 'application/json');
      // Passthrough client Authorization header
      var clientAuth = ctx.request.getHeader('Authorization');
      if (clientAuth) req.header.set('Authorization', clientAuth);
      // Server JWT auth (overwrites if user configured)
      var auth = authHeaders();
      if (auth['Authorization']) req.header.set('Authorization', auth['Authorization']);
      if (reqBody) req.writeString(reqBody);
      copyResponse(ctx, _proxyClient.do(req));
    } catch (e) {
      relayError(ctx, path, e);
    }
  });

  // --- REST endpoint ---
  server.post('/api/chat', function (ctx) {
    var body = ctx.request.body;
    console.println('[Server] POST /api/chat: ' + JSON.stringify(body).substring(0, 200));

    http.get('http://' + cfg.machbase.host + ':' + cfg.machbase.port + '/db/query?q=select%201', function (resp) {
      console.println('[Server] REST async HTTP callback fired! status=' + resp.statusCode);
      ctx.json(http.status.OK, { ok: true, test: 'async works in REST' });
    });
  });

  // WS for models/control only (no async needed)
  var wss = new WebSocketServer({ server: server, path: '/ws' });

  wss.on('connection', function (socket, request) {
    console.println('[Server] WS client connected from ' + request.remoteAddress);

    socket.on('message', function (event) {
      var raw = (typeof event === 'string') ? event : (event && event.data) ? event.data : String(event);
      wsHandler.handleMessage(socket, raw);
    });

    socket.on('close', function () {
      console.println('[Server] WS client disconnected');
    });
  });

  console.println('[Server] WebSocket server listening on :' + port);
  server.serve();
}

module.exports = { runServer };
