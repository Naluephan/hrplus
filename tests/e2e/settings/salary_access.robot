*** Settings ***
Documentation     ตั้งค่า › สิทธิ์เข้าถึงข้อมูลเงินเดือน
...
...               กำหนดว่าใครอนุมัติคำขอดูข้อมูลเงินเดือนพนักงาน และหน้าเงินเดือนหมดเวลาเมื่อไม่มีการใช้งาน
...               เป็นการตั้งค่าความปลอดภัยของบริษัท: สวีทจำค่าเดิมผ่าน API ตอนเริ่ม
...               และคืนค่าผ่าน API ตอนจบเสมอ — ไม่ฝากการคืนค่าไว้กับหน้าจอที่อาจล้มกลางทาง
...
...               สวีทจะไม่ทำงานเลยถ้า tenant ของผู้ใช้ในหน้าเว็บไม่ใช่ tenant ที่ API คืนค่าได้
...               เพราะการคืนค่าผิดบริษัทแย่กว่าการไม่ได้ทดสอบ
Resource          ../../resources/session.resource
Resource          ../../../resources/core/page_state.resource
Resource          ../../resources/keywords/api_common.resource
Library           Collections
Library           ../../resources/session_lifetime.py

Suite Setup       Prepare Salary Access Suite
Suite Teardown    Restore Salary Access And Close
Test Setup        Open Fresh Logged In Page
Test Teardown     Close Test Page


*** Variables ***
${PAGE}                  settings.salaryAccess
${PATH}                  /settings/salary-access
${SUCCESS_TOAST}         css=[data-sonner-toast][data-type="success"]
@{ORIGINAL_APPROVERS}
${ORIGINAL_TIMEOUT}      ${None}


*** Test Cases ***
Page Loads Into A Ready State
    [Tags]    smoke    settings    salary_access
    Open Salary Access Page
    Wait For Elements State    css=[data-testid="${PAGE}.page.error"]    detached    timeout=1s

The Approver Count Matches The Saved Approvers
    [Documentation]    จำนวนที่หน้าเว็บแสดงต้องตรงกับที่ระบบบันทึกไว้จริง
    [Tags]    smoke    settings    salary_access
    ${saved}=    Saved Approver Ids
    ${expected}=    Get Length    ${saved}
    Open Salary Access Page
    ${shown}=    Get Attribute    css=[data-testid="${PAGE}.approvers.count"]    data-count
    Should Be Equal As Integers    ${shown}    ${expected}

The Two Approver Warning Follows The Saved Approvers
    [Documentation]    ผู้อนุมัติอนุมัติคำขอของตัวเองไม่ได้ จึงต้องเตือนเมื่อมีน้อยกว่า 2 คน
    [Tags]    settings    salary_access
    ${saved}=    Saved Approver Ids
    ${count}=    Get Length    ${saved}
    Open Salary Access Page
    IF    ${count} < 2
        Wait For Elements State    css=[data-testid="${PAGE}.warning.minApprovers"]    visible    timeout=5s
    ELSE
        Wait For Elements State    css=[data-testid="${PAGE}.warning.minApprovers"]    detached    timeout=5s
    END

Adding An Approver Persists After Saving
    [Tags]    smoke    settings    salary_access    crud
    ${employee_id}    ${employee_code}=    Pick An Employee Who Is Not An Approver
    Open Salary Access Page
    Fill Text    css=[data-testid="${PAGE}.search.input"]    ${employee_code}
    Click    css=[data-testid="${PAGE}.search.option.${employee_id}"]
    Wait For Elements State    css=[data-testid="${PAGE}.approver.${employee_id}"]    visible    timeout=5s
    Save Approvers
    Open Salary Access Page
    Wait For Elements State    css=[data-testid="${PAGE}.approver.${employee_id}"]    visible    timeout=5s
    ${saved}=    Saved Approver Ids
    List Should Contain Value    ${saved}    ${employee_id}
    [Teardown]    Restore Approvers And Close Page

Removing An Approver Without Saving Changes Nothing
    [Documentation]    นำชื่อออกจากหน้าจอแล้วไม่กดบันทึก — ผู้อนุมัติต้องยังอยู่ครบ
    [Tags]    settings    salary_access    negative
    ${employee_id}=    Ensure At Least One Approver
    Open Salary Access Page
    Click    css=[data-testid="${PAGE}.approver.${employee_id}.remove"]
    Wait For Elements State    css=[data-testid="${PAGE}.approver.${employee_id}"]    detached    timeout=5s
    Open Salary Access Page
    Wait For Elements State    css=[data-testid="${PAGE}.approver.${employee_id}"]    visible    timeout=5s
    [Teardown]    Restore Approvers And Close Page

Saving The Idle Timeout Persists It
    [Tags]    settings    salary_access    crud
    ${new_timeout}=    Evaluate    (int(${ORIGINAL_TIMEOUT}) + 5) % 1440 or 5
    Open Salary Access Page
    Fill Text    css=[data-testid="${PAGE}.form.idleTimeout.input"]    ${new_timeout}
    Click    css=[data-testid="${PAGE}.idleTimeout.save"]
    Wait For Elements State    ${SUCCESS_TOAST}    visible    timeout=${ACTION_TIMEOUT}
    Open Salary Access Page
    Get Property    css=[data-testid="${PAGE}.form.idleTimeout.input"]    value    ==    ${{ str($new_timeout) }}
    ${saved}=    Saved Idle Timeout
    Should Be Equal As Integers    ${saved}    ${new_timeout}
    [Teardown]    Restore Timeout And Close Page


*** Keywords ***
Open Salary Access Page
    Go To    ${URL}${PATH}
    Wait For Page Ready    ${PAGE}

Save Approvers
    Click    css=[data-testid="${PAGE}.approvers.save"]
    Wait For Elements State    ${SUCCESS_TOAST}    visible    timeout=${ACTION_TIMEOUT}

Saved Approver Ids
    ${response}=    Send GET Request Wrapper    /salary-access/approvers
    ${ids}=    Evaluate    [a["employeeId"] for a in $response.json()]
    RETURN    ${ids}

Saved Idle Timeout
    ${response}=    Send GET Request Wrapper    /salary-access/settings
    RETURN    ${response.json()}[idleTimeoutMinutes]

Set Approvers Through The API
    [Arguments]    ${ids}
    ${payload}=    Create Dictionary    employeeIds=${ids}
    Send PUT Request Wrapper    /salary-access/approvers    ${payload}

Set Idle Timeout Through The API
    [Arguments]    ${minutes}
    ${payload}=    Create Dictionary    idleTimeoutMinutes=${minutes}
    Send PUT Request Wrapper    /salary-access/settings    ${payload}

Pick An Employee Who Is Not An Approver
    [Documentation]    เลือกพนักงานที่มีรหัสและยังไม่เป็นผู้อนุมัติ — ค้นด้วยรหัสเพื่อให้ได้ผลลัพธ์ที่แน่นอน
    ${saved}=    Saved Approver Ids
    ${response}=    Send GET Request Wrapper    /employees?limit=50
    ${body}=    Set Variable    ${response.json()}
    ${items}=    Evaluate    $body.get("items") or $body.get("data") or []
    FOR    ${employee}    IN    @{items}
        ${code}=    Evaluate    $employee.get("employeeCode") or ""
        ${is_approver}=    Evaluate    $employee["id"] in $saved
        IF    "${code}" != "" and not ${is_approver}
            RETURN    ${employee}[id]    ${code}
        END
    END
    Fail    ไม่พบพนักงานที่มีรหัสและยังไม่เป็นผู้อนุมัติสำหรับใช้ทดสอบ

Ensure At Least One Approver
    [Documentation]    คืน id ผู้อนุมัติหนึ่งคน — ถ้ายังไม่มีเลย เพิ่มผ่าน API (teardown ของเคสจะคืนค่าเดิม)
    ${saved}=    Saved Approver Ids
    ${count}=    Get Length    ${saved}
    IF    ${count} > 0    RETURN    ${saved}[0]
    ${employee_id}    ${unused_code}=    Pick An Employee Who Is Not An Approver
    @{ids}=    Create List    ${employee_id}
    Set Approvers Through The API    ${ids}
    RETURN    ${employee_id}

Restore Approvers And Close Page
    Run Keyword And Ignore Error    Set Approvers Through The API    ${ORIGINAL_APPROVERS}
    Close Test Page

Restore Timeout And Close Page
    Run Keyword And Ignore Error    Set Idle Timeout Through The API    ${ORIGINAL_TIMEOUT}
    Close Test Page

Prepare Salary Access Suite
    Open Browser For Suite
    ${session_file}=    Resolve Session File
    ${ui_tenant}=    Session Cookie    ${session_file}    hr-tenant-id
    # The API session uses the system token, which the backend pins to tenant 3.
    # Restoring another tenant's security settings through it is impossible, so stop.
    Should Be Equal As Strings    ${ui_tenant}    ${DEFAULT_TENANT_ID}
    ...    msg=ผู้ใช้หน้าเว็บอยู่ tenant "${ui_tenant}" แต่ API คืนค่าได้เฉพาะ tenant "${DEFAULT_TENANT_ID}" — ยกเลิกเพื่อไม่ให้แก้ค่าความปลอดภัยผิดบริษัท
    Create HR API Session    tenant_id=${ui_tenant}
    ${approvers}=    Saved Approver Ids
    ${timeout}=    Saved Idle Timeout
    Set Suite Variable    @{ORIGINAL_APPROVERS}    @{approvers}
    Set Suite Variable    ${ORIGINAL_TIMEOUT}    ${timeout}
    Log    ค่าเดิม: ผู้อนุมัติ ${approvers} · idle timeout ${timeout} นาที

Restore Salary Access And Close
    [Documentation]    ตาข่ายชั้นสุดท้าย: ค่าความปลอดภัยต้องกลับเป็นค่าก่อนเริ่มสวีท ไม่ว่าเคสไหนจะล้ม
    IF    $ORIGINAL_TIMEOUT is not None
        Run Keyword And Ignore Error    Set Approvers Through The API    ${ORIGINAL_APPROVERS}
        Run Keyword And Ignore Error    Set Idle Timeout Through The API    ${ORIGINAL_TIMEOUT}
    END
    Close Browser    ALL
