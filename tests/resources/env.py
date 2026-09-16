import os
from dotenv import load_dotenv

# Construct path to .env file (root of project)
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, '..', '..'))
env_path = os.path.join(project_root, '.env')

# Override system variables with .env values
load_dotenv(env_path, override=True)

URL = os.getenv("URL", "http://localhost:8001")
BROWSER = os.getenv("BROWSER", "chromium")

# Headless by default: rendering a visible window costs CPU on every step and
# gains nothing unattended. Run headed to watch a test: robot -v HEADLESS:false
HEADLESS = os.getenv("HEADLESS", "true").strip().lower() not in ("0", "false", "no")
# Use specific names to avoid conflict with system USERNAME
LOGIN_EMAIL = os.getenv("USERNAME", "ops@central.local")
LOGIN_PASSWORD = os.getenv("PASSWORD", "ChangeMe123!")

SESSION_PATH = os.getenv("SESSION_PATH", os.path.join(current_dir, "../../.auth/admin_state.json"))

# Legacy variable support for 'users' dict expected by some tests
users = {
    "admin": {
        "username": LOGIN_EMAIL,
        "password": LOGIN_PASSWORD
    }
}
