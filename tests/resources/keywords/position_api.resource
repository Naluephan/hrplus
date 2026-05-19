*** Settings ***
Documentation    Position Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Position via API
    [Documentation]    Creates a new position (code must be exactly 2 chars) and returns its generated ID.
    [Arguments]        ${code}    ${name_th}    ${name_en}    ${department_id}    ${description}=${None}
    # Validate code length constraint from DTO (must be exactly 2 chars)
    Length Should Be   ${code}    2    msg=Position code must be exactly 2 characters (e.g. IT, GD, HR)
    ${payload}=        Create Dictionary
    ...                code=${code}
    ...                nameTh=${name_th}
    ...                nameEn=${name_en}
    ...                departmentId=${department_id}
    ...                description=${description}
    ...                status=active
    ${response}=       Send POST Request Wrapper    /positions    ${payload}    expected_status=201
    ${pos_id}=         Get From Dictionary    ${response.json()}    id
    Log                Position created with ID: ${pos_id}
    RETURN             ${pos_id}    ${response.json()}

Get Position Details via API
    [Documentation]    Retrieves position details by ID.
    [Arguments]        ${pos_id}
    ${response}=       Send GET Request Wrapper    /positions/${pos_id}    expected_status=200
    RETURN             ${response.json()}

Update Position via API
    [Documentation]    Updates position details by ID.
    [Arguments]        ${pos_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /positions/${pos_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Position via API
    [Documentation]    Deletes a position by ID.
    [Arguments]        ${pos_id}
    ${response}=       Send DELETE Request Wrapper    /positions/${pos_id}    expected_status=200
    RETURN             ${response}
