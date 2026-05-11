var { argStr } = require('./registry');
var { expandReportTemplate, loadReportTemplates } = require('./report_templates');

function register(registry, mc) {
  loadReportTemplates();

  registry.register({
    name: 'save_html_report',
    description: '데이터를 분석하여 HTML 리포트를 생성합니다. 차트와 심층 분석이 포함된 보고서를 자동으로 만들어줍니다. table만 지정하여 바로 호출하세요.',
    parameters: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: '템플릿 ID. 운전/차량: R-3, 진동: R-2, 금융: R-1, 범용: R-0', enum: ['R-0', 'R-1', 'R-2', 'R-3'] },
        table: { type: 'string', description: '테이블명 (필수)' },
        tag_count: { type: 'string' }, data_count: { type: 'string' }, time_range: { type: 'string' },
        analysis: { type: 'string' }, recommendations: { type: 'string' },
        rollup_unit: { type: 'string', enum: ['sec', 'min', 'hour', 'day', 'week', 'month'] },
        stock: { type: 'string' }, time_start: { type: 'string' }, time_end: { type: 'string' },
      },
      required: ['table'],
    },
    fn: function (args, cb) { saveHtmlReport(mc, args, cb); },
  });
}

// cb(err, resultString)
function saveHtmlReport(mc, args, cb) {
  var norm = {};
  var keys = Object.keys(args);
  for (var i = 0; i < keys.length; i++) norm[keys[i].toLowerCase()] = args[keys[i]];

  var tableName = anyStr(norm, 'table') || anyStr(norm, 'table_name') || anyStr(norm, 'tablename') || anyStr(norm, 'name');
  if (!tableName) {
    var vals = Object.values(norm);
    for (var j = 0; j < vals.length; j++) {
      var s = String(vals[j]);
      if (s.length >= 2 && s.length <= 30 && s === s.toUpperCase() && s.indexOf(' ') < 0) { tableName = s; break; }
    }
  }
  if (!tableName) return cb(null, 'table 파라미터가 필요합니다. 예: table="GOLD"');
  tableName = tableName.toUpperCase();

  var templateID = anyStr(norm, 'template_id') || anyStr(norm, 'templateid') || 'R-0';
  var now = new Date();
  var ts = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) + '_' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
  var filename = anyStr(norm, 'filename') || (tableName + '/' + tableName + '_Analysis_Report_' + ts + '.html');
  if (!filename.toLowerCase().endsWith('.html')) filename += '.html';
  if (filename.indexOf('/') < 0) filename = tableName + '/' + filename;

  var params = { GENERATED_DATE: formatDateLocal(now), TABLE: tableName };

  var timeStart = dateStrToNano(anyStr(norm, 'time_start') || anyStr(norm, 'timestart'));
  var timeEnd = dateStrToNano(anyStr(norm, 'time_end') || anyStr(norm, 'timeend'));
  var timeWhere = '', timeWhereBase = '';
  if (timeStart && timeEnd) {
    var tsNano = msToNano(timeStart), teNano = msToNano(timeEnd);
    timeWhere = ' AND TIME BETWEEN ' + tsNano + ' AND ' + teNano;
    timeWhereBase = ' WHERE TIME BETWEEN ' + tsNano + ' AND ' + teNano;
  }

  var stock = anyStr(norm, 'stock') || anyStr(norm, 'tag') || '';
  if (stock) stock = extractStockPrefix(stock);
  var rollupUnit = anyStr(norm, 'rollup_unit') || pickRollupUnit(timeStart, timeEnd);
  var statsCSV = '';

  // Step 1: Get tags
  mc.querySQL('SELECT NAME FROM V$' + tableName + '_STAT LIMIT 2600', '', '', '', function (err, tagCSV) {
    var tags = parseTagList(err ? '' : tagCSV);

    function afterTags(tags) {
      if (tags.length === 0) return cb(null, 'Error: failed to retrieve tags from table ' + tableName);

      var stockWhere = '';
      if (stock) {
        var prefix = stock.toUpperCase() + '_';
        var filtered = tags.filter(function (t) { return t.toUpperCase().indexOf(prefix) === 0; });
        if (filtered.length > 0) { tags = filtered; stockWhere = " AND NAME IN ('" + filtered.join("','") + "')"; }
      }

      if (templateID === 'R-0') {
        var ohlcv = findOHLCVTags(tags, stock);
        if (ohlcv.close && ohlcv.open) { templateID = 'R-1'; }
      }

      // Step 2: Get stats
      var statsSQL = 'SELECT NAME, COUNT(*) as cnt, ROUND(AVG(VALUE),2) as avg, ROUND(MIN(VALUE),2) as min, ROUND(MAX(VALUE),2) as max FROM ' + tableName;
      var whereClause = timeWhereBase || '';
      if (stockWhere) whereClause = whereClause ? whereClause + stockWhere : ' WHERE' + stockWhere.substring(4);
      statsSQL += whereClause + ' GROUP BY NAME';

      mc.querySQL(statsSQL, '', '', '', function (err2, statsResult) {
        statsCSV = err2 ? '' : statsResult;
        if (statsCSV) {
          try {
            var sr = parseStatsCSV(statsCSV);
            if (sr.rows.length > 0) {
              params.TAG_STATS_ROWS = sr.rows.join('\n');
              params.TAG_COUNT = String(sr.rows.length);
              params.CHART_DATA_JSON = JSON.stringify(sr.items);
            }
          } catch (e) { /* ignore */ }
        }

        // Step 3: Get time range — filtered if time filter exists, otherwise full range
        var timeRangeSQL = 'SELECT MIN(TIME), MAX(TIME) FROM ' + tableName + (timeWhereBase || '');
        mc.querySQL(timeRangeSQL, 'Default', 'Asia/Seoul', '', function (err3, timeCSV) {
          if (!err3 && timeCSV) {
            var tr = parseTimeRangeCSV(timeCSV);
            if (tr) params.TIME_RANGE = tr;
          }

          var rollupLabels = { sec: '초별', min: '분별', hour: '시간별', day: '일별', week: '주별', month: '월별' };
          params.ROLLUP_LABEL = rollupLabels[rollupUnit] || rollupUnit;

          // Step 4: Template-specific data (simplified for async)
          // LLM-provided params
          // DB 조회 결과가 없을 때만 LLM 제공 값 사용
          if (!params.TAG_COUNT && anyStr(norm, 'tag_count')) params.TAG_COUNT = anyStr(norm, 'tag_count');
          if (!params.DATA_COUNT && anyStr(norm, 'data_count')) params.DATA_COUNT = anyStr(norm, 'data_count');
          if (!params.TIME_RANGE && anyStr(norm, 'time_range')) params.TIME_RANGE = anyStr(norm, 'time_range');
          if (anyStr(norm, 'analysis')) params.ANALYSIS = mdToHTML(anyStr(norm, 'analysis'));
          if (anyStr(norm, 'recommendations')) params.RECOMMENDATIONS = mdToHTML(anyStr(norm, 'recommendations'));

          if (!params.DATA_COUNT && statsCSV) {
            var total = calcTotalCount(statsCSV);
            if (total > 0) params.DATA_COUNT = String(total);
          }

          // If analysis missing, return stats for LLM
          if (!params.ANALYSIS || !params.RECOMMENDATIONS) {
            var summary = '테이블: ' + tableName + '\n';
            if (params.TIME_RANGE) summary += '조회 기간: ' + params.TIME_RANGE + '\n';
            if (params.DATA_COUNT) summary += '총 데이터 건수: ' + params.DATA_COUNT + '\n';
            if (statsCSV) summary += '태그별 통계:\n' + statsCSV + '\n';
            var msg = '데이터를 조회했습니다. 아래 통계를 기반으로 analysis와 recommendations를 작성하여 다시 호출하세요.\n\n' + summary;
            if (!params.ANALYSIS) msg += '\n※ analysis 파라미터가 누락되었습니다.';
            if (!params.RECOMMENDATIONS) msg += '\n※ recommendations 파라미터가 누락되었습니다.';
            return cb(null, msg);
          }

          // Expand template and save
          var html;
          try { html = expandReportTemplate(templateID, params); } catch (e) { return cb(null, 'Template error: ' + e.message); }

          var slashIdx = filename.indexOf('/');
          function doWrite() {
            mc.writeFile(filename, html, function (err4) {
              if (err4) return cb(null, 'File save failed: ' + err4.message);
              cb(null, 'Report saved: ' + filename + '\n[리포트 열기](/db/tql/' + filename + ')');
            });
          }
          if (slashIdx > 0) {
            mc.createFolder(filename.substring(0, slashIdx), function () { doWrite(); });
          } else { doWrite(); }
        });
      });
    }

    if (tags.length === 0) {
      // Fallback tag query
      mc.querySQL('SELECT NAME FROM ' + tableName + (timeWhereBase || '') + ' GROUP BY NAME', '', '', '', function (err1b, tagCSV2) {
        tags = parseTagList(err1b ? '' : tagCSV2);
        afterTags(tags);
      });
    } else {
      afterTags(tags);
    }
  });
}

// --- Helpers (unchanged) ---
function anyStr(obj, key) { var v = obj[key]; if (v === undefined || v === null) return ''; return String(v); }
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function formatDateLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function dateStrToNano(s) { if (!s) return ''; s = s.trim(); if (s[0] >= '0' && s[0] <= '9' && s.indexOf('-') < 0) return s; var d = new Date(s); if (isNaN(d.getTime())) return s; return String(d.getTime() * 1000000); }
function msToNano(ms) { if (!ms) return ms; var s = String(ms).trim(); if (s.length > 15) return s; return s + '000000'; }
function pickRollupUnit(startMs, endMs) { if (!startMs || !endMs) return 'month'; var s = parseInt(startMs, 10), e = parseInt(endMs, 10); if (!s || !e) return 'month'; var h = (e - s) / 1000 / 3600; if (h < 1) return 'sec'; if (h < 48) return 'min'; if (h < 720) return 'hour'; if (h < 8760) return 'day'; return 'month'; }
function parseTagList(csvData) { if (!csvData) return []; try { var p = JSON.parse(csvData); if (p && p.data && p.data.rows) return p.data.rows.map(function (r) { return r[0]; }).filter(function (t) { return t; }); } catch (e) {} var lines = csvData.split('\n'); var tags = []; for (var i = 1; i < lines.length; i++) { var t = lines[i].trim(); if (t && t !== 'NAME') tags.push(t); } return tags; }
function parseStatsCSV(csvData) { var rows = [], items = []; try { var p = JSON.parse(csvData); if (p && p.data && p.data.rows) { for (var i = 0; i < p.data.rows.length; i++) { var r = p.data.rows[i]; if (r.length < 5) continue; rows.push('<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="num">' + r[3] + '</td><td class="num">' + r[4] + '</td></tr>'); items.push({ name: r[0], count: r[1], avg: r[2], min: r[3], max: r[4] }); } } } catch (e) {} return { rows: rows, items: items }; }
function parseTimeRangeCSV(csvData) { try { var p = JSON.parse(csvData); if (p && p.data && p.data.rows && p.data.rows.length > 0) { var row = p.data.rows[0]; return String(row[0]).substring(0, 19) + ' ~ ' + String(row[1]).substring(0, 19); } } catch (e) {} return ''; }
function findOHLCVTags(tags, stock) { var result = {}; var fields = ['open', 'high', 'low', 'close', 'volume']; if (stock) { var prefix = stock.toUpperCase() + '_'; tags.forEach(function (t) { var upper = t.toUpperCase(); if (upper.indexOf(prefix) !== 0) return; var suffix = t.substring(prefix.length).toLowerCase(); if (fields.indexOf(suffix) >= 0) result[suffix] = t; }); } else { var lower = {}; tags.forEach(function (t) { lower[t.toLowerCase()] = t; }); fields.forEach(function (f) { if (lower[f]) result[f] = lower[f]; }); } return result; }
function extractStockPrefix(tagVal) { var c = tagVal.split(',')[0].trim(); ['_close', '_open', '_high', '_low', '_volume', '_adj_close'].forEach(function (s) { var idx = c.toLowerCase().indexOf(s); if (idx > 0) c = c.substring(0, idx); }); return c.toUpperCase(); }
function calcTotalCount(csvData) { var total = 0; try { var p = JSON.parse(csvData); if (p && p.data && p.data.rows) p.data.rows.forEach(function (r) { if (r.length >= 2) total += parseInt(r[1], 10) || 0; }); } catch (e) {} return total; }
function mdToHTML(text) { if (!text) return ''; text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); var lines = text.split('\n'); var result = []; var inOL = false; for (var i = 0; i < lines.length; i++) { var t = lines[i].trim(); if (/^\d+[.)]\s+/.test(t)) { if (!inOL) { result.push('<ol>'); inOL = true; } result.push('<li>' + t.replace(/^\d+[.)]\s+/, '') + '</li>'); } else if (t.indexOf('- ') === 0 || t.indexOf('* ') === 0) { if (inOL) { result.push('</ol>'); inOL = false; } result.push('<li>' + t.substring(2) + '</li>'); } else { if (inOL) { result.push('</ol>'); inOL = false; } if (t) result.push('<p>' + t + '</p>'); } } if (inOL) result.push('</ol>'); return result.join('\n'); }

module.exports = { register };
