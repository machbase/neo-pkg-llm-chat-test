var { normalizeArgs } = require('./normalize');
var { fixTimeFloats, fixTimeValues, captureDataTimeRange, isAllDigits, msToDatetime } = require('./time_fix');
var { fixTQLContent, fixEscapedNewlines } = require('./tql_fix');
var { captureKnownTags, validateTagInArgs } = require('./tag_validate');
var { jsonMarshal, jsonUnmarshal } = require('./json_helper');

var DASHBOARD_TOOLS = {
  create_dashboard: true, create_dashboard_with_charts: true,
  add_chart_to_dashboard: true, remove_chart_from_dashboard: true,
  update_chart_in_dashboard: true, delete_dashboard: true,
  update_dashboard_time_range: true, preview_dashboard: true,
  get_dashboard: true, save_html_report: true,
};

function createFixerContext() {
  return {
    timeStartDt: '',
    timeEndDt: '',
    dataMinDt: '',
    dataMaxDt: '',
    knownTags: [],
    inferTableName: null,
  };
}

function fix(msg, fctx) {
  if (!msg.toolCalls || msg.toolCalls.length === 0) return msg;

  for (var i = 0; i < msg.toolCalls.length; i++) {
    var tc = msg.toolCalls[i];
    var args = tc.function.arguments;
    if (!args) {
      args = {};
      tc.function.arguments = args;
    }
    var name = tc.function.name;

    // Step 1: Normalize parameter aliases
    normalizeArgs(name, args);

    // Step 2: list_table_tags table_name inference
    if (name === 'list_table_tags') {
      var table = args.table_name || '';
      if (!table && fctx.inferTableName) {
        var inferred = fctx.inferTableName();
        if (inferred) {
          args.table_name = inferred;
          console.println('  [fix] list_table_tags table_name auto: ' + inferred);
        }
      }
    }

    // Step 3: save_html_report time injection
    if (name === 'save_html_report' && fctx.timeStartDt) {
      args.time_start = fctx.timeStartDt;
      args.time_end = fctx.timeEndDt;
      console.println('  [fix] save_html_report time injected: ' + fctx.timeStartDt + ' ~ ' + fctx.timeEndDt);
    }

    // Step 4: time_start/time_end float → string
    fixTimeFloats(args);

    // Step 5: Literal \n → real newline
    fixEscapedNewlines(args);

    // Step 6: charts normalization
    fixCharts(args, fctx);

    // Step 7: time_start/time_end normalize to epoch ms
    fixTimeValues(args);

    // Step 8: save_tql_file / delete_file folder merge
    fixFolderMerge(name, args);

    // Step 9: Dashboard filename/title auto-fix
    fixDashboardFilename(name, args);
    fixDashboardTitle(name, args);

    // Step 10: TQL content fixes (template expansion, line breaks)
    fixTQLContent(name, args, fctx);
  }
  return msg;
}

function fixCharts(args, fctx) {
  if (args.charts !== undefined) {
    if (typeof args.charts === 'object' && args.charts !== null) {
      args.charts = jsonMarshal(args.charts);
    } else if (typeof args.charts === 'string') {
      if (args.charts.indexOf("'") >= 0 && args.charts.indexOf('"') < 0) {
        args.charts = args.charts.replace(/'/g, '"');
        console.println('  [fix] charts single quotes → double quotes');
      }
    }
  }

  // charts: table field missing → auto insert
  if (typeof args.charts === 'string' && args.charts && fctx.inferTableName) {
    var inferred = fctx.inferTableName();
    if (inferred) {
      var chartList = jsonUnmarshal(args.charts);
      if (Array.isArray(chartList)) {
        var fixed = false;
        for (var i = 0; i < chartList.length; i++) {
          if (!chartList[i].table) {
            chartList[i].table = inferred;
            fixed = true;
          }
        }
        if (fixed) {
          args.charts = jsonMarshal(chartList);
          console.println('  [fix] charts table auto: ' + inferred);
        }
      }
    }
  }
}

function fixFolderMerge(name, args) {
  if (name === 'save_tql_file' || name === 'delete_file') {
    var fn = args.filename || '';
    var folder = args.folder_name || '';
    if (fn && folder && fn.indexOf('/') < 0) {
      args.filename = folder + '/' + fn;
      delete args.folder_name;
      console.println('  [fix] Merged folder into filename: ' + args.filename);
    }
  }
}

function fixDashboardFilename(name, args) {
  if (!DASHBOARD_TOOLS[name]) return;
  var fn = args.filename || '';
  if (!fn) return;

  if (!fn.toLowerCase().endsWith('.dsh')) {
    fn = fn + '.dsh';
  }
  if (fn.indexOf('/') < 0) {
    var base = fn.replace(/\.dsh$/i, '');
    var parts = base.split('_');
    var folder = parts[0].toUpperCase();
    fn = folder + '/' + fn;
  }

  // Add timestamp for create operations
  if (name === 'create_dashboard' || name === 'create_dashboard_with_charts') {
    var now = new Date();
    var ts = now.getFullYear() +
      pad2(now.getMonth() + 1) + pad2(now.getDate()) + '_' +
      pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
    var base2 = fn.replace(/\.dsh$/i, '');
    if (!/\d{8}_\d{6}$/.test(base2)) {
      fn = base2 + '_' + ts + '.dsh';
    }
  }

  args.filename = fn;
  console.println('  [fix] Dashboard filename → ' + fn);
}

function fixDashboardTitle(name, args) {
  if (name !== 'create_dashboard' && name !== 'create_dashboard_with_charts') return;
  var title = args.title || '';
  if (!title || title === 'New dashboard' || title === 'Dashboard' || title === 'dashboard') {
    var fn = args.filename || '';
    var table = fn.split('/')[0] || '데이터';
    args.title = table + ' 심층 분석 대시보드';
  }
}

function fixDashboardTime(tc, fctx) {
  if (!DASHBOARD_TOOLS[tc.function.name]) return;
  var args = tc.function.arguments;

  var needsStart = !args.time_start || typeof args.time_start !== 'string' || args.time_start === '';
  var needsEnd = !args.time_end || typeof args.time_end !== 'string' || args.time_end === '';

  var startDt = fctx.timeStartDt || fctx.dataMinDt;
  var endDt = fctx.timeEndDt || fctx.dataMaxDt;

  if (startDt && endDt) {
    if (needsStart) {
      var startMs = new Date(startDt.replace(' ', 'T')).getTime();
      if (startMs > 0) args.time_start = String(startMs);
    }
    if (needsEnd) {
      var endMs = new Date(endDt.replace(' ', 'T')).getTime();
      if (endMs > 0) args.time_end = String(endMs);
    }
    if (needsStart || needsEnd) {
      console.println('  [fix] dashboard time → ' + startDt + ' ~ ' + endDt);
    }
  }
}

function captureResults(tc, result, err, fctx) {
  if (err) return;
  if (tc.function.name === 'list_table_tags') {
    captureKnownTags(result, fctx);
  }
  if (tc.function.name === 'execute_sql_query') {
    captureDataTimeRange(tc.function.arguments, result, fctx);
  }
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

module.exports = {
  createFixerContext,
  fix,
  fixDashboardTime,
  captureResults,
  validateTagInArgs,
  DASHBOARD_TOOLS,
};
