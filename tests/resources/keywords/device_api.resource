*** Settings ***
Documentation    Device API Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Device via API
    [Documentation]    Registers a new facial scanner device.
    [Arguments]        ${device_id}    ${name}    ${location}=Office Entrance    ${model}=FaceScanner-V2    ${firmware}=1.0.0
    ${payload}=        Create Dictionary
    ...                deviceId=${device_id}
    ...                name=${name}
    ...                location=${location}
    ...                model=${model}
    ...                firmwareVersion=${firmware}
    ${response}=       Send POST Request Wrapper    /devices    ${payload}    expected_status=201
    RETURN             ${response.json()}

List Devices via API
    [Documentation]    Retrieves list of registered devices.
    ${response}=       Send GET Request Wrapper    /devices    expected_status=200
    RETURN             ${response.json()}

Get Device Health via API
    [Documentation]    Retrieves health status of all devices.
    ${response}=       Send GET Request Wrapper    /devices/health    expected_status=200
    RETURN             ${response.json()}

Get Device Details via API
    [Documentation]    Retrieves details of a specific device by database ID.
    [Arguments]        ${id}
    ${response}=       Send GET Request Wrapper    /devices/${id}    expected_status=200
    RETURN             ${response.json()}

Update Device Details via API
    [Documentation]    Updates device configuration or info by database ID.
    [Arguments]        ${id}    ${payload}
    ${response}=       Send PATCH Request Wrapper    /devices/${id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Device via API
    [Documentation]    Deletes a registered device by database ID.
    [Arguments]        ${id}
    ${response}=       Send DELETE Request Wrapper    /devices/${id}    expected_status=200
    RETURN             ${response}

Sync Device Data via API
    [Documentation]    Synchronizes a batch of device punch logs.
    [Arguments]        ${device_id}    ${logs_list}
    ${payload}=        Create Dictionary
    ...                deviceId=${device_id}
    ...                attendanceLogs=${logs_list}
    ${response}=       Send POST Request Wrapper    /devices/sync    ${payload}    expected_status=201
    RETURN             ${response.json()}

Update Device Heartbeat via API
    [Documentation]    Sends a heartbeat signal for a device to mark it online.
    [Arguments]        ${device_id}
    ${response}=       Send POST Request Wrapper    /devices/${device_id}/heartbeat    ${None}    expected_status=201
    RETURN             ${response.json()}

Device Punch Check In via API
    [Documentation]    Mocks a physical check-in punch from a device scanner using employee code.
    [Arguments]        ${device_id}    ${employee_code}    ${lat}=13.7563    ${lng}=100.5018
    ${location}=       Create Dictionary    latitude=${lat}    longitude=${lng}
    ${payload}=        Create Dictionary    employeeCode=${employee_code}    location=${location}
    ${response}=       Send POST Request Wrapper    /devices/${device_id}/check-in    ${payload}    expected_status=201
    RETURN             ${response.json()}

Device Punch Check Out via API
    [Documentation]    Mocks a physical check-out punch from a device scanner using employee code.
    [Arguments]        ${device_id}    ${employee_code}    ${lat}=13.7563    ${lng}=100.5018
    ${location}=       Create Dictionary    latitude=${lat}    longitude=${lng}
    ${payload}=        Create Dictionary    employeeCode=${employee_code}    location=${location}
    ${response}=       Send POST Request Wrapper    /devices/${device_id}/check-out    ${payload}    expected_status=201
    RETURN             ${response.json()}
