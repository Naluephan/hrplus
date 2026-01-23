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
# Use specific names to avoid conflict with system USERNAME
LOGIN_EMAIL = os.getenv("USERNAME", "ops@central.local")
LOGIN_PASSWORD = os.getenv("PASSWORD", "ChangeMe123!")
