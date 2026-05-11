'use strict';

// pkg run start — JSH 서비스 시작.

var process = require('process');
var service = require('service');

var SERVICE_NAME = 'neo-pkg-llm-chat-test';

console.println('starting service:', SERVICE_NAME);
service.start(SERVICE_NAME, function(err) {
  if (err) {
    console.println('ERROR:', err.message);
    process.exit(1);
  }
  console.println('service started.');
});
