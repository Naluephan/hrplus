*** Settings ***
Resource        ../../resources/common.resource

# Use session state to skip login step
Test Setup       Run Keywords    Open HR Plus Application    AND    Login To Application
Test Teardown    Close Application

*** Test Cases ***
Verify Dashboard Access
    [Documentation]    Just checking if we are logged in.
    [Tags]    smoke    hr
    # Login To Application is already in Test Setup
    ${url}=    Get Url
    Should Contain    ${url}    /employees/dashboard

# Create Employee Flow
#     [Documentation]    Example flow that requires login.
#     [Tags]    hr    employee
#     # Login To Application is already in Test Setup
#     Go To    ${URL}/employees
#     Wait For Elements State    css=[data-testid="employees.page.root"]    visible    timeout=30s
