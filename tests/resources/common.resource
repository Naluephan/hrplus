*** Settings ***
Library    Browser    timeout=60s
Resource   browser.resource
# Resource   variables.resource

*** Keywords ***
Open HR Plus Application
    [Arguments]    ${load_session}=True
    Start Browser    ${URL}    load_session=${load_session}

Login To Application
    Go To    ${URL}/login
    
    # Check if we are already logged in
    ${url}=    Get Url
    ${is_dashboard}=    Run Keyword And Return Status    Should Contain    ${url}    /dashboard
    
    IF    not ${is_dashboard}
        Wait For Elements State    id=login-email    visible    timeout=30s
        Fill Text    id=login-email    ${LOGIN_EMAIL}
        Fill Text    id=login-password    ${LOGIN_PASSWORD}
        Wait For Elements State    xpath=//button[@type='submit']    enabled    timeout=30s
        Click    xpath=//button[@type='submit']
        
        # Verify login success
        # Verify login success
        Wait Until Keyword Succeeds    60s    1s    Check Url    /dashboard
        
        # Save session
        Save Current Session
    ELSE
        Log    Already logged in via session.
    END

Check Url
    [Arguments]    ${expected_path}
    ${url}=    Get Url
    Should Contain    ${url}    ${expected_path}
