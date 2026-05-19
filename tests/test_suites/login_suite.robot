*** Settings ***
Documentation     A test suite for the Login functionality of HR Plus.
Resource          ../resources/common.resource
Test Setup        Open HR Plus Application    load_session=False
Test Teardown     Close Application

*** Test Cases ***
Verify Login Page Loads
    [Documentation]    Verifies that the login page opens successfully.
    [Tags]    smoke
    Wait For Elements State    css=body    visible    timeout=60s
    Log    Login page loaded successfully.

# Valid Login Test
# Login With Valid Credentials
#     [Tags]    critical
#     Fill Text    id=login-email    ${LOGIN_EMAIL}
#     Fill Text    id=login-password    ${LOGIN_PASSWORD}
#     Click    xpath=//button[@type='submit']
#     Wait For Condition    Url    contains    /dashboard    timeout=10s
#     Log    Login successful and dashboard loaded.

Login With Invalid Credentials
    [Documentation]    Verifies that login fails with incorrect credentials.
    [Tags]    negative
    Fill Text    id=login-email    ${LOGIN_EMAIL}
    Fill Text    id=login-password    WrongPassword123!
    Click    xpath=//button[@type='submit']
    # Check for error message or lack of redirect
    Sleep    2s
    Wait For Condition    Url    contains    /login
    Wait For Elements State    id=user-menu    detached
