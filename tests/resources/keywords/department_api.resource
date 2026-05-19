*** Settings ***
Documentation    Department Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Department via API
    [Documentation]    Creates a new department and returns its generated ID.
    [Arguments]        ${code}    ${name_th}    ${name_en}    ${description}=${None}
    ${payload}=        Create Dictionary
    ...                code=${code}
    ...                nameTh=${name_th}
    ...                nameEn=${name_en}
    ...                description=${description}
    ...                status=active
    ${response}=       Send POST Request Wrapper    /departments    ${payload}    expected_status=201
    ${dept_id}=        Get From Dictionary    ${response.json()}    id
    Log                Department created with ID: ${dept_id}
    RETURN             ${dept_id}    ${response.json()}

Get Department Details via API
    [Documentation]    Retrieves department details by ID.
    [Arguments]        ${dept_id}
    ${response}=       Send GET Request Wrapper    /departments/${dept_id}    expected_status=200
    RETURN             ${response.json()}

Update Department via API
    [Documentation]    Updates department details by ID.
    [Arguments]        ${dept_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /departments/${dept_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Department via API
    [Documentation]    Deletes a department by ID.
    [Arguments]        ${dept_id}
    ${response}=       Send DELETE Request Wrapper    /departments/${dept_id}    expected_status=200
    RETURN             ${response}
