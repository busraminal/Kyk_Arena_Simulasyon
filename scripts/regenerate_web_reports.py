# -*- coding: utf-8 -*-
"""
Tek komutla web rapor çıktılarını yeniler:

1. tam_arena_verisi.xlsx üzerinde ki-kare / KS testleri → stat-fit-tests.json + .js
2. Varsa arena-metrics.json → arena-metrics.js (tarayıcı gömülü metrikler)
3. arena-metrics + isteğe bağlı stat-fit-tests ile bottleneck-report.json / .js (darboğaz özeti)

Arena simülasyonunun kendisi burada çalıştırılmaz; koşuyu Arena'da alıp .out / özet
JSON'unuzu güncellersiniz. Entity düzeyinde Excel değişince bu script testleri ve
grafik verisini otomatik yeniden üretir.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web" / "data"


def embed_json_window_var(json_name: str, window_var: str) -> bool:
    jp = WEB_DATA / json_name
    if not jp.exists():
        print(f"[atlandı] {jp.name} yok")
        return False
    obj = json.loads(jp.read_text(encoding="utf-8"))
    js_name = json_name.replace(".json", ".js")
    jsp = WEB_DATA / js_name
    jsp.write_text(f"window.{window_var} = {json.dumps(obj, ensure_ascii=False)};\n", encoding="utf-8")
    print("OK ->", jsp)
    return True


def main() -> int:
    WEB_DATA.mkdir(parents=True, exist_ok=True)

    # İstatistik testleri (Excel)
    try:
        scripts_dir = Path(__file__).resolve().parent
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        from stat_fit_tests import main as run_stat_tests

        run_stat_tests()
    except Exception as e:
        print("stat_fit_tests hatası:", e, file=sys.stderr)
        return 1

    embed_json_window_var("arena-metrics.json", "__ARENA_METRICS__")

    try:
        from bottleneck_advisor import main as run_bottleneck_advisor

        run_bottleneck_advisor([])
    except Exception as e:
        print("bottleneck_advisor:", e, file=sys.stderr)

    print("\nDone. Hard-refresh the browser if you open index.html via file://.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
