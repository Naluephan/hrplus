*** Settings ***
Documentation    Overtime API Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Overtime Request via API
    [Documentation]    Submits a single overtime request for an employee.
    [Arguments]        ${employee_id}    ${date}    ${start_time}    ${end_time}    ${reason}=Request OT    ${ot_type}=evening
    ${payload}=        Create Dictionary
    ...                employeeId=${employee_id}
    ...                date=${date}
    ...                startTime=${start_time}
    ...                endTime=${end_time}
    ...                reason=${reason}
    ...                otType=${ot_type}
    ${response}=       Send POST Request Wrapper    /overtime    ${payload}    expected_status=201
    RETURN             ${response.json()}

Create Batch Overtime Request via API
    [Documentation]    Submits a batch overtime request for multiple employees.
    [Arguments]        ${employee_ids}    ${date}    ${start_time}    ${end_time}    ${reason}=Batch request    ${ot_type}=evening
    ${payload}=        Create Dictionary
    ...                employeeIds=${employee_ids}
    ...                date=${date}
    ...                startTime=${start_time}
    ...                endTime=${end_time}
    ...                reason=${reason}
    ...                otType=${ot_type}
    ${response}=       Send POST Request Wrapper    /overtime/batch    ${payload}    expected_status=201
    RETURN             ${response.json()}

Approve Overtime by Manager via API
    [Documentation]    Manager approves the overtime request.
    [Arguments]        ${ot_id}    ${remarks}=Manager Approved
    ${payload}=        Create Dictionary    remarks=${remarks}
    ${response}=       Send POST Request Wrapper    /overtime/${ot_id}/approve/manager    ${payload}    expected_status=201
    RETURN             ${response.json()}

Acknowledge Overtime by HR via API
    [Documentation]    HR acknowledges/reviews the overtime request.
    [Arguments]        ${ot_id}    ${remarks}=HR Acknowledged
    ${payload}=        Create Dictionary    remarks=${remarks}
    ${response}=       Send POST Request Wrapper    /overtime/${ot_id}/acknowledge/hr    ${payload}    expected_status=201
    RETURN             ${response.json()}

Final Approve Overtime via API
    [Documentation]    Performs final approval for the overtime request.
    [Arguments]        ${ot_id}    ${remarks}=Final Approved
    ${payload}=        Create Dictionary    remarks=${remarks}
    ${response}=       Send POST Request Wrapper    /overtime/${ot_id}/approve/final    ${payload}    expected_status=201
    RETURN             ${response.json()}

Reject Overtime via API
    [Documentation]    Rejects an overtime request at any stage.
    [Arguments]        ${ot_id}    ${remarks}=Rejected    ${role}=hr
    ${payload}=        Create Dictionary    remarks=${remarks}    role=${role}
    ${response}=       Send POST Request Wrapper    /overtime/${ot_id}/reject    ${payload}    expected_status=201
    RETURN             ${response.json()}

Match Overtime with Attendance via API
    [Documentation]    Matches an overtime request with actual attendance hours.
    [Arguments]        ${ot_id}    ${matched_hours}
    ${payload}=        Create Dictionary    matchedHours=${matched_hours}
    ${response}=       Send POST Request Wrapper    /overtime/${ot_id}/match-attendance    ${payload}    expected_status=201
    RETURN             ${response.json()}

Query Overtime Records via API
    [Documentation]    Queries overtime records list with filter parameters.
    [Arguments]        ${payload}
    ${response}=       Send POST Request Wrapper    /overtime/records/query    ${payload}    expected_status=201
    RETURN             ${response.json()}

Create Ot Rate via API
    [Documentation]    Creates a new OT rate configuration.
    [Arguments]        ${day_type}    ${day_name}    ${multiplier}    ${is_active}=${TRUE}    ${description}=Robot created rate
    ${payload}=        Create Dictionary
    ...                dayType=${day_type}
    ...                dayName=${day_name}
    ...                rateMultiplier=${multiplier}
    ...                isActive=${is_active}
    ...                description=${description}
    ${response}=       Send POST Request Wrapper    /overtime/rates    ${payload}    expected_status=201
    RETURN             ${response.json()}

Delete Ot Rate via API
    [Documentation]    Deletes an OT rate configuration by ID.
    [Arguments]        ${rate_id}
    ${response}=       Send DELETE Request Wrapper    /overtime/rates/${rate_id}    expected_status=200
    RETURN             ${response}

Resolve Ot Rate via API
    [Documentation]    Resolves OT rate for a specific date.
    [Arguments]        ${date}
    ${response}=       Send GET Request Wrapper    /overtime/rates/resolve?date=${date}    expected_status=200
    RETURN             ${response.json()}
