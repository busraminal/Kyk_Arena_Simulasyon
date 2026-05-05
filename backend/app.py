# -*- coding: utf-8 -*-
"""
Yerel FastAPI katmanı: formdan Excel / arena-metrics yükleyip scripts/regenerate_web_reports.py
ve isteğe bağlı scripts/bottleneck_advisor.py çalıştırır.

Çalıştırma (proje kökünden):
  pip install -r requirements-backend.txt
  python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765

Tarayıcı: http://127.0.0.1:8765/

İsteğe bağlı güvenlik (paylaşımlı ağda açmayın; varsayılan yalnızca localhost):
  set KYK_API_TOKEN=gizli  (PowerShell: $env:KYK_API_TOKEN="gizli")
  İstek başlığı: X-API-Token: gizli
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from typing import Annotated
except ImportError:  # Python < 3.9
    from typing_extensions import Annotated

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
WEB_DATA = WEB_DIR / "data"
SCRIPTS = ROOT / "scripts"

MAX_XLSX_BYTES = 40 * 1024 * 1024
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_OUT_BYTES = 20 * 1024 * 1024

app = FastAPI(
    title="KYK Simülasyon — rapor çalıştırıcı",
    description="Excel / arena-metrics yükleyip Python pipeline'ını tetikler.",
    version="1.0.0",
)


def _check_token(x_api_token: Optional[str]) -> None:
    expected = os.environ.get("KYK_API_TOKEN", "").strip()
    if not expected:
        return
    if (x_api_token or "").strip() != expected:
        raise HTTPException(status_code=401, detail="X-API-Token gerekli veya hatalı.")


async def _save_upload(target: Path, upload: UploadFile, max_bytes: int) -> None:
    data = await upload.read()
    if len(data) > max_bytes:
        raise HTTPException(413, f"Dosya çok büyük (>{max_bytes} bayt).")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def _run_script(rel_script: str, args: Optional[List[str]] = None) -> Dict[str, Any]:
    script_path = ROOT / rel_script
    if not script_path.is_file():
        raise HTTPException(500, detail=f"Script bulunamadı: {script_path}")

    cmd = [sys.executable, str(script_path)]
    if args:
        cmd.extend(args)

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=240,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": "Timeout (240 s)",
            "bottleneck_report": None,
        }

    bottleneck_report: Optional[Dict[str, Any]] = None
    br_path = WEB_DATA / "bottleneck-report.json"
    if br_path.exists():
        try:
            bottleneck_report = json.loads(br_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            bottleneck_report = None

    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout": proc.stdout or "",
        "stderr": proc.stderr or "",
        "bottleneck_report": bottleneck_report,
    }


@app.get("/api/health")
def health(
    x_api_token: Annotated[Optional[str], Header(alias="X-API-Token")] = None,
) -> Dict[str, Any]:
    _check_token(x_api_token)
    return {
        "ok": True,
        "project_root": str(ROOT),
        "auth_required": bool(os.environ.get("KYK_API_TOKEN", "").strip()),
    }


@app.post("/api/regenerate")
async def api_regenerate(
    excel: Optional[UploadFile] = File(default=None),
    metrics_json: Optional[UploadFile] = File(default=None),
    x_api_token: Annotated[Optional[str], Header(alias="X-API-Token")] = None,
) -> JSONResponse:
    """İsteğe bağlı dosyaları kaydeder; regenerate_web_reports.py çalıştırır."""
    _check_token(x_api_token)

    if excel is not None and excel.filename:
        name = (excel.filename or "").lower()
        if not name.endswith(".xlsx"):
            raise HTTPException(400, "Excel için .xlsx bekleniyor.")
        await _save_upload(WEB_DATA / "tam_arena_verisi.xlsx", excel, MAX_XLSX_BYTES)

    if metrics_json is not None and metrics_json.filename:
        await _save_upload(WEB_DATA / "arena-metrics.json", metrics_json, MAX_JSON_BYTES)

    result = _run_script("scripts/regenerate_web_reports.py")
    return JSONResponse(content=result)


@app.post("/api/bottleneck-only")
def api_bottleneck_only(
    x_api_token: Annotated[Optional[str], Header(alias="X-API-Token")] = None,
) -> JSONResponse:
    """Yalnızca bottleneck_advisor.py (diskteki arena-metrics.json)."""
    _check_token(x_api_token)
    metrics_path = WEB_DATA / "arena-metrics.json"
    if not metrics_path.exists():
        raise HTTPException(400, detail="arena-metrics.json yok; önce metrik yükleyin veya regenerate çalıştırın.")

    result = _run_script("scripts/bottleneck_advisor.py", [str(metrics_path)])
    return JSONResponse(content=result)


@app.post("/api/arena-out")
async def api_arena_out(
    arena_out: UploadFile = File(...),
    x_api_token: Annotated[Optional[str], Header(alias="X-API-Token")] = None,
) -> JSONResponse:
    """Arena .out dosyasını parse edip arena-metrics + bottleneck rapor üretir."""
    _check_token(x_api_token)
    name = (arena_out.filename or "").lower()
    if not name.endswith(".out"):
        raise HTTPException(400, "Arena çıktısı için .out uzantısı bekleniyor.")

    out_path = WEB_DATA / "arena-summary.out"
    await _save_upload(out_path, arena_out, MAX_OUT_BYTES)

    parser_result = _run_script("scripts/arena_out_parser.py", [str(out_path)])
    if not parser_result.get("ok"):
        return JSONResponse(content=parser_result, status_code=500)

    advisor_result = _run_script("scripts/bottleneck_advisor.py", [str(WEB_DATA / "arena-metrics.json")])
    merged = {
        "ok": bool(advisor_result.get("ok")),
        "exit_code": advisor_result.get("exit_code", -1),
        "stdout": (parser_result.get("stdout", "") + "\n" + advisor_result.get("stdout", "")).strip(),
        "stderr": (parser_result.get("stderr", "") + "\n" + advisor_result.get("stderr", "")).strip(),
        "bottleneck_report": advisor_result.get("bottleneck_report"),
    }
    return JSONResponse(content=merged, status_code=200 if merged["ok"] else 500)


# API route'ları statik dosyadan önce tanımlanır
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="site")
