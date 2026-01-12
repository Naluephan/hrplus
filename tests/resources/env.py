import os
from dotenv import load_dotenv

load_dotenv()

URL = os.getenv("URL")
BROWSER = os.getenv("BROWSER")
USERNAME = os.getenv("USERNAME")
PASSWORD = os.getenv("PASSWORD")
