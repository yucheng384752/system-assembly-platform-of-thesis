"""
本機 LLM 轉接層（開發與測試工具，不隨系統包出貨）。

來源：user 在 Analytical-Four 專案本機加的轉接層（該專案未提交此檔）。放進本專案時的修改：
失敗時回 HTTP 502 而不是 200 加保底結果；預設只綁回送位址，其餘用環境變數覆寫
（ADAPTER_HOST、ADAPTER_PORT、OLLAMA_URL、OLLAMA_MODEL）。用法見 docs/analytical-four-kit.md 第 9 節。

以下為原說明。

本機 LLM 轉接層。

模擬原本 llm_setting.api_endpoint（http://192.168.178.208:8000/diagnose）的介面，
但背後改叫本機 Ollama（qwen3:14b）產生 llm_analysis / conclusion。

main.py 完全不用改：analyze_with_llm() 仍然是 requests.post(self.llm_api, json=data)，
只要把 config 的 data_source.llm_setting.api_endpoint 改成
http://127.0.0.1:8001/diagnose 即可切換（同機呼叫用 127.0.0.1；若要給 LAN 上的 VM
連，改用本機的 LAN IP，見部署說明）。

輸入 (main.py 送來的 data)：
    {"new_event": <extract_search_key() 的完整 schema>, "top3_cases": [...], "error_hints": [...]}

輸出：完整 new_event dict，只有 llm_analysis / conclusion 兩個欄位被改寫，
    其餘欄位（summary / diagnosis_results / error_analysis / feedback）原樣保留，
    與舊的遠端服務行為一致。
    Ollama 呼叫失敗或回應無法解析時回 HTTP 502（{"error": "llm_unavailable", ...}），
    不再回傳 200 加保底結果。

啟動：
    python analysis/prescriptive/local_llm_server.py
    （需先在另一個視窗跑 `ollama serve`，並確認已 `ollama pull qwen3:14b`）
"""
import copy
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

OLLAMA_CHAT_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
MODEL_NAME = os.environ.get("OLLAMA_MODEL", "qwen3:14b")
LISTEN_HOST = os.environ.get("ADAPTER_HOST", "127.0.0.1")  # 要給 LAN 上的 VM 連時才明確改成 0.0.0.0
LISTEN_PORT = int(os.environ.get("ADAPTER_PORT", "8001"))  # 8000 已被 Docker Desktop 佔用（Windows SO_REUSEADDR 會讓兩個行程同時綁同一個 0.0.0.0:8000，流量歸屬不可靠，故避開）
REQUEST_TIMEOUT = 120  # 秒

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("local_llm_server")

SYSTEM_PROMPT = (
    "你是製造業品質異常診斷助理，任務是根據系統提供的規則式診斷結果、"
    "歷史相似案例與誤判紀錄，用繁體中文寫出審核意見。\n"
    "規則：\n"
    "1. evidence_for / evidence_against 只能根據給定的 summary、diagnosis_results、"
    "top3_cases、error_hints 內容推論，不可捏造未提供的數據。\n"
    "2. similar_cases 只能從 top3_cases 中挑選你認為真的支持結論的 event_id，"
    "不相關就不要放進去，可以是空陣列。\n"
    "3. 只輸出符合 JSON schema 的結果，不要有其他文字。"
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "evidence_for": {"type": "array", "items": {"type": "string"}},
        "evidence_against": {"type": "array", "items": {"type": "string"}},
        "uncertainty": {"type": "string"},
        "case_agreement": {"type": "boolean"},
        "similar_cases": {"type": "array", "items": {"type": "string"}},
        "conclusion": {
            "type": "object",
            "properties": {
                "final_ng": {"type": "string"},
                "source": {"type": "string"},
                "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                "action": {"type": "string"},
                "needs_human": {"type": "boolean"},
            },
            "required": ["final_ng", "source", "confidence", "action", "needs_human"],
        },
    },
    "required": [
        "evidence_for", "evidence_against", "uncertainty",
        "case_agreement", "similar_cases", "conclusion",
    ],
}


def _build_user_prompt(new_event: dict, top3_cases: list, error_hints) -> str:
    payload = {
        "summary": new_event.get("summary", {}),
        "diagnosis_results": new_event.get("diagnosis_results", {}),
        "top3_cases": top3_cases,
        "error_hints": error_hints or [],
    }
    return (
        "以下是本次異常事件的規則式診斷結果與相關案例（JSON）：\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n\n請根據上述資料，輸出審核意見（JSON）。"
    )


class UpstreamError(Exception):
    """Ollama could not produce a usable answer. Reported to the caller as HTTP 502, never as a 200 with placeholder text."""


def diagnose(new_event: dict, top3_cases: list, error_hints) -> dict:
    valid_ids = {c.get("event_id") for c in top3_cases if isinstance(c, dict)}

    ollama_payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(new_event, top3_cases, error_hints)},
        ],
        "format": RESPONSE_SCHEMA,
        "think": False,
        "stream": False,
        "options": {"temperature": 0.2},
    }

    try:
        resp = requests.post(OLLAMA_CHAT_URL, json=ollama_payload, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        content = resp.json()["message"]["content"]
        parsed = json.loads(content)
    except Exception as e:
        logger.error("Ollama 呼叫失敗: %s", e)
        raise UpstreamError(f"{type(e).__name__}: {e}") from e

    # 規則式過濾，不信任模型輸出：similar_cases 只能是 top3_cases 裡真的存在的 event_id
    similar_cases = [eid for eid in parsed.get("similar_cases", []) if eid in valid_ids]

    result = copy.deepcopy(new_event)  # 其餘欄位（summary/diagnosis_results/...）原樣保留
    result["llm_analysis"] = {
        "evidence_for": parsed.get("evidence_for", []),
        "evidence_against": parsed.get("evidence_against", []),
        "uncertainty": parsed.get("uncertainty", ""),
        "similar_cases": similar_cases,
        "case_agreement": parsed.get("case_agreement"),
    }
    result["conclusion"] = parsed.get("conclusion", {})
    return result


class DiagnoseHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info("%s - %s", self.address_string(), fmt % args)

    def do_POST(self):
        if self.path != "/diagnose":
            self.send_error(404, "Not Found")
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
            new_event = body["new_event"]
            top3_cases = body.get("top3_cases", [])
            error_hints = body.get("error_hints")
        except Exception as e:
            self.send_error(400, f"Bad Request: {e}")
            return

        try:
            result = diagnose(new_event, top3_cases, error_hints)
            status = 200
        except UpstreamError as e:
            # 失敗要讓呼叫端看得見：回 502，呼叫端（Kit 或 main.py）會把這一步標為失敗，而不是收到一份看似成功的保底結果。
            result = {"error": "llm_unavailable", "detail": str(e)}
            status = 502

        payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    logger.info(
        "本機 LLM 轉接層啟動：http://%s:%d/diagnose (model=%s)",
        LISTEN_HOST, LISTEN_PORT, MODEL_NAME,
    )
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), DiagnoseHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("收到中斷訊號，關閉伺服器")
        server.shutdown()


if __name__ == "__main__":
    main()
