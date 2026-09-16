"""
ตรวจว่าหน้าจอฝั่ง frontend ประกาศ data-testid ครบตามสัญญาใน docs/TESTING_STANDARDS.md แล้วหรือยัง

    python scripts/audit_testids.py ../hr-frontend

รายงานจะบอกเป็นรายหน้าว่า marker ตัวไหนขาด เพื่อให้ทีม frontend เติมได้ตรงจุด
และเพื่อให้เรารู้ว่าหน้าไหนพร้อมเขียน UI E2E แบบไม่ต้องใช้การรอตามเวลาแล้วบ้าง
"""

from __future__ import annotations

import io
import re
import sys
from collections import defaultdict
from pathlib import Path

TESTID_PATTERN = re.compile(r'data-testid=(?:\{`([^`]+)`\}|"([^"]+)"|\{"([^"]+)"\})')

# marker ที่ทุกหน้าซึ่งดึงข้อมูลต้องมี (docs/TESTING_STANDARDS.md §2 และ §9)
REQUIRED_SUFFIXES = [
    "page.loading",
    "page.ready",
    "page.error",
    "toolbar.add",
    "search.input",
    "table",
    "toast.success",
    "toast.error",
]

SOURCE_DIRS = ("app", "components")
SOURCE_SUFFIXES = (".tsx", ".ts", ".jsx", ".js")

# namespace ที่ไม่ใช่ "หน้า" — เป็นคอมโพเนนต์ร่วมหรือ id ที่ประกอบขึ้นตอนรัน
NON_PAGE_NAMESPACES = {"common", "sidebar", "wizard", "pagination"}


def collect_testids(frontend_root: Path) -> set[str]:
    found: set[str] = set()
    for directory in SOURCE_DIRS:
        base = frontend_root / directory
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SOURCE_SUFFIXES or "node_modules" in path.parts:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for groups in TESTID_PATTERN.findall(text):
                value = next(group for group in groups if group)
                found.add(value)
    return found


def group_by_page(testids: set[str]) -> dict[str, set[str]]:
    pages: dict[str, set[str]] = defaultdict(set)
    for testid in testids:
        page, _, rest = testid.partition(".")
        if not rest:
            continue
        # ข้าม id ที่ประกอบจากตัวแปรตอนรัน และ namespace ที่ไม่ใช่หน้า
        if "${" in page or "-" in page or page in NON_PAGE_NAMESPACES:
            continue
        pages[page].add(rest)
    return pages


def main() -> int:
    # Windows console defaults to cp1252 and would choke on the Thai output.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    frontend_root = Path(sys.argv[1] if len(sys.argv) > 1 else "../hr-frontend").resolve()
    if not frontend_root.is_dir():
        print(f"ไม่พบโฟลเดอร์ frontend: {frontend_root}")
        return 2

    pages = group_by_page(collect_testids(frontend_root))
    if not pages:
        print("ไม่พบ data-testid เลย — ตรวจ path ที่ส่งเข้ามาอีกครั้ง")
        return 2

    print(f"ตรวจ data-testid จาก {frontend_root}\n")
    print(f"{'หน้า':<24}{'มี/ต้องมี':<12}marker ที่ยังขาด")
    print("-" * 100)

    total_missing = 0
    for page in sorted(pages):
        suffixes = pages[page]
        missing = [suffix for suffix in REQUIRED_SUFFIXES if suffix not in suffixes]
        total_missing += len(missing)
        have = len(REQUIRED_SUFFIXES) - len(missing)
        summary = "ครบ" if not missing else ", ".join(f"{page}.{item}" for item in missing)
        print(f"{page:<24}{have}/{len(REQUIRED_SUFFIXES):<11}{summary}")

    print("-" * 100)
    print(f"รวม marker ที่ยังขาดทั้งหมด: {total_missing}")
    print("\nหน้าที่ยังขาด page.loading / page.ready จะเขียน UI E2E แบบไม่ใช้ Sleep ไม่ได้")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
