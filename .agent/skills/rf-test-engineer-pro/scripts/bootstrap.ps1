$ErrorActionPreference = "Stop"

if (!(Test-Path ".venv")) { python -m venv .venv }
. .\.venv\Scripts\Activate.ps1
python -m pip install -U pip

if (!(Test-Path "requirements-test.txt")) {
    @"
robotframework>=7.0
robotframework-browser>=19.0
"@ | Out-File -Encoding utf8 requirements-test.txt
}

pip install -r requirements-test.txt

try { rfbrowser init } catch { python -m Browser.entry init }
Write-Host "Bootstrap complete."
