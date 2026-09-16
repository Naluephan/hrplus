*** Settings ***
Documentation     E2E Smoke tests for Leave Requests module (Create, Edit, Approve, Reject, Cancel).
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource
Resource          ../../../resources/pages/leaves_page.resource
Library           DateTime
Library           String
Library           ../../resources/leave_utils.py

Suite Setup       Run Keywords    Open HR Plus Application    AND    Login To Application
Suite Teardown    Close Application
Test Setup        Navigate To Leave Requests Page

*** Variables ***
${EMPLOYEE_CODE}     EMP0105
${LEAVE_TYPE}        ลากิจ

*** Test Cases ***
User Can Create Leave Request
    [Documentation]    Verify that a user can create a leave request with a unique reason.
    [Tags]             smoke    leaves    create
    
    # Generate unique test data
    ${rand}=            Generate Random String    6    [NUMBERS]
    ${reason}=          Set Variable    Automated Create Leave ${rand}
    
    # Dynamically find next available leave dates to prevent duplicates
    ${start_date}    ${end_date}=    Get Next Available Leave Dates By Code    ${EMPLOYEE_CODE}    tenant_id=3    duration_days=2    start_offset_days=10
    
    Set Suite Variable  ${LEAVE_REASON}    ${reason}
    Set Suite Variable  ${LEAVE_START_DATE}    ${start_date}
    Set Suite Variable  ${LEAVE_END_DATE}    ${end_date}

    Click Create Leave Request Button
    Fill Create Leave Request Form    ${EMPLOYEE_CODE}    ${LEAVE_TYPE}    ${start_date}    ${end_date}    ${reason}
    Submit Create Leave Request
    
    # Search and verify creation
    Search Leave Requests    ${reason}
    Wait For Elements State    xpath=//tr[descendant::td[contains(., "${reason}")]]    visible    timeout=10s
    # Verify status is pending (รออนุมัติ)
    Wait For Elements State    xpath=//tr[descendant::td[contains(., "${reason}")]]//span[contains(text(), 'รออนุมัติ')]    visible    timeout=10s

User Can Edit Pending Leave Request
    [Documentation]    Verify that a pending leave request can be edited.
    [Tags]             smoke    leaves    edit
    Skip If    '${LEAVE_REASON}' == '${None}'    Skipping because Leave creation failed.

    # Search for the created request
    Search Leave Requests    ${LEAVE_REASON}
    
    # Click edit button
    Click Edit Button For Reason    ${LEAVE_REASON}
    
    # Modify reason
    ${edited_reason}=    Set Variable    ${LEAVE_REASON} (Edited)
    Set Suite Variable   ${LEAVE_REASON_EDITED}    ${edited_reason}
    Fill Edit Leave Request Form    ${edited_reason}
    
    # Save and confirm
    Click Save Edit Button
    Confirm Edit Leave Request
    
    # Verify updated reason in table
    Search Leave Requests    ${edited_reason}
    Wait For Elements State    xpath=//tr[descendant::td[contains(., "${edited_reason}")]]    visible    timeout=10s

Admin Can Approve Leave Request
    [Documentation]    Verify that an admin can approve a pending leave request from the details drawer.
    [Tags]             smoke    leaves    approve
    Skip If    '${LEAVE_REASON_EDITED}' == '${None}'    Skipping because Leave edit failed.

    Search Leave Requests    ${LEAVE_REASON_EDITED}
    Open Leave Detail Drawer For Reason    ${LEAVE_REASON_EDITED}
    Click Approve Button In Detail Drawer
    Wait Until Toast Contains    อนุมัติสำเร็จ
    
    # Verify status changed to approved (อนุมัติ)
    Search Leave Requests    ${LEAVE_REASON_EDITED}
    Wait For Elements State    xpath=//tr[descendant::td[contains(., "${LEAVE_REASON_EDITED}")]]//span[contains(text(), 'อนุมัติ')]    visible    timeout=10s

Admin Can Reject Leave Request
    [Documentation]    Verify that an admin can reject a pending leave request.
    [Tags]             smoke    leaves    reject

    # 1. Create a new request to reject
    ${rand}=            Generate Random String    6    [NUMBERS]
    ${reject_reason}=   Set Variable    Automated Reject Leave ${rand}
    ${start_date}    ${end_date}=    Get Next Available Leave Dates By Code    ${EMPLOYEE_CODE}    tenant_id=3    duration_days=2    start_offset_days=10
    Click Create Leave Request Button
    Fill Create Leave Request Form    ${EMPLOYEE_CODE}    ${LEAVE_TYPE}    ${start_date}    ${end_date}    ${reject_reason}
    Submit Create Leave Request
    
    # 2. Search and open detail drawer
    Search Leave Requests    ${reject_reason}
    Open Leave Detail Drawer For Reason    ${reject_reason}
    
    # 3. Reject request
    Click Reject Button In Detail Drawer
    Confirm Reject Leave Request
    Wait Until Toast Contains    ปฏิเสธสำเร็จ
    
    # 4. Verify status changed to rejected (ไม่อนุมัติ)
    Search Leave Requests    ${reject_reason}
    Wait For Elements State    xpath=//tr[descendant::td[contains(., "${reject_reason}")]]//span[contains(text(), 'ไม่อนุมัติ')]    visible    timeout=10s

User Can Cancel Leave Request
    [Documentation]    Verify that a user can cancel a pending leave request using the quick action.
    [Tags]             smoke    leaves    cancel

    # 1. Create a new request to cancel
    ${rand}=            Generate Random String    6    [NUMBERS]
    ${cancel_reason}=   Set Variable    Automated Cancel Leave ${rand}
    ${start_date}    ${end_date}=    Get Next Available Leave Dates By Code    ${EMPLOYEE_CODE}    tenant_id=3    duration_days=2    start_offset_days=10
    Click Create Leave Request Button
    Fill Create Leave Request Form    ${EMPLOYEE_CODE}    ${LEAVE_TYPE}    ${start_date}    ${end_date}    ${cancel_reason}
    Submit Create Leave Request
    
    # 2. Search and click quick cancel in table
    Search Leave Requests    ${cancel_reason}
    Click Quick Cancel Button For Reason    ${cancel_reason}
    Confirm Cancel Leave Request
    Wait Until Toast Contains    ยกเลิกสำเร็จ
    
    # 3. Verify status changed to cancelled (ยกเลิก)
    Search Leave Requests    ${cancel_reason}
    Wait For Elements State    xpath=//tr[descendant::td[contains(., "${cancel_reason}")]]//span[contains(text(), 'ยกเลิก')]    visible    timeout=10s
