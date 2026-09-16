"""
Robot keyword library: how much life is left in a saved login session.

Central issues the access token and the refresh token with a one-hour lifetime,
and rotates (blacklists) the refresh token every time the page silently
refreshes. A test that starts from a session file close to that one-hour cliff
gets logged out part-way through, which shows up as a random redirect to
/login. Checking the remaining lifetime *before* a test starts turns that
randomness into a deliberate, early re-login.

Usage in a resource file:

    Library    session_lifetime.py

    ${minutes}=    Session Minutes Left    ${session_file}
"""

from __future__ import annotations

import json
import os
import time

# Cookies whose expiry ends the session. The shortest-lived one wins.
SESSION_COOKIES = ("hr_access_token", "central_refresh_token_sub_module")


def session_minutes_left(session_file: str, cookies: str = ",".join(SESSION_COOKIES)) -> float:
    """Minutes until the first of the session cookies expires.

    Returns -1 when the file is missing, unreadable, or holds none of the
    cookies — every case in which the caller should log in afresh.
    """
    if not os.path.isfile(session_file):
        return -1.0

    try:
        with open(session_file, encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        return -1.0

    wanted = {name.strip() for name in cookies.split(",") if name.strip()}
    expiries = [
        float(cookie["expires"])
        for cookie in state.get("cookies", [])
        if cookie.get("name") in wanted and float(cookie.get("expires", -1)) > 0
    ]
    if not expiries:
        return -1.0

    return round((min(expiries) - time.time()) / 60.0, 1)


def session_cookie(session_file: str, name: str) -> str:
    """Value of one cookie in a saved session file, or an empty string.

    Lets a suite discover facts about the logged-in user — such as the tenant
    in the `hr-tenant-id` cookie — without another round trip through the UI.
    """
    if not os.path.isfile(session_file):
        return ""
    try:
        with open(session_file, encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        return ""
    for cookie in state.get("cookies", []):
        if cookie.get("name") == name:
            return str(cookie.get("value", ""))
    return ""
