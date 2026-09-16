*** Settings ***
Documentation    Employment Type Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Employment Type via API
    [Documentation]    Creates a new employment type and returns its generated ID.
    [Arguments]        ${name}    ${description}=${None}
    ${payload}=        Create Dictionary
    ...                name=${name}
    Run Keyword If     '${description}' != '${None}'   Set To Dictionary    ${payload}    description=${description}
    ${response}=       Send POST Request Wrapper    /employment-types    ${payload}    expected_status=201
    ${type_id}=        Get From Dictionary    ${response.json()}    id
    Log                Employment Type created with ID: ${type_id}
    RETURN             ${type_id}    ${response.json()}

List Employment Types via API
    [Documentation]    Retrieves the list of employment types.
    ${response}=       Send GET Request Wrapper    /employment-types    expected_status=200
    RETURN             ${response.json()}

Update Employment Type via API
    [Documentation]    Updates an employment type by ID.
    [Arguments]        ${type_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /employment-types/${type_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Employment Type via API
    [Documentation]    Deletes an employment type by ID.
    [Arguments]        ${type_id}
    ${response}=       Send DELETE Request Wrapper    /employment-types/${type_id}    expected_status=200
    RETURN             ${response}
