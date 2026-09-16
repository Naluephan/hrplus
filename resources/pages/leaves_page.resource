*** Settings ***
Library    Browser
Library    String
Resource   ../../tests/resources/common.resource

*** Variables ***
${LEAVES_URL}                   /attendance/leave-requests
${TABLE_LEAVE_ROW}              xpath=//table/tbody/tr
${BTN_EDIT_PREFIX}              data-testid=edit-btn-
${BTN_CANCEL_PREFIX}            data-testid=quick-cancel-btn-
${BTN_VIEW_PREFIX}              data-testid=view-detail-btn-
${MODAL_EDIT_LEAVE}             xpath=//div[@role='dialog']//*[contains(text(), 'แก้ไขคำขอลา')]
${MODAL_CREATE_LEAVE}           xpath=//div[@role='dialog']//*[contains(text(), 'เพิ่มคำขอลา') or contains(text(), 'สร้างคำขอลา')]
${TOAST_SUCCESS}                xpath=//*[contains(text(), 'สำเร็จ') or contains(text(), 'บันทึกสำเร็จ')]

*** Keywords ***
Navigate To Leave Requests Page
    Go To    ${URL}${LEAVES_URL}
    # Wait for page and tenant to fully load
    Wait For Elements State    css=body    visible    timeout=10s
    Wait For Tenant To Load    Ops Shared Tenant    3
    Wait For Elements State    css=table    visible    timeout=60s
    Wait For Loading To Hide

Click Create Leave Request Button
    Wait For Elements State    xpath=//button[contains(., 'เพิ่มคำขอลา')]    visible    timeout=30s
    Click    xpath=//button[contains(., 'เพิ่มคำขอลา')]
    Wait For Elements State    ${MODAL_CREATE_LEAVE}    visible    timeout=30s

Fill Create Leave Request Form
    [Arguments]    ${employee_code}    ${leave_type}    ${start_date}    ${end_date}    ${reason}
    # 1. Search Employee - Type Text triggers React onChange → debounce (400ms) → API call → dropdown
    Wait For Elements State    css=[data-testid="employee-search-input"]    visible    timeout=30s
    Click    css=[data-testid="employee-search-input"]
    Type Text    css=[data-testid="employee-search-input"]    ${employee_code}    delay=80ms
    # Debug: capture state after typing to understand dropdown behavior
    Sleep    2s
    Take Screenshot    filename=debug-employee-search-{index}.png
    # Retry up to 3x with 2s gap to handle debounce + API rate limit recovery
    Wait Until Keyword Succeeds    3x    2s    Wait For Employee Option    ${employee_code}
    Click    css=[data-testid="employee-option-${employee_code}"]
    
    # 2. Select Leave Type
    Select Options By    css=select    text    ${leave_type}
    
    # 3. Fill Dates
    Fill Text    css=input[type="date"] >> nth=0    ${start_date}
    Fill Text    css=input[type="date"] >> nth=1    ${end_date}
    
    # 4. Fill Reason
    Fill Text    css=textarea[placeholder="เพิ่มรายละเอียดสำหรับผู้อนุมัติ"]    ${reason}

Wait For Employee Option
    [Arguments]    ${employee_code}
    [Documentation]    รอให้ dropdown แสดง employee option ที่ตรงกับ code
    ...    ถ้า option ไม่ขึ้น (rate limit / timing) ให้ type ใหม่แล้ว retry
    ${visible}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="employee-option-${employee_code}"]    visible    timeout=3s
    IF    not ${visible}
        # Re-type to re-trigger the search (handles rate limit recovery)
        Click    css=[data-testid="employee-search-input"]
        Type Text    css=[data-testid="employee-search-input"]    ${employee_code}    delay=80ms
        Wait For Elements State    css=[data-testid="employee-option-${employee_code}"]    visible    timeout=5s
    END

Submit Create Leave Request
    Click    xpath=//button[contains(text(), 'ส่งคำขอ')]
    Wait For Elements State    ${MODAL_CREATE_LEAVE}    hidden    timeout=60s
    Wait For Loading To Hide

Search Leave Requests
    [Arguments]    ${search_term}
    Fill Text    css=input[placeholder="พิมพ์เพื่อค้นหา..."]    ${search_term}
    # Wait for filter to apply
    Sleep    1s
    Wait For Loading To Hide

Click Edit Button For Reason
    [Arguments]    ${reason}
    ${edit_btn}=    Set Variable    xpath=//tr[descendant::td[contains(., "${reason}")]]//button[contains(@data-testid, 'edit-btn-')]
    Wait For Elements State    ${edit_btn}    visible    timeout=30s
    Click    ${edit_btn}
    Wait For Elements State    ${MODAL_EDIT_LEAVE}    visible    timeout=30s

Fill Edit Leave Request Form
    [Arguments]    ${new_reason}
    Fill Text    css=textarea[placeholder="เพิ่มรายละเอียดสำหรับผู้อนุมัติ"]    ${new_reason}

Click Save Edit Button
    Click    css=[data-testid="confirm-edit-btn"]
    Wait For Elements State    xpath=//div[@role='dialog']//h2[contains(text(), 'ยืนยันการแก้ไข')]    visible    timeout=30s

Confirm Edit Leave Request
    Click    xpath=//button[contains(text(), 'ยืนยัน')]
    Wait For Elements State    ${MODAL_EDIT_LEAVE}    hidden    timeout=60s
    Wait For Loading To Hide

Open Leave Detail Drawer For Reason
    [Arguments]    ${reason}
    ${view_btn}=    Set Variable    xpath=//tr[descendant::td[contains(., "${reason}")]]//button[contains(@data-testid, 'view-detail-btn-')]
    Wait For Elements State    ${view_btn}    visible    timeout=30s
    Click    ${view_btn}
    Wait For Elements State    xpath=//*[contains(text(), 'รายละเอียดการลางาน')]    visible    timeout=30s

Click Approve Button In Detail Drawer
    Wait For Elements State    css=[data-testid="leave-detail-approve-btn"]    visible    timeout=30s
    Click    css=[data-testid="leave-detail-approve-btn"]
    Wait For Elements State    xpath=//*[contains(text(), 'รายละเอียดการลางาน')]    hidden    timeout=60s
    Wait For Loading To Hide

Click Reject Button In Detail Drawer
    Wait For Elements State    css=[data-testid="leave-detail-reject-btn"]    visible    timeout=30s
    Click    css=[data-testid="leave-detail-reject-btn"]
    Wait For Elements State    xpath=//*[contains(text(), 'ยืนยันการไม่อนุมัติ') or contains(text(), 'ปฏิเสธคำขอลา')]    visible    timeout=30s

Confirm Reject Leave Request
    Click    xpath=//div[@role='dialog' and descendant::*[contains(text(), 'ยืนยันการไม่อนุมัติ') or contains(text(), 'ปฏิเสธคำขอลา')]]//button[contains(text(), 'ไม่อนุมัติ') or contains(text(), 'ปฏิเสธ')]
    Wait For Elements State    xpath=//*[contains(text(), 'รายละเอียดการลางาน')]    hidden    timeout=60s
    Wait For Loading To Hide

Click Quick Cancel Button For Reason
    [Arguments]    ${reason}
    ${cancel_btn}=    Set Variable    xpath=//tr[descendant::td[contains(., "${reason}")]]//button[contains(@data-testid, 'quick-cancel-btn-')]
    Wait For Elements State    ${cancel_btn}    visible    timeout=30s
    Click    ${cancel_btn}
    Wait For Elements State    xpath=//*[contains(text(), 'ยืนยันการยกเลิก')]    visible    timeout=30s

Confirm Cancel Leave Request
    Click    css=[data-testid="confirm-cancel-btn"]
    Wait For Loading To Hide
