$ErrorActionPreference = "Stop"
. .\.venv\Scripts\Activate.ps1
if (!(Test-Path "reports")) { New-Item -ItemType Directory reports | Out-Null }

robot -d reports -L INFO -i regression tests
