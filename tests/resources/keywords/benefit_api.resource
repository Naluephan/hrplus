*** Settings ***
Documentation    Benefit Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Benefit via API
    [Documentation]    Creates a new benefit and returns its generated ID.
    [Arguments]        ${name}    ${benefit_type}=required    ${description}=${None}    ${status}=active
    ${payload}=        Create Dictionary
    ...                name=${name}
    ...                benefitType=${benefit_type}
    Run Keyword If     '${description}' != '${None}'   Set To Dictionary    ${payload}    description=${description}
    Run Keyword If     '${status}' != '${None}'        Set To Dictionary    ${payload}    status=${status}
    ${response}=       Send POST Request Wrapper    /settings/benefits    ${payload}    expected_status=201
    ${benefit_id}=     Get From Dictionary    ${response.json()}    id
    Log                Benefit created with ID: ${benefit_id}
    RETURN             ${benefit_id}    ${response.json()}

List Benefits via API
    [Documentation]    Retrieves the list of benefits.
    [Arguments]        ${tenant_id}=${DEFAULT_TENANT_ID}
    ${response}=       Send GET Request Wrapper    /settings/benefits?tenantId=${tenant_id}    expected_status=200
    RETURN             ${response.json()}

Update Benefit via API
    [Documentation]    Updates a benefit by ID.
    [Arguments]        ${benefit_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /settings/benefits/${benefit_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Benefit via API
    [Documentation]    Deletes a benefit by ID.
    [Arguments]        ${benefit_id}
    ${response}=       Send DELETE Request Wrapper    /settings/benefits/${benefit_id}    expected_status=200
    RETURN             ${response}
