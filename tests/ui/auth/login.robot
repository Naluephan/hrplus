*** Settings ***

Resource    ../../resources/common.resource

Test Setup       Open HR Plus Application    load_session=False
Test Teardown    Close Application

*** Test Cases ***
Login Success
    [Tags]    auth    smoke
    Go To    ${URL}/login
    Fill Text    id=login-email    ${LOGIN_EMAIL}
    Fill Text    id=login-password    ${LOGIN_PASSWORD}
    Click    xpath=//button[@type='submit']
    # Add assertions for success if needed, e.g. URL check
    Wait Until Keyword Succeeds    10s    1s    Check Url    /employees/dashboard

Login Fail
    [Documentation]    Verifies that login fails with incorrect credentials.
    [Tags]    auth    smoke
    Go To    ${URL}/login
    Fill Text    id=login-email    invalid@user.com
    Fill Text    id=login-password    wrongpass
    Click    xpath=//button[@type='submit']
    
    # Check for error message
    ${error}=    Get Text    css=.text-danger
    Should Contain    ${error}    Invalid email or password.
