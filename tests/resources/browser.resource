*** Settings ***
Library    Browser    timeout=60s
Library    OperatingSystem
Resource   variables.resource

*** Keywords ***
Start Browser
    [Arguments]    ${url}=${URL}    ${headless}=False    ${load_session}=True
    New Browser    browser=${BROWSER}    headless=${headless}
    
    # Ensure session directory exists
    ${session_dir}=    Evaluate    os.path.dirname(r"${SESSION_PATH}")    modules=os
    Create Directory    ${session_dir}

    # Check for existing session only if load_session is True
    ${session_exists}=    Run Keyword And Return Status    File Should Exist    ${SESSION_PATH}
    
    IF    ${load_session} and ${session_exists}
        New Context    viewport={'width': 1280, 'height': 720}    storageState=${SESSION_PATH}
        Log    Loaded session from ${SESSION_PATH}
    ELSE
        New Context    viewport={'width': 1280, 'height': 720}
        Log    Starting fresh context (Session loaded: ${load_session}, Exists: ${session_exists})
    END
    
    New Page    ${url}

Save Current Session
    [Documentation]    Saves the current browser context state (cookies, local storage) to a file.
    ${temp_state}=    Save Storage State
    Move File    ${temp_state}    ${SESSION_PATH}
    Log    Saved session to ${SESSION_PATH}

Close Application
    Close Browser
