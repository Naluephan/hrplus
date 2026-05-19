*** Settings ***
Library    Browser
Library    String

*** Variables ***
${LEAVES_URL}              /leaves
${TABLE_LEAVE_ROW}         xpath=//table/tbody/tr
${BTN_EDIT_PREFIX}         data-testid=leaves.table.button.edit.
${BTN_CANCEL_PREFIX}       data-testid=leaves.table.button.cancel.
${MODAL_EDIT_LEAVE}        xpath=//div[@role='dialog']//*[contains(text(), 'แก้ไขรายการลา')]
${TOAST_SUCCESS}           xpath=//*[contains(text(), 'ยกเลิกสำเร็จ')]

*** Keywords ***
Navigate To Leave Requests Page
    Go To    ${LEAVES_URL}
    Wait For Elements State    ${TABLE_LEAVE_ROW}    visible    timeout=10s

Verify Edit Button Visible For Leave
    [Arguments]    ${leave_id}
    Wait For Elements State    ${BTN_EDIT_PREFIX}${leave_id}    visible

Verify Edit Button Not Visible For Leave
    [Arguments]    ${leave_id}
    Wait For Elements State    ${BTN_EDIT_PREFIX}${leave_id}    hidden

Verify Cancel Button Visible For Leave
    [Arguments]    ${leave_id}
    Wait For Elements State    ${BTN_CANCEL_PREFIX}${leave_id}    visible

Verify Cancel Button Not Visible For Leave
    [Arguments]    ${leave_id}
    Wait For Elements State    ${BTN_CANCEL_PREFIX}${leave_id}    hidden

Open Edit Leave Modal
    [Arguments]    ${leave_id}
    Click    ${BTN_EDIT_PREFIX}${leave_id}
    Wait For Elements State    ${MODAL_EDIT_LEAVE}    visible

Cancel Leave Request
    [Arguments]    ${leave_id}
    Click    ${BTN_CANCEL_PREFIX}${leave_id}
    # Handling potential confirmation dialog
    ${confirm_visible}=    Run Keyword And Return Status    Wait For Elements State    text=ยืนยันการยกเลิก    visible    timeout=3s
    IF    ${confirm_visible}
        Click    text=ตกลง
    END
    Wait For Elements State    ${TOAST_SUCCESS}    visible
