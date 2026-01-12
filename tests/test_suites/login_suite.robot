*** Settings ***
Documentation     A test suite for the Login functionality of HR Plus.
Resource          ../resources/common.resource
Test Setup        Open HR Plus Application
Test Teardown     Close Application

*** Test Cases ***
Verify Login Page Loads
    [Documentation]    Verifies that the login page opens successfully.
    Wait Until Page Contains Element    tag:body    timeout=10s
    Log    Login page loaded successfully.

# Valid Login Test
Login With Valid Credentials
    Input Text    id:login-email    ${USERNAME}
    Input Text    id:login-password    ${PASSWORD}
    Click Button    xpath://button[@type='submit']
    Wait Until Location Contains    /dashboard    timeout=10s
    Log    Login successful and dashboard loaded.
