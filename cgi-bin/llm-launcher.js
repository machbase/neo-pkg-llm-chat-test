'use strict';

const process = require('process');
const path = require('path');

// JSH 가상 경로 기준
const SCRIPT_DIR = path.resolve(path.dirname(process.argv[1]));
const LLM_DIR = path.join(SCRIPT_DIR, 'llm');
const MAIN_JS = path.join(LLM_DIR, 'main.js');

console.println('[llm-launcher] Starting JSH mode');
console.println('[llm-launcher] LLM_DIR:', LLM_DIR);
console.println('[llm-launcher] main.js:', MAIN_JS);

// Set working directory to LLM_DIR (so relative paths in main.js work)
process.chdir(LLM_DIR);

// Inject args for server mode (WebSocket server for Chat UI)
process.argv = [process.argv[0], MAIN_JS, '--mode', 'server', '--config', 'configs/sys.json'];

// Execute main.js directly in JSH runtime
require(MAIN_JS);
