*** Settings ***
Library    Browser
Library    OperatingSystem
Library    String

*** Variables ***
${AUTH_DIR}         ${CURDIR}/../../.auth
${DEFAULT_TIMEOUT}  30s
# Defaults for IDE/Local run (overridden by -V data/env/dev.yaml)
${headless}         false
${browser}          chromium
${base_url}         http://localhost:8001

*** Keywords ***
Open App
    [Arguments]    ${headless}=${headless}
    New Browser    browser=${browser}    headless=${headless}
    New Context    viewport={'width': 1280, 'height': 720}
    Set Browser Timeout    ${DEFAULT_TIMEOUT}
    New Page    ${base_url}

Open App With Auth State
    [Arguments]    ${role}=admin
    ${state_file}=    Set Variable    ${AUTH_DIR}/${role}_state.json
    ${exists}=    Run Keyword And Return Status    File Should Exist    ${state_file}
    
    New Browser    browser=${browser}    headless=${headless}
    
    IF    ${exists}
        New Context    viewport={'width': 1280, 'height': 720}    storageState=${state_file}
    ELSE
        New Context    viewport={'width': 1280, 'height': 720}
    END
    
    Set Browser Timeout    ${DEFAULT_TIMEOUT}
    New Page    ${base_url}

Close App
    Close Browser
