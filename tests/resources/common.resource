*** Settings ***
Library    SeleniumLibrary
Resource   variables.resource

*** Keywords ***
Open HR Plus Application
    Open Browser    ${URL}    ${BROWSER}
    Maximize Browser Window

Close Application
    Close Browser

Login To Application
    Input Text    id:login-email    ${USERNAME}
    Input Text    id:login-password    ${PASSWORD}
    Click Button    xpath://button[@type='submit']
    Wait Until Location Contains    /dashboard    timeout=10s
    Log    Login successful.
