*** Settings ***
Documentation    Leave and Workflow Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Get Active Leave Type Id via API
    [Documentation]    Fetches list of leave types and returns the first active one.
    ${response}=       Send GET Request Wrapper    /leaves/type/list    expected_status=200
    ${type_id}=        Get From Dictionary    ${response.json()}[0]    id
    ${name}=           Get From Dictionary    ${response.json()}[0]    name
    Log                Selected Leave Type: ${name} with ID: ${type_id}
    RETURN             ${type_id}

Create Leave Request via API
    [Documentation]    Creates a new leave request and returns its ID.
    [Arguments]        ${emp_id}    ${leave_type_id}    ${start_date}    ${end_date}    ${reason}=API Test    ${total_days}=1.0
    ${payload}=        Create Dictionary
    ...                employeeId=${emp_id}
    ...                leaveTypeId=${leave_type_id}
    ...                startDate=${start_date}
    ...                endDate=${end_date}
    ...                reason=${reason}
    ...                totalDays=${total_days}
    ${response}=       Send POST Request Wrapper    /leaves/request    ${payload}    expected_status=201
    ${leave_id}=       Get From Dictionary    ${response.json()}    id
    Log                Leave request submitted successfully with ID: ${leave_id}
    RETURN             ${leave_id}    ${response.json()}

Approve Leave Request via API
    [Documentation]    Approves a leave request using administrative override.
    [Arguments]        ${leave_id}    ${remark}=Approved via API Test
    ${payload}=        Create Dictionary
    ...                leaveId=${leave_id}
    ...                remark=${remark}
    ${response}=       Send POST Request Wrapper    /leaves/admin/approve    ${payload}    expected_status=201
    Log                Leave request ${leave_id} approved.
    RETURN             ${response.json()}

Cancel Leave Request via API
    [Documentation]    Cancels a leave request using administrative override.
    [Arguments]        ${leave_id}    ${remark}=Cancelled via API Test
    ${payload}=        Create Dictionary
    ...                leaveId=${leave_id}
    ...                remark=${remark}
    ${response}=       Send POST Request Wrapper    /leaves/admin/cancel    ${payload}    expected_status=201
    Log                Leave request ${leave_id} cancelled.
    RETURN             ${response.json()}
