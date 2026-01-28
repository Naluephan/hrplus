*** Settings ***
Resource    ../common/browser.resource
Resource    ../pages/login_page.resource

*** Keywords ***
Login As Role
    [Arguments]    ${role}
    ${username}=    Set Variable    ${users['${role}']['username']}
    ${password}=    Set Variable    ${users['${role}']['password']}
    
    Login With    ${username}    ${password}
    Should See Dashboard

Prepare Auth State For Role
    [Arguments]    ${role}=admin
    Open App    headless=${headless}
    Login As Role    ${role}
    
    # Save State
    ${state_file}=    Set Variable    ${AUTH_DIR}/${role}_state.json
    ${temp_state}=    Save Storage State
    Move File    ${temp_state}    ${state_file}
    Log    Auth state prepared for ${role} at ${state_file}
    Close App

Ensure Logged In
    [Arguments]    ${role}=admin
    [Documentation]    Checks if logged in. If not, performs login and saves state.
    
    # Simple check for dashboard URL or specific element
    ${is_logged_in}=    Run Keyword And Return Status    Wait For Condition    Url    contains    /dashboard    timeout=5s
    
    IF    not ${is_logged_in}
        Log    Session invalid or missing. Logging in as ${role}...
        Login As Role    ${role}
        
        # Verify success
        Wait For Condition    Url    contains    /dashboard    timeout=30s
        
        # Save State
        ${state_file}=    Set Variable    ${AUTH_DIR}/${role}_state.json
        ${temp_state}=    Save Storage State
        Move File    ${temp_state}    ${state_file}
        Log    Saved auth state to ${state_file}
    ELSE
        Log    Already logged in as ${role}.
    END
