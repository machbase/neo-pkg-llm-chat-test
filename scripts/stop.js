'use strict';

// pkg run stop — JSH 서비스 중지.

var path = require('path');
var process = require('process');
var fs = require('fs');
var service = require('service');

var SERVICE_NAME = 'neo-pkg-llm';
var ROOT = path.resolve(path.dirname(process.argv[1]), '..');
var LOG_FILE = path.join(ROOT, 'stop-beacon.log');

function beacon(msg) {
  try { fs.writeFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '\n', { flag: 'a' }); } catch (e) {}
}

beacon('stop.js invoked, argv=' + JSON.stringify(process.argv));
console.println('stopping service:', SERVICE_NAME);

service.stop(SERVICE_NAME, function(err) {
  if (err) {
    beacon('stop error: ' + err.message);
    console.println('WARN:', err.message);
  } else {
    beacon('stop success');
    console.println('service stopped.');
  }
});
