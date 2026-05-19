*** Settings ***
Documentation    Core HTTP Session Helper and Request Wrapper Keywords for HR API Testing
Library          RequestsLibrary
Library          Collections
Library          JSONLibrary

*** Variables ***
${API_BASE_URL}          http://localhost:3001/api/v1
# System token bypass secret verified from backend guard
${SYSTEM_JWT_SECRET}     4287b80f113f094a6b2ec64c322e5cf12c395d01655f0b71ffe400d51a31fa5ae56754f8ee587b6dd9d8ee8ec5feca3351f01d0b01254248c180614a855b3655
${DEFAULT_TENANT_ID}     3

*** Keywords ***
Create HR API Session
    [Documentation]    Initializes HTTP requests session with standard auth headers.
    [Arguments]        ${tenant_id}=${DEFAULT_TENANT_ID}
    ${headers}=        Create Dictionary
    ...                Content-Type=application/json
    ...                Authorization=Bearer ${SYSTEM_JWT_SECRET}
    ...                x-tenant-id=${tenant_id}
    Create Session     hr_api    ${API_BASE_URL}    headers=${headers}    disable_warnings=1
    Log                HR API session created successfully targeting: ${API_BASE_URL} with tenant-id: ${tenant_id}

Send GET Request Wrapper
    [Documentation]    Wraps GET request and asserts response status code.
    [Arguments]        ${uri}    ${expected_status}=200    ${custom_headers}=${None}
    ${response}=       GET On Session    hr_api    ${uri}    headers=${custom_headers}    expected_status=any
    Log                GET Response: ${response.status_code} - ${response.text}
    Should Be Equal As Integers    ${response.status_code}    ${expected_status}
    RETURN             ${response}

Send POST Request Wrapper
    [Documentation]    Wraps POST request and asserts response status code.
    [Arguments]        ${uri}    ${payload}    ${expected_status}=201    ${custom_headers}=${None}
    ${response}=       POST On Session    hr_api    ${uri}    json=${payload}    headers=${custom_headers}    expected_status=any
    Log                POST Response: ${response.status_code} - ${response.text}
    Should Be Equal As Integers    ${response.status_code}    ${expected_status}
    RETURN             ${response}

Send PUT Request Wrapper
    [Documentation]    Wraps PUT request and asserts response status code.
    [Arguments]        ${uri}    ${payload}    ${expected_status}=200    ${custom_headers}=${None}
    ${response}=       PUT On Session    hr_api    ${uri}    json=${payload}    headers=${custom_headers}    expected_status=any
    Log                PUT Response: ${response.status_code} - ${response.text}
    Should Be Equal As Integers    ${response.status_code}    ${expected_status}
    RETURN             ${response}

Send DELETE Request Wrapper
    [Documentation]    Wraps DELETE request and asserts response status code.
    [Arguments]        ${uri}    ${expected_status}=200    ${custom_headers}=${None}
    ${response}=       DELETE On Session    hr_api    ${uri}    headers=${custom_headers}    expected_status=any
    Log                DELETE Response: ${response.status_code} - ${response.text}
    Should Be Equal As Integers    ${response.status_code}    ${expected_status}
    RETURN             ${response}
