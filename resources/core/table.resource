*** Settings ***
Documentation    คีย์เวิร์ดสำหรับตาราง/รายการ ที่อ้างแถวด้วย "id จริง" ตาม docs/TESTING_STANDARDS.md
...              ห้ามอ้างแถวด้วยลำดับ (`row.1`, `nth-child(2)`) เพราะลำดับเปลี่ยนได้ทุกครั้งที่ข้อมูลเปลี่ยน

Library    Browser
Resource   page_state.resource


*** Keywords ***
Row Should Be Visible
    [Arguments]    ${page}    ${id}
    Wait For Elements State    css=[data-testid="${page}.table.row.${id}"]    visible    timeout=${ACTION_TIMEOUT}

Row Should Not Exist
    [Arguments]    ${page}    ${id}
    Wait For Elements State    css=[data-testid="${page}.table.row.${id}"]    detached    timeout=${ACTION_TIMEOUT}

Get Row Text
    [Arguments]    ${page}    ${id}
    RETURN    Get Text    css=[data-testid="${page}.table.row.${id}"]

Open Row Action
    [Documentation]    กดปุ่มบนแถว เช่น view / edit / delete
    [Arguments]    ${page}    ${id}    ${action}
    Click    css=[data-testid="${page}.table.row.${id}.action.${action}"]

Search In Table
    [Documentation]    พิมพ์คำค้น ยืนยันผล แล้วรอตารางโหลดเสร็จ — ไม่มีการรอแบบตายตัว
    [Arguments]    ${page}    ${term}
    Fill Text     css=[data-testid="${page}.search.input"]    ${term}
    Keyboard Key    press    Enter
    Wait For Table Ready    ${page}

Table Should Be Empty
    [Arguments]    ${page}
    Wait For Elements State    css=[data-testid="${page}.table.empty"]    visible    timeout=${ACTION_TIMEOUT}

Confirm Delete
    [Documentation]    ยืนยันในกล่อง confirm แล้วรอจนกล่องปิด
    [Arguments]    ${page}
    Wait For Elements State    css=[data-testid="${page}.confirm.delete"]            visible     timeout=${ACTION_TIMEOUT}
    Click                      css=[data-testid="${page}.confirm.delete.confirm"]
    Wait For Elements State    css=[data-testid="${page}.confirm.delete"]            detached    timeout=${ACTION_TIMEOUT}
