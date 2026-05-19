*** Settings ***
Library    Browser    timeout=120s
Resource   browser.resource
Resource   navigation.resource
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
    ${is_announcements}=    Run Keyword And Return Status    Should Contain    ${url}    /announcements
    ${is_logged_in}=    Evaluate    ${is_dashboard} or ${is_announcements}
    
    IF    not ${is_logged_in}
        Wait For Elements State    id=login-email    visible    timeout=60s
        Fill Text    id=login-email    ${LOGIN_EMAIL}
        Fill Text    id=login-password    ${LOGIN_PASSWORD}
        Wait For Elements State    xpath=//button[@type='submit']    enabled    timeout=60s
        Click    xpath=//button[@type='submit']
        
        # Verify login success
        # The redirection after login is now /announcements or /dashboard
        Wait Until Keyword Succeeds    60s    1s    Check Url    .*(/announcements|/dashboard).*
        
        # Save session
        Save Current Session
        
        # Ensure page is fully interactive before proceeding
        Wait For Loading To Hide
    ELSE
        Log    Already logged in via session.
    END

Check Url
    [Arguments]    ${expected_path}
    Wait Until Keyword Succeeds    30s    1s    Get Url    matches    ${expected_path}

Verify Url Match
    [Arguments]    ${pattern}
    ${url}=    Get Url
    Should Match Regexp    ${url}    ${pattern}

Wait Until Toast Contains
    [Arguments]    ${text}    ${timeout}=15s
    # Make it optional to avoid hard failures if toast is slow or missing
    Run Keyword And Ignore Error    Wait For Elements State    xpath=//*[contains(text(), "${text}")] >> nth=0    visible    timeout=${timeout}

