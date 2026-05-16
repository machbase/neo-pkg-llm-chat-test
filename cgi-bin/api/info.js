'use strict';

// Frontend calls this on every page load to discover the LLM server port.
// We also use it as the auto-bootstrap hook: if the service isn't registered
// or isn't running, install (with enable:true for boot autostart) and start
// before responding. This makes the package zero-touch — any user who opens
// the page kicks off install on first load; subsequent neo boots autostart.

var process = require('process');
var path = require('path');
var fs = require('fs');
var service = require('service');

var CGI_BIN_DIR = path.resolve(path.dirname(process.argv[1]), '..');
var CONFIG_FILE = path.join(CGI_BIN_DIR, 'config.json');
var LAUNCHER = path.join(CGI_BIN_DIR, 'llm-launcher.js');
var LLM_DIR = path.join(CGI_BIN_DIR, 'llm');
var SERVICE_NAME = 'neo-pkg-llm';
var DEFAULT_PORT = '8884';

function reply(data) {
  var body = JSON.stringify(data);
  process.stdout.write('Content-Type: application/json\r\n');
  process.stdout.write('\r\n');
  process.stdout.write(body);
}

function readPort() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      var cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, { encoding: 'utf8' }));
      if (cfg.server && cfg.server.port) return String(cfg.server.port);
    }
  } catch (e) { /* fall through */ }
  return DEFAULT_PORT;
}

function ensureService(done) {
  if (!fs.existsSync(LAUNCHER)) {
    done(new Error('launcher not found: ' + LAUNCHER));
    return;
  }
  service.status(SERVICE_NAME, function (statusErr, info) {
    var notInstalled = statusErr || !info;
    if (notInstalled) {
      service.install({
        name: SERVICE_NAME,
        enable: true,
        working_dir: LLM_DIR,
        executable: LAUNCHER,
      }, function (installErr) {
        if (installErr) { done(installErr); return; }
        service.start(SERVICE_NAME, done);
      });
      return;
    }
    if (info.status !== 'running') {
      service.start(SERVICE_NAME, done);
      return;
    }
    done(null);
  });
}

var port = readPort();
try {
  ensureService(function (bootstrapErr) {
    if (bootstrapErr) {
      reply({
        ok: true,
        data: { port: port, bootstrap: 'failed', reason: bootstrapErr.message || String(bootstrapErr) },
      });
      return;
    }
    reply({ ok: true, data: { port: port } });
  });
} catch (e) {
  reply({ ok: true, data: { port: port, bootstrap: 'exception', reason: e.message || String(e) } });
}
