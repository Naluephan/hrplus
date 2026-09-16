"""
UI coverage matrix: every frontend page, whether a Robot suite reaches it, and
whether the page exposes enough data-testid hooks to be tested without sleeps.

    python scripts/ui_coverage.py ../hr-frontend > docs/UI_COVERAGE.md

"Reached" means a suite navigates to the route. It is a floor, not a verdict:
a page can be reached and still have most of its functions untested.

Testids are counted in the page's own directory *and* in the page-specific
components it imports (followed two levels deep). Many settings pages are thin
wrappers around a component in `components/settings/`; counting only the page
directory reports those as having no hooks when they already do. Generic
building blocks (`components/ui`, `components/common`) are not followed, so a
shared save button does not make every page look instrumented.
"""

from __future__ import annotations

import glob
import os
import re
import sys
from collections import defaultdict

TESTID = re.compile(r'data-testid=(?:\{`([^`]+)`\}|"([^"]+)"|\{"([^"]+)"\})|testId=(?:\{`([^`]+)`\}|"([^"]+)")')
IMPORT = re.compile(r'''from\s+["']([^"']+)["']''')
STATE_MARKERS = ('page.ready', 'page.loading', 'page.error')
SOURCE_EXTS = ('.tsx', '.ts', '.jsx')
GENERIC_DIRS = (os.path.join('components', 'ui'), os.path.join('components', 'common'))
FOLLOW_DEPTH = 2


def route_of(page_dir: str, app_root: str) -> str:
    rel = os.path.relpath(page_dir, app_root)
    parts = [] if rel == '.' else rel.split(os.sep)
    parts = [p for p in parts if not (p.startswith('(') and p.endswith(')'))]
    parts = [':id' if (p.startswith('[') and p.endswith(']')) else p for p in parts]
    return '/' + '/'.join(parts)


def own_files(page_dir: str, page_dirs: set[str]) -> list[str]:
    """Source files in the page directory, not descending into nested pages."""
    found: list[str] = []
    for root, dirs, files in os.walk(page_dir):
        dirs[:] = [d for d in dirs if os.path.join(root, d) not in page_dirs and d != 'node_modules']
        found += [os.path.join(root, f) for f in files if f.endswith(SOURCE_EXTS)]
    return found


def resolve_import(spec: str, importer: str, frontend: str) -> str | None:
    if spec.startswith('@/'):
        base = os.path.join(frontend, *spec[2:].split('/'))
    elif spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(importer), *spec.split('/')))
    else:
        return None
    candidates = [base] if base.endswith(SOURCE_EXTS) else []
    candidates += [base + ext for ext in SOURCE_EXTS]
    candidates += [os.path.join(base, 'index' + ext) for ext in SOURCE_EXTS]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return None


def followable(path: str, frontend: str) -> bool:
    rel = os.path.relpath(path, frontend)
    if not (rel.startswith('app' + os.sep) or rel.startswith('components' + os.sep)):
        return False
    return not any(rel.startswith(generic + os.sep) for generic in GENERIC_DIRS)


def page_testids(page_dir: str, page_dirs: set[str], frontend: str) -> list[str]:
    frontier = own_files(page_dir, page_dirs)
    seen: set[str] = set()
    testids: list[str] = []
    for depth in range(FOLLOW_DEPTH + 1):
        next_frontier: list[str] = []
        for path in frontier:
            if path in seen:
                continue
            seen.add(path)
            text = open(path, encoding='utf-8', errors='ignore').read()
            testids += [next(g for g in groups if g) for groups in TESTID.findall(text)]
            # PageStateMarker builds `<page>.page.<state>` at runtime, so the literal
            # never appears in source. Rendering it is what declares the markers.
            if '<PageStateMarker' in text:
                testids.append('page-state-marker.page.ready')
            if depth == FOLLOW_DEPTH:
                continue
            for spec in IMPORT.findall(text):
                target = resolve_import(spec, path, frontend)
                if target and target not in seen and followable(target, frontend):
                    next_frontier.append(target)
        frontier = next_frontier
    return testids


def reached_routes(test_root: str) -> set[str]:
    blob = ''
    for pattern in ('tests/**/*.robot', 'tests/**/*.resource', 'resources/**/*.resource'):
        for path in glob.glob(os.path.join(test_root, pattern), recursive=True):
            blob += open(path, encoding='utf-8', errors='replace').read() + '\n'
    hits = set(re.findall(r'(?:\$\{URL\}|Check Url\s+|Navigate To Menu\s+\S+\s+\S+\s+)(/[A-Za-z0-9_\-/]+)', blob))
    hits |= set(re.findall(r'\s(/[a-z][a-z0-9\-]*(?:/[A-Za-z0-9_\-]+)*)', blob))
    return {h.rstrip('/') or '/' for h in hits}


def is_reached(route: str, reached: set[str]) -> bool:
    pattern = '^' + re.escape(route).replace(':id', '[^/]+') + '$'
    return any(re.match(pattern, r) for r in reached)


def readiness(testids: list[str]) -> str:
    if any(t.endswith(STATE_MARKERS) for t in testids):
        return 'ready'
    return 'partial' if testids else 'none'


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    frontend = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '../hr-frontend')
    here = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    app_root = os.path.join(frontend, 'app')

    page_dirs = {os.path.dirname(p) for p in glob.glob(os.path.join(app_root, '**', 'page.tsx'), recursive=True)}
    reached = reached_routes(here)

    rows = []
    for page_dir in sorted(page_dirs):
        route = route_of(page_dir, app_root)
        ids = page_testids(page_dir, page_dirs - {page_dir}, frontend)
        rows.append((route, is_reached(route, reached), len(set(ids)), readiness(ids)))

    areas: dict[str, list] = defaultdict(list)
    for row in rows:
        areas[row[0].split('/')[1] or '/'].append(row)

    total, reached_n = len(rows), sum(1 for r in rows if r[1])
    ready_n = sum(1 for r in rows if r[3] == 'ready')
    none_n = sum(1 for r in rows if r[3] == 'none')

    print('# UI Coverage Matrix\n')
    print('Generated by `python scripts/ui_coverage.py ../hr-frontend`. Do not edit by hand.\n')
    print('| | pages |\n| --- | --- |')
    print(f'| frontend pages | {total} |')
    print(f'| reached by a Robot suite | {reached_n} ({reached_n * 100 // total}%) |')
    print(f'| declare page state markers (testable without sleeps) | {ready_n} |')
    print(f'| no data-testid at all, including imported page components | {none_n} |\n')
    print('**Reached** means a suite navigates to the page — a floor, not proof that its functions are tested.  ')
    print('**Testids** are distinct ids in the page and the page-specific components it imports '
          '(two levels; `components/ui` and `components/common` excluded).  ')
    print('**Readiness** — `ready`: declares `page.ready/loading/error`; `partial`: some testids; `none`: nothing to hold on to.\n')

    print('## By area\n')
    print('| area | pages | reached | ready | none |\n| --- | ---: | ---: | ---: | ---: |')
    for area, items in sorted(areas.items(), key=lambda kv: -len(kv[1])):
        print(f"| {area} | {len(items)} | {sum(1 for r in items if r[1])} | "
              f"{sum(1 for r in items if r[3] == 'ready')} | {sum(1 for r in items if r[3] == 'none')} |")

    print('\n## Every page\n')
    print('| route | reached | testids | readiness |\n| --- | :---: | ---: | --- |')
    for route, hit, n, ready in rows:
        print(f"| `{route}` | {'✅' if hit else '—'} | {n} | {ready} |")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
