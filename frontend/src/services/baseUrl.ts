// LLM 서버 base URL (8884 포트)
function detectLlmBase(): string {
    // 이미 LLM 서버(8884)에서 서빙 중이면 현재 origin 사용
    if (window.location.port && window.location.port !== "5654") {
        return "";
    }
    // machbase-neo(5654)에서 열린 경우 → LLM 서버 포트로 연결
    return `${window.location.protocol}//${window.location.hostname}:8884`;
}

const LLM_BASE = detectLlmBase();

// Config API는 LLM 서버의 /api 사용
export const getApiBase = async (): Promise<string> => {
    return `${LLM_BASE}/api`;
};

// WebSocket은 LLM 서버로 연결
export const getWsBase = async (): Promise<string> => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname;
    const port = LLM_BASE ? "8884" : window.location.port;
    return `${protocol}://${host}:${port}`;
};
