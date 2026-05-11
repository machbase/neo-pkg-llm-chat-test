var { createAgent } = require('../agent/agent');
var { createLLM } = require('../llm/factory');
var config = require('../config/config');

var SESSION_TTL = 30 * 60 * 1000; // 30 minutes

function createWSServer(mc, registry, cfg) {
  var sessions = {};

  function handleMessage(conn, raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    var userID = msg.user_id || cfg.machbase.user;

    switch (msg.type) {
      case 'chat':
        handleChat(conn, userID, msg.session_id, msg.provider, msg.model, msg.query);
        break;
      case 'stop':
        handleStop(conn, msg.session_id, userID);
        break;
      case 'clear':
        handleClear(conn, msg.session_id, userID);
        break;
      case 'get_models':
        handleGetModels(conn, userID);
        break;
      default:
        console.println('[WSServer] Unknown type: ' + msg.type);
    }
  }

  function handleChat(conn, userID, sessionID, provider, model, query) {
    if (!provider || !model) {
      sendJSON(conn, { type: 'error', session_id: sessionID, msg: 'provider와 model은 필수입니다.' });
      return;
    }

    var sess = sessions[sessionID];

    // Check model change
    if (sess && (sess.provider !== provider || sess.model !== model)) {
      console.println('[WSServer] Model changed: ' + sess.provider + '/' + sess.model + ' → ' + provider + '/' + model);
      delete sessions[sessionID];
      sess = null;
    }

    if (!sess) {
      // Create new session
      var cfgCopy = JSON.parse(JSON.stringify(cfg));
      cfgCopy.provider = provider;
      cfgCopy.model = model;
      var llmClient;
      try {
        llmClient = createLLM(cfgCopy);
      } catch (e) {
        sendJSON(conn, { type: 'error', session_id: sessionID, msg: 'LLM 초기화 실패: ' + e.message });
        return;
      }
      sess = {
        agent: createAgent(llmClient, registry),
        lastUsed: Date.now(),
        userID: userID,
        provider: provider,
        model: model,
        conn: conn,
      };
      sessions[sessionID] = sess;
      console.println('[WSServer] New session: ' + sessionID + ' (' + provider + '/' + model + ')');
    } else {
      sess.lastUsed = Date.now();
      sess.conn = conn;
      console.println('[WSServer] Continuing session: ' + sessionID);
    }

    // Send answer_start
    sendStreamMsg(conn, 'answer_start');

    // Wire up progress reporting → send tool steps as block messages
    sess.agent.onProgress = function (text) {
      sendStreamMsg(conn, 'stream_block_start');
      sendStreamMsg(conn, 'stream_block_delta', text);
      sendStreamMsg(conn, 'stream_block_stop');
    };

    // Run agent (req.do() is blocking-sync, so callback chain runs inline)
    sess.agent.run(query, function (err, result) {
      if (err) {
        sendStreamMsg(conn, 'answer_stop');
        sendJSON(conn, { type: 'error', session_id: sessionID, msg: 'Agent 오류: ' + err.message });
        return;
      }

      // Send result as streaming protocol
      sendStreamMsg(conn, 'stream_msg_start');
      sendStreamMsg(conn, 'stream_msg_delta', result || '');
      sendStreamMsg(conn, 'stream_msg_stop');
      sendStreamMsg(conn, 'answer_stop');
    });
  }

  function handleStop(conn, sessionID, userID) {
    // JSH is synchronous, so stop is a no-op (can't cancel mid-execution)
    console.println('[WSServer] Stop requested: ' + sessionID + ' (no-op in JSH)');
    sendJSON(conn, { type: 'stop', session_id: sessionID, msg: 'stopped' });
  }

  function handleClear(conn, sessionID, userID) {
    if (sessions[sessionID]) {
      delete sessions[sessionID];
      console.println('[WSServer] Session cleared: ' + sessionID);
    }
    sendJSON(conn, { type: 'stop', session_id: sessionID });
  }

  function handleGetModels(conn, userID) {
    var providers = [];
    if (cfg.claude.api_key && cfg.claude.models.length > 0) {
      var models = [];
      for (var i = 0; i < cfg.claude.models.length; i++) {
        models.push({ name: cfg.claude.models[i].name, model_id: cfg.claude.models[i].model_id || cfg.claude.models[i].name });
      }
      providers.push({ provider: 'claude', models: models });
    }
    if (cfg.chatgpt.api_key && cfg.chatgpt.models.length > 0) {
      var models = [];
      for (var i = 0; i < cfg.chatgpt.models.length; i++) {
        models.push({ name: cfg.chatgpt.models[i].name, model_id: cfg.chatgpt.models[i].model_id || cfg.chatgpt.models[i].name });
      }
      providers.push({ provider: 'chatgpt', models: models });
    }
    if (cfg.gemini.api_key && cfg.gemini.models.length > 0) {
      var models = [];
      for (var i = 0; i < cfg.gemini.models.length; i++) {
        models.push({ name: cfg.gemini.models[i].name, model_id: cfg.gemini.models[i].model_id || cfg.gemini.models[i].name });
      }
      providers.push({ provider: 'gemini', models: models });
    }
    if ((cfg.ollama.base_url || cfg.ollama.models.length > 0) && cfg.ollama.models.length > 0) {
      var models = [];
      for (var i = 0; i < cfg.ollama.models.length; i++) {
        models.push({ name: cfg.ollama.models[i].name, model_id: cfg.ollama.models[i].model_id || cfg.ollama.models[i].name });
      }
      providers.push({ provider: 'ollama', models: models });
    }
    if (providers.length === 0) {
      sendJSON(conn, { type: 'models', msg: 'No providers configured. Please set API keys in Settings.' });
    } else {
      sendJSON(conn, { type: 'models', providers: providers });
    }
  }

  function sendStreamMsg(conn, msgType, text) {
    var message = {
      ver: '1.0',
      id: Date.now(),
      type: msgType,
    };
    if (text !== undefined) {
      message.body = {
        ofStreamBlockDelta: {
          contentType: 'text/markdown',
          text: text,
        },
      };
    }
    sendJSON(conn, { type: 'msg', message: message });
  }

  function sendJSON(conn, obj) {
    try {
      conn.send(JSON.stringify(obj));
    } catch (e) {
      console.println('[WSServer] Send error: ' + e.message);
    }
  }

  // Session reaper (call periodically via setInterval)
  function reapSessions() {
    var now = Date.now();
    var keys = Object.keys(sessions);
    for (var i = 0; i < keys.length; i++) {
      if (now - sessions[keys[i]].lastUsed > SESSION_TTL) {
        console.println('[WSServer] Session expired: ' + keys[i]);
        delete sessions[keys[i]];
      }
    }
  }

  return {
    handleMessage: handleMessage,
    reapSessions: reapSessions,
    sessions: sessions,
  };
}

module.exports = { createWSServer };
