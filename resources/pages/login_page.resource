*** Settings ***
Library    Browser

*** Keywords ***
Login With
    [Arguments]    ${username}    ${password}
    Wait For Elements State    id=login-email    visible
    Fill Text    id=login-email    ${username}
    Fill Text    id=login-password    ${password}
    Click    button[type='submit']

Is Login Page Visible
    ${visible}=    Run Keyword And Return Status    Wait For Elements State    id=login-email    visible    timeout=5s
    RETURN    ${visible}

Should See Dashboard
    Wait For Condition    Url    contains    /dashboard    timeout=30s
