*** Settings ***
Library    Browser    timeout=30s
Resource   variables.resource

*** Keywords ***
Open HR Plus Application
    New Browser    browser=${BROWSER}    headless=False
    New Context    viewport={'width': 1280, 'height': 720}
    Set Browser Timeout    30s
    New Page    ${URL}

Close Application
    Close Browser

Login To Application
    Go To    ${URL}/login
    Wait For Elements State    id=login-email    visible    timeout=20s
    Fill Text    id=login-email    ${LOGIN_EMAIL}
    Fill Text    id=login-password    ${LOGIN_PASSWORD}
    Click    xpath=//button[@type='submit']
    Wait For Condition    Url    contains    /dashboard    timeout=20s
    Log    Login successful.
