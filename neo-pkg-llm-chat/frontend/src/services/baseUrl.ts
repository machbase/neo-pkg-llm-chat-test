interface InfoResponse {
    ok: boolean;
    data?: { port: string };
    reason?: string;
}

let cachedPort: Promise<string> | null = null;

// CGI 엔드포인트 — config API용
const CGI_PREFIX = "/public/neo-pkg-llm-chat/cgi-bin/api";

// Config API는 Neo CGI를 직접 사용
export const getApiBase = async (): Promise<string> => {
    return CGI_PREFIX;
};

// LLM 서버 포트 조회 (WS 연결용)
export const getLlmPort = (): Promise<string> => {
    if (cachedPort) return cachedPort;
    const url = `${CGI_PREFIX}/info`;
    cachedPort = fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error(`info.js HTTP ${res.status}`);
            return res.json() as Promise<InfoResponse>;
        })
        .then((body) => {
            if (!body.ok || !body.data?.port) {
                throw new Error(body.reason || "info.js returned no port");
            }
            return body.data.port;
        })
        .catch((err) => {
            cachedPort = null;
            throw err;
        });
    return cachedPort;
};

// WebSocket은 LLM 서버 포트로 연결
export const getWsBase = async (): Promise<string> => {
    const port = await getLlmPort();
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.hostname}:${port}`;
};
