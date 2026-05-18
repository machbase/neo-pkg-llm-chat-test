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
    setCORS(ctx);
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
    setCORS(ctx);
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
      req.header.set('Content-Type', ctx.request.getHeader('Content-Type') || 'text/plain');
      if (reqBody) req.writeString(reqBody);
      var resp = _proxyClient.do(req);
      setCORS(ctx);
      var text = '';
      try { text = resp.string(); } catch (e2) { /* empty */ }
      // For chart responses, rewrite asset URLs to point directly to machbase-neo
      var isChart = (text.indexOf('"chartID"') !== -1 || text.indexOf('"geomapID"') !== -1) && text.indexOf('/web/') !== -1;
      if (isChart) {
        text = text.replace(/("\/web\/)/g, '"' + neoBase + '/web/');
        console.println('[Server] Rewrote chart asset URLs to ' + neoBase);
      }
      // Copy headers but skip Content-Length (we recalculate for rewritten body)
      var headers = resp.headers || {};
      var headerKeys = Object.keys(headers);
      for (var hi = 0; hi < headerKeys.length; hi++) {
        var hk = headerKeys[hi];
        var hkl = hk.toLowerCase();
        if (hkl === 'transfer-encoding' || hkl === 'content-length') continue;
        ctx.setHeader(hk, headers[hk]);
      }
      ctx.response.status(resp.statusCode);
      ctx.response.write(text);
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
      var clientAuth = ctx.request.getHeader('Authorization');
      if (clientAuth) req.header.set('Authorization', clientAuth);
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
      req.header.set('Content-Type', ctx.request.getHeader('Content-Type') || 'application/json');
      var clientAuth = ctx.request.getHeader('Authorization');
      if (clientAuth) req.header.set('Authorization', clientAuth);
      var auth = authHeaders();
      if (auth['Authorization']) req.header.set('Authorization', auth['Authorization']);
      if (reqBody) req.writeString(reqBody);
      copyResponse(ctx, _proxyClient.do(req));
    } catch (e) {
      relayError(ctx, path, e);
    }
  });

  // --- Config API ---

  var fs = require('fs');
  var pathMod = require('path');
  var process2 = require('process');
  // process.argv[1] = llm-launcher.js or main.js path
  var ARGV1 = process2.argv[1] || '';
  var CGI_BIN_DIR = ARGV1.slice(0, ARGV1.lastIndexOf('/llm'));
  if (!CGI_BIN_DIR) CGI_BIN_DIR = pathMod.resolve('..');
  var CONFIGS_DIR = pathMod.join(CGI_BIN_DIR, 'llm', 'configs');
  var CONFIG_FILE = pathMod.join(CGI_BIN_DIR, 'config.json');
  var CONFIG_DEFAULT = { server: { port: '8884' } };

  console.println('[Server] ARGV1: ' + ARGV1);
  console.println('[Server] CONFIGS_DIR: ' + CONFIGS_DIR);
  console.println('[Server] CONFIG_FILE: ' + CONFIG_FILE);

  function setCORS(ctx) {
    ctx.setHeader('Access-Control-Allow-Origin', '*');
    ctx.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  // This @jsh/http build exposes neither `options()` nor `all()` on Server, so we can't
  // answer CORS preflight directly. Frontend works around it by sending only "simple"
  // requests: POST with Content-Type 'text/plain' (no preflight), with PUT/DELETE
  // tunneled via POST + `?_method=PUT|DELETE`. Each handler still emits CORS headers on
  // the actual response so the browser is allowed to read it.

  function parseBody(ctx) {
    var body = ctx.request.body;
    if (typeof body === 'string') return JSON.parse(body);
    return body;
  }

  function readConfigFile(name) {
    var fp = pathMod.join(CONFIGS_DIR, name + '.json');
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, { encoding: 'utf8' }));
  }

  function writeConfigFile(name, data) {
    if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });
    fs.writeFileSync(pathMod.join(CONFIGS_DIR, name + '.json'), JSON.stringify(data, null, 2));
  }

  function removeConfigFile(name) {
    var fp = pathMod.join(CONFIGS_DIR, name + '.json');
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  function jsonReply(ctx, status, data) {
    setCORS(ctx);
    ctx.setHeader('Content-Type', 'application/json');
    ctx.response.status(status);
    ctx.response.write(JSON.stringify(data));
  }

  function readMainConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, { encoding: 'utf8' }));
      }
    } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(CONFIG_DEFAULT));
  }

  function listConfigNames() {
    if (!fs.existsSync(CONFIGS_DIR)) return [];
    var files = fs.readdirSync(CONFIGS_DIR);
    var names = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].endsWith('.json')) {
        names.push(files[i].replace(/\.json$/, ''));
      }
    }
    return names;
  }

  // /api/config — main config.json (server.port etc)
  server.get('/api/config', function (ctx) {
    console.println('[Server] GET /api/config');
    jsonReply(ctx, 200, { success: true, reason: 'success', data: readMainConfig() });
  });
  server.put('/api/config', handleMainConfigPut);
  // POST + ?_method=PUT fallback (frontend may use simple POST to avoid CORS preflight)
  server.post('/api/config', function (ctx) {
    var override = (ctx.query('_method') || '').toUpperCase();
    if (override === 'PUT') { handleMainConfigPut(ctx); return; }
    jsonReply(ctx, 405, { success: false, reason: 'method not allowed (use _method=PUT)' });
  });

  function handleMainConfigPut(ctx) {
    try {
      var parsed = parseBody(ctx);
      var existing = readMainConfig();
      if (parsed.server && parsed.server.port) {
        existing.server = existing.server || {};
        existing.server.port = String(parsed.server.port);
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2));
      jsonReply(ctx, 200, { success: true, reason: 'success', data: existing });
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: 'failed to save: ' + e.message });
    }
  }

  // /api/configs — config list / create (POST), and PUT/DELETE by ?name= query
  server.get('/api/configs', function (ctx) {
    var name = ctx.query('name');
    if (!name) {
      jsonReply(ctx, 200, { success: true, reason: 'success', data: { configs: listConfigNames() } });
      return;
    }
    try {
      var data = readConfigFile(name);
      if (!data) {
        jsonReply(ctx, 404, { success: false, reason: 'config not found: ' + name });
      } else {
        jsonReply(ctx, 200, { success: true, reason: 'success', data: { config: data, running: false } });
      }
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  });
  server.post('/api/configs', function (ctx) {
    // POST may carry ?_method=PUT|DELETE to avoid CORS preflight for those operations
    var override = (ctx.query('_method') || '').toUpperCase();
    if (override === 'PUT') { handleConfigsPutByQuery(ctx); return; }
    if (override === 'DELETE') { handleConfigsDeleteByQuery(ctx); return; }
    try {
      var parsed = parseBody(ctx);
      var saveName = (parsed.machbase && parsed.machbase.user) || 'sys';
      writeConfigFile(saveName, parsed);
      jsonReply(ctx, 201, { success: true, reason: 'success', data: { name: saveName } });
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  });
  server.put('/api/configs', handleConfigsPutByQuery);
  server.delete('/api/configs', handleConfigsDeleteByQuery);

  function handleConfigsPutByQuery(ctx) {
    var name = ctx.query('name');
    if (!name) { jsonReply(ctx, 400, { success: false, reason: 'name parameter required' }); return; }
    try {
      writeConfigFile(name, parseBody(ctx));
      jsonReply(ctx, 200, { success: true, reason: 'success', data: { name: name } });
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  }
  function handleConfigsDeleteByQuery(ctx) {
    var name = ctx.query('name');
    if (!name) { jsonReply(ctx, 400, { success: false, reason: 'name parameter required' }); return; }
    try {
      removeConfigFile(name);
      jsonReply(ctx, 200, { success: true, reason: 'success', data: { name: name } });
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  }

  // /api/configs/:name — path-param variant (frontend default for detail/update/delete)
  server.get('/api/configs/:name', handleConfigGetByName);
  server.put('/api/configs/:name', handleConfigPutByName);
  server.delete('/api/configs/:name', handleConfigDeleteByName);
  // POST + ?_method=PUT|DELETE (frontend uses this to avoid CORS preflight)
  server.post('/api/configs/:name', function (ctx) {
    var override = (ctx.query('_method') || '').toUpperCase();
    if (override === 'DELETE') { handleConfigDeleteByName(ctx); return; }
    // Default POST on a :name path = update (PUT semantics)
    handleConfigPutByName(ctx);
  });

  function handleConfigGetByName(ctx) {
    var name = ctx.param('name');
    console.println('[Server] GET /api/configs/' + name);
    try {
      var data = readConfigFile(name);
      if (!data) {
        jsonReply(ctx, 404, { success: false, reason: 'config not found: ' + name });
      } else {
        jsonReply(ctx, 200, { success: true, reason: 'success', data: { config: data, running: false } });
      }
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  }
  function handleConfigPutByName(ctx) {
    var name = ctx.param('name');
    console.println('[Server] PUT/POST(_method=PUT) /api/configs/' + name);
    try {
      writeConfigFile(name, parseBody(ctx));
      jsonReply(ctx, 200, { success: true, reason: 'success', data: { name: name } });
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  }
  function handleConfigDeleteByName(ctx) {
    var name = ctx.param('name');
    console.println('[Server] DELETE/POST(_method=DELETE) /api/configs/' + name);
    try {
      removeConfigFile(name);
      jsonReply(ctx, 200, { success: true, reason: 'success', data: { name: name } });
    } catch (e) {
      jsonReply(ctx, 500, { success: false, reason: e.message });
    }
  }

  // GET /api/debug → 경로 디버그
  server.get('/api/debug', function (ctx) {
    var dirExists = fs.existsSync(CONFIGS_DIR);
    var fileExists = fs.existsSync(CONFIG_FILE);
    var files = [];
    if (dirExists) { try { files = fs.readdirSync(CONFIGS_DIR); } catch(e) {} }
    jsonReply(ctx, 200, {
      ARGV1: ARGV1,
      CGI_BIN_DIR: CGI_BIN_DIR,
      CONFIGS_DIR: CONFIGS_DIR,
      CONFIGS_DIR_EXISTS: dirExists,
      CONFIGS_FILES: files,
      CONFIG_FILE: CONFIG_FILE,
      CONFIG_FILE_EXISTS: fileExists,
      cwd: process2.cwd ? process2.cwd() : 'N/A',
    });
  });

  // GET /api/info → LLM 서버 포트 반환
  server.get('/api/info', function (ctx) {
    var mainCfg = readMainConfig();
    var p = (mainCfg.server && mainCfg.server.port) || '8884';
    jsonReply(ctx, 200, { ok: true, data: { port: p } });
  });

  // --- REST endpoint (test stub; frontend uses WebSocket for chat) ---
  server.post('/api/chat', function (ctx) {
    var body = ctx.request.body;
    console.println('[Server] POST /api/chat: ' + JSON.stringify(body).substring(0, 200));

    http.get('http://' + cfg.machbase.host + ':' + cfg.machbase.port + '/db/query?q=select%201', function (resp) {
      console.println('[Server] REST async HTTP callback fired! status=' + resp.statusCode);
      ctx.json(http.status.OK, { ok: true, test: 'async works in REST' });
    });
  });


  // WS for models/control only (no async needed)
  // Frontend connects to /{user}/ws (e.g. /sys/ws)
  // Bind two WebSocketServers: one for /ws (legacy), one for /:user/ws (frontend)
  var wss = new WebSocketServer({ server: server, path: '/ws' });
  var wss2 = new WebSocketServer({ server: server, path: '/:user/ws' });

  // Extract :user from a WS request URL containing `/<user>/ws`.
  // jsh's WebSocket may give us either a path (`/joy/ws`) or a full URL
  // (`ws://host:port/joy/ws`), so the match is anchored to the `/<user>/ws`
  // segment, not the start of the string. Returns '' for the legacy `/ws`
  // path (caller falls back to cfg.machbase.user).
  function extractUserFromWsUrl(url) {
    if (!url) return '';
    var s = String(url);
    var m = s.match(/\/([^\/\?]+)\/ws(?:[\/\?]|$)/);
    if (!m) return '';
    var seg = m[1];
    if (seg === 'ws') return ''; // matched the legacy /ws route, no user
    try { return decodeURIComponent(seg); } catch (e) { return seg; }
  }

  function onWSConnection(socket, request) {
    // Best-effort: try to extract user from the WS URL path. In this jsh build the
    // URL appears to come through empty for WS upgrades, so this often returns ''
    // and we leave authUserID empty — handleMessage will fall back to msg.user_id
    // (set by the frontend) for per-user routing. authUserID stays captured in the
    // closure rather than on the socket object, because Go-backed WS objects in
    // goja silently drop arbitrary property assignments.
    var extracted = extractUserFromWsUrl(request && request.url);
    var authUserID = extracted || '';
    console.println('[Server] WS client connected from ' + (request && request.remoteAddress)
      + ' path=' + (request && request.url) + ' user=' + (authUserID || '(from msg)'));

    socket.on('message', function (event) {
      var raw = (typeof event === 'string') ? event : (event && event.data) ? event.data : String(event);
      wsHandler.handleMessage(socket, raw, authUserID);
    });

    socket.on('close', function () {
      console.println('[Server] WS client disconnected');
    });
  }

  wss.on('connection', onWSConnection);
  wss2.on('connection', onWSConnection);

  console.println('[Server] WebSocket server listening on :' + port);
  server.serve();
}

module.exports = { runServer };
