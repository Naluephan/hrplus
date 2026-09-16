*** Settings ***
Documentation    Level Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Level via API
    [Documentation]    Creates a new level and returns its generated ID.
    [Arguments]        ${name_th}    ${level}    ${name_en}=${None}    ${description}=${None}    ${status}=${1}
    ${payload}=        Create Dictionary
    ...                nameTh=${name_th}
    ...                level=${level}
    Run Keyword If     '${name_en}' != '${None}'       Set To Dictionary    ${payload}    nameEn=${name_en}
    Run Keyword If     '${description}' != '${None}'   Set To Dictionary    ${payload}    description=${description}
    Run Keyword If     '${status}' != '${None}'        Set To Dictionary    ${payload}    status=${status}
    ${response}=       Send POST Request Wrapper    /settings/levels    ${payload}    expected_status=201
    ${level_id}=       Get From Dictionary    ${response.json()}    id
    Log                Level created with ID: ${level_id}
    RETURN             ${level_id}    ${response.json()}

List Levels via API
    [Documentation]    Retrieves the list of levels.
    ${response}=       Send GET Request Wrapper    /settings/levels    expected_status=200
    RETURN             ${response.json()}

Update Level via API
    [Documentation]    Updates a level by ID.
    [Arguments]        ${level_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /settings/levels/${level_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Level via API
    [Documentation]    Deletes a level by ID.
    [Arguments]        ${level_id}
    ${response}=       Send DELETE Request Wrapper    /settings/levels/${level_id}    expected_status=200
    RETURN             ${response}
