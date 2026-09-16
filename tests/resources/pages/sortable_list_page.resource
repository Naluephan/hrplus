*** Settings ***
Documentation    Page object ร่วมสำหรับหน้าตั้งค่าที่เป็น "รายการเรียงลำดับได้" แบบเดียวกัน
...
...              หน้าเหล่านี้หน้าตาและพฤติกรรมเหมือนกันทุกประการ: ปุ่มเพิ่ม, ฟอร์ม inline,
...              รายการที่ลากเรียงได้, สลับเปิด/ปิด, แก้ไข และลบด้วยกล่องยืนยันของเบราว์เซอร์
...              เช่น เหตุผลที่ไม่ผ่านการคัดเลือก และช่องทางที่รู้จักตำแหน่งงาน
...
...              สวีทที่ใช้ต้องกำหนดตัวแปรสามตัวใน *** Variables ***
...                ${LIST_PAGE}     testid prefix ของหน้า เช่น settings.rejectionReasons
...                ${LIST_PATH}     path ของหน้า เช่น /settings/rejection-reasons
...                ${LIST_FIELD}    ชื่อฟิลด์ข้อความในฟอร์ม เช่น reason หรือ label
...
...              ทุก locator ใช้ data-testid · ทุกการกระทำจบด้วยการรอสถานะ · ไม่มี Sleep
...              แถวอ้างด้วย id จริงจากฐานข้อมูล ไม่อ้างด้วยลำดับ
Library    Browser
Resource   ../../../resources/core/page_state.resource


*** Keywords ***
Open List Page
    Go To    ${URL}${LIST_PATH}
    Wait For Page Ready    ${LIST_PAGE}

Start Adding A List Item
    Click    css=[data-testid="${LIST_PAGE}.toolbar.add"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.create"]    visible    timeout=${ACTION_TIMEOUT}

Add List Item
    [Documentation]    เพิ่มรายการใหม่แล้วคืน id ของแถวที่ระบบสร้างให้
    [Arguments]    ${text}
    Start Adding A List Item
    Fill Text    css=[data-testid="${LIST_PAGE}.form.${LIST_FIELD}.input"]    ${text}
    Click    css=[data-testid="${LIST_PAGE}.modal.create.save"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.create"]    detached    timeout=${ACTION_TIMEOUT}
    ${id}=    List Item Id    ${text}
    RETURN    ${id}

List Item Id
    [Documentation]    หา id จริงของแถวจากข้อความที่เทสสร้างเอง (ข้อความไม่ซ้ำ จึงระบุได้แถวเดียว)
    [Arguments]    ${text}
    ${name_cell}=    Set Variable    css=[data-testid^="${LIST_PAGE}.table.row."][data-testid$=".name"]:text-is("${text}")
    Wait For Elements State    ${name_cell}    visible    timeout=${ACTION_TIMEOUT}
    ${testid}=    Get Attribute    ${name_cell}    data-testid
    ${id}=    Evaluate    "${testid}"[len("${LIST_PAGE}.table.row."):-len(".name")]
    RETURN    ${id}

Rename List Item
    [Arguments]    ${id}    ${new_text}
    Click    css=[data-testid="${LIST_PAGE}.table.row.${id}.action.edit"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.edit"]    visible    timeout=${ACTION_TIMEOUT}
    Fill Text    css=[data-testid="${LIST_PAGE}.form.${LIST_FIELD}.input"]    ${new_text}
    Click    css=[data-testid="${LIST_PAGE}.modal.edit.save"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.edit"]    detached    timeout=${ACTION_TIMEOUT}

Toggle List Item
    [Documentation]    สลับสถานะ แล้วรอจนปุ่มแสดงสถานะใหม่ (ยืนยันว่า API ตอบแล้ว ไม่ใช่แค่กดไป)
    [Arguments]    ${id}    ${expected_state}
    Click    css=[data-testid="${LIST_PAGE}.table.row.${id}.action.toggle"]
    Wait For Elements State
    ...    css=[data-testid="${LIST_PAGE}.table.row.${id}.action.toggle"][data-state="${expected_state}"]
    ...    visible    timeout=${ACTION_TIMEOUT}

Delete List Item
    [Documentation]    ลบผ่านกล่องยืนยันของเบราว์เซอร์ แล้วรอจนแถวหายจากหน้า
    [Arguments]    ${id}
    Handle Future Dialogs    action=accept
    Click    css=[data-testid="${LIST_PAGE}.table.row.${id}.action.delete"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.table.row.${id}"]    detached    timeout=${ACTION_TIMEOUT}

Delete List Item If Present
    [Documentation]    เก็บกวาดหลังเทส — ไม่พังถ้าเทสลบไปแล้วหรือไม่เคยสร้างสำเร็จ
    [Arguments]    ${text}
    ${present}=    Run Keyword And Return Status
    ...    Wait For Elements State
    ...    css=[data-testid^="${LIST_PAGE}.table.row."][data-testid$=".name"]:text-is("${text}")
    ...    visible    timeout=2s
    IF    ${present}
        ${id}=    List Item Id    ${text}
        Delete List Item    ${id}
    END

List Item Should Read
    [Arguments]    ${id}    ${expected}
    Get Text    css=[data-testid="${LIST_PAGE}.table.row.${id}.name"]    ==    ${expected}

Clean Up List Item And Close Page
    [Documentation]    Teardown ของเคสที่สร้างข้อมูล: ลบสิ่งที่สร้าง แล้วปิด context ของเคส
    [Arguments]    ${text}
    Run Keyword And Ignore Error    Open List Page
    Run Keyword And Ignore Error    Delete List Item If Present    ${text}
    Close Test Page
