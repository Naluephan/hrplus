*** Settings ***
Library    Browser
Resource   tests/resources/common.resource

*** Test Cases ***
Debug Login Page
    New Browser    browser=${BROWSER}    headless=False
    New Context    viewport={'width': 1280, 'height': 720}
    New Page       ${URL}
    Sleep          5s
    Take Screenshot    filename=debug_home_page
    Log    Opened Home Page
    
    Go To          ${URL}/login
    Sleep          5s
    Take Screenshot    filename=debug_login_page_5s
    Log    Navigated to Login
    
    Wait For Elements State    id=login-email    visible    timeout=10s
    Take Screenshot    filename=debug_login_found
    Log    Found Login Email
