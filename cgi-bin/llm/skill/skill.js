function containsKeyword(s, keywords) {
  for (var i = 0; i < keywords.length; i++) {
    if (s.indexOf(keywords[i]) >= 0) return true;
  }
  return false;
}

function createRegistry() {
  var skills = {};
  var defaultSkill = null;

  function register(s) { skills[s.name] = s; }
  function get(name) { return skills[name] || null; }

  register(require('./basic')());
  register(require('./advanced')());
  register(require('./report')());
  register(require('./doclookup')());
  register(require('./dataquery')());
  register(require('./timer')());
  register(require('./general')());
  defaultSkill = skills['General'];

  function classify(query) {
    var lower = query.toLowerCase();

    // 1. DocLookup
    if (containsKeyword(lower, [
      '뭐야', '뭔가요', '란?', '이란', '사용법', '문법', '예제', '알려줘', '설명해', '어떻게',
      'how to', 'what is', 'what are', 'explain', 'usage', 'example', 'syntax', 'help me understand',
    ]) || containsKeyword(lower, ['문서', '매뉴얼', 'manual', 'doc', 'documentation', 'reference'])) {
      return skills['DocLookup'];
    }

    // 2. Report
    if (containsKeyword(lower, ['리포트', '보고서', 'report', 'summary report'])) {
      return skills['Report'];
    }

    // 3. Timer
    if (containsKeyword(lower, [
      '타이머', '스케줄', '스케줄러', '주기적', '반복 실행', '수집 설정', '수집',
      'timer', 'scheduler', 'schedule', 'cron', 'every', 'periodic', 'interval', 'collect',
    ])) {
      return skills['Timer'];
    }

    // 4. Advanced
    if (containsKeyword(lower, [
      '심층', '다각도', '고급', 'fft', 'rms', '스펙트럼', '엔벨로프',
      '진동 분석', '이상치', '이상 탐지',
      'advanced', 'spectrum', 'envelope', 'anomaly', 'vibration analysis',
      'frequency', 'crest factor', 'peak-to-peak',
    ])) {
      return skills['AdvancedAnalysis'];
    }

    // 5. BasicAnalysis
    if (containsKeyword(lower, [
      '분석', '대시보드', '차트', '시각화', '추세', '트렌드', '패턴', '비교', '보여줘', '보여 줘', '그래프',
      'dashboard', 'chart', 'visualize', 'visualization', 'trend', 'pattern', 'compare', 'comparison',
      'show me', 'plot', 'graph', 'analyze', 'analysis', 'display',
    ])) {
      return skills['BasicAnalysis'];
    }

    // 6. DataQuery
    if (containsKeyword(lower, [
      '조회', '확인', '최근', '최신', '태그', '몇건', '몇 건',
      'query', 'fetch', 'retrieve', 'select', 'count', 'how many',
      'latest', 'recent', 'list', 'get data', 'check',
    ])) {
      return skills['DataQuery'];
    }

    // 7. "데이터"/"data" alone
    if (lower.indexOf('데이터') >= 0 || lower.indexOf('data') >= 0) {
      return skills['DataQuery'];
    }

    return defaultSkill;
  }

  return { register: register, get: get, classify: classify };
}

module.exports = { createRegistry, containsKeyword };
