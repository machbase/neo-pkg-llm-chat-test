'use strict';

// /cgi-bin/api/configs
//   GET              → config 목록
//   GET  ?name=xxx   → config 상세
//   POST             → config 생성 (body: AppConfig)
//   PUT  ?name=xxx   → config 수정
//   DELETE ?name=xxx → config 삭제

var path = require('path');
var process = require('process');
var fs = require('fs');

var ARGV1 = process.argv[1];
var APP_DIR = ARGV1.slice(0, ARGV1.lastIndexOf('/cgi-bin/') + '/cgi-bin'.length);
var CONFIGS_DIR = path.join(APP_DIR, 'llm', 'configs');

var _tick = Date.now();

function reply(status, data, reason) {
  var elapse = (Date.now() - _tick) + 'ms';
  var success = status >= 200 && status < 300;
  var body = JSON.stringify({
    success: success,
    reason: reason || (success ? 'success' : 'error'),
    elapse: elapse,
    data: data !== undefined ? data : null,
  });
  process.stdout.write('Content-Type: application/json\r\n');
  process.stdout.write('Status: ' + status + '\r\n');
  process.stdout.write('\r\n');
  process.stdout.write(body);
}

function parseBody() {
  var raw = process.stdin.read();
  if (!raw) return null;
  return JSON.parse(raw);
}

function getQueryParam(key) {
  var qs = process.env.get('QUERY_STRING') || '';
  var parts = qs.split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    if (decodeURIComponent(kv[0]) === key) {
      return decodeURIComponent(kv[1] || '');
    }
  }
  return '';
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

function configFilePath(name) {
  return path.join(CONFIGS_DIR, name + '.json');
}

function ensureDir() {
  if (!fs.existsSync(CONFIGS_DIR)) {
    fs.mkdirSync(CONFIGS_DIR, { recursive: true });
  }
}

var method = (process.env.get('REQUEST_METHOD') || 'GET').toUpperCase();
var name = getQueryParam('name');

if (method === 'GET') {
  if (!name) {
    // List all configs
    try {
      reply(200, { configs: listConfigNames() });
    } catch (e) {
      reply(500, null, e.message || String(e));
    }
  } else {
    // Get single config
    try {
      var fp = configFilePath(name);
      if (!fs.existsSync(fp)) {
        reply(404, null, 'config not found: ' + name);
      } else {
        var data = JSON.parse(fs.readFileSync(fp, { encoding: 'utf8' }));
        reply(200, { config: data, running: false });
      }
    } catch (e) {
      reply(500, null, e.message || String(e));
    }
  }
} else if (method === 'POST') {
  var body = null;
  var parseErr = null;
  try { body = parseBody(); } catch (err) { parseErr = err; }

  if (parseErr) {
    reply(400, null, 'invalid JSON: ' + (parseErr.message || String(parseErr)));
  } else if (!body) {
    reply(400, null, 'request body required');
  } else {
    try {
      var saveName = (body.machbase && body.machbase.user) || 'sys';
      ensureDir();
      fs.writeFileSync(configFilePath(saveName), JSON.stringify(body, null, 2));
      reply(201, { name: saveName });
    } catch (e) {
      reply(500, null, e.message || String(e));
    }
  }
} else if (method === 'PUT') {
  if (!name) {
    reply(400, null, 'name parameter required');
  } else {
    var body = null;
    var parseErr = null;
    try { body = parseBody(); } catch (err) { parseErr = err; }

    if (parseErr) {
      reply(400, null, 'invalid JSON: ' + (parseErr.message || String(parseErr)));
    } else if (!body) {
      reply(400, null, 'request body required');
    } else {
      try {
        ensureDir();
        fs.writeFileSync(configFilePath(name), JSON.stringify(body, null, 2));
        reply(200, { name: name });
      } catch (e) {
        reply(500, null, e.message || String(e));
      }
    }
  }
} else if (method === 'DELETE') {
  if (!name) {
    reply(400, null, 'name parameter required');
  } else {
    try {
      var fp = configFilePath(name);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }
      reply(200, { name: name });
    } catch (e) {
      reply(500, null, e.message || String(e));
    }
  }
} else {
  reply(405, null, 'method not allowed');
}
