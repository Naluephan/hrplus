*** Settings ***
Documentation    Employee Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Employee via API
    [Documentation]    Creates a new employee and returns their generated ID.
    [Arguments]        ${first_name}    ${last_name}    ${email}    ${dept_id}=${None}    ${pos_id}=${None}
    ${payload}=        Create Dictionary
    ...                firstName=${first_name}
    ...                lastName=${last_name}
    ...                email=${email}
    Run Keyword If     '${dept_id}' != '${None}'    Set To Dictionary    ${payload}    departmentId=${dept_id}
    Run Keyword If     '${pos_id}' != '${None}'     Set To Dictionary    ${payload}    positionId=${pos_id}
    ${response}=       Send POST Request Wrapper    /employees    ${payload}    expected_status=201
    ${emp_id}=         Get From Dictionary    ${response.json()}    id
    Log                Employee created with ID: ${emp_id}
    RETURN             ${emp_id}    ${response.json()}

Get Employee Profile via API
    [Documentation]    Retrieves employee details by ID.
    [Arguments]        ${emp_id}
    ${response}=       Send GET Request Wrapper    /employees/${emp_id}    expected_status=200
    RETURN             ${response.json()}

Update Employee via API
    [Documentation]    Updates employee profile by ID.
    [Arguments]        ${emp_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /employees/${emp_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Employee via API
    [Documentation]    Deletes an employee profile by ID.
    [Arguments]        ${emp_id}
    ${response}=       Send DELETE Request Wrapper    /employees/${emp_id}    expected_status=200
    RETURN             ${response}
