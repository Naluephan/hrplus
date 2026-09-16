*** Settings ***
Documentation     ตั้งค่า › โหมดการเบิกอุปกรณ์
...
...               เลือกว่าการเบิกอุปกรณ์ทำงานร่วมกับคลัง ERP หรือใช้คลังของ HR เอง
...               ค่านี้มีผลกับทั้งบริษัท — ทุกเคสที่เปลี่ยนค่าจะคืนค่าเดิมตอนจบเสมอ
...               แม้เคสจะล้มกลางทาง
Resource          ../../resources/session.resource
Resource          ../../../resources/core/page_state.resource

Suite Setup       Remember The Saved Mode
Suite Teardown    Restore The Saved Mode And Close
Test Setup        Open Fresh Logged In Page
Test Teardown     Close Test Page


*** Variables ***
${PAGE}               settings.equipmentMode
${PATH}               /settings/equipment-mode
${ORIGINAL_MODE}      ${EMPTY}


*** Test Cases ***
Page Loads Into A Ready State
    [Tags]    smoke    settings    equipment_mode
    Open Equipment Mode Page
    Wait For Elements State    css=[data-testid="${PAGE}.page.error"]    detached    timeout=1s

The Saved Mode Is Selected And Marked In Use
    [Documentation]    ตัวเลือกที่ถูกเลือกตอนเปิดหน้า ต้องเป็นตัวเดียวกับที่ติดป้าย "ใช้อยู่"
    [Tags]    smoke    settings    equipment_mode
    Open Equipment Mode Page
    ${saved}=    Saved Mode
    Wait For Elements State    css=[data-testid="${PAGE}.option.${saved}"][data-state="selected"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.form.save"]    disabled    timeout=5s

Choosing Another Mode Warns And Enables Save Without Saving
    [Documentation]    แค่คลิกการ์ดยังไม่บันทึก — โหลดหน้าใหม่แล้วค่าต้องเป็นค่าเดิม
    [Tags]    settings    equipment_mode
    Open Equipment Mode Page
    ${saved}=    Saved Mode
    ${other}=    Other Mode    ${saved}
    Click    css=[data-testid="${PAGE}.option.${other}"]
    Wait For Elements State    css=[data-testid="${PAGE}.warning.impact"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.form.save"]    enabled    timeout=5s
    Open Equipment Mode Page
    ${after_reload}=    Saved Mode
    Should Be Equal    ${after_reload}    ${saved}

Choosing The Saved Mode Again Clears The Warning
    [Tags]    settings    equipment_mode
    Open Equipment Mode Page
    ${saved}=    Saved Mode
    ${other}=    Other Mode    ${saved}
    Click    css=[data-testid="${PAGE}.option.${other}"]
    Wait For Elements State    css=[data-testid="${PAGE}.warning.impact"]    visible    timeout=5s
    Click    css=[data-testid="${PAGE}.option.${saved}"]
    Wait For Elements State    css=[data-testid="${PAGE}.warning.impact"]    detached    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.form.save"]    disabled    timeout=5s

Saving A New Mode Persists It
    [Tags]    smoke    settings    equipment_mode    crud
    Open Equipment Mode Page
    ${saved}=    Saved Mode
    ${other}=    Other Mode    ${saved}
    Save Mode    ${other}
    Open Equipment Mode Page
    ${after_reload}=    Saved Mode
    Should Be Equal    ${after_reload}    ${other}
    [Teardown]    Restore Mode And Close Page    ${saved}


*** Keywords ***
Open Equipment Mode Page
    Go To    ${URL}${PATH}
    Wait For Page Ready    ${PAGE}

Saved Mode
    [Documentation]    อ่านโหมดที่บันทึกไว้จากป้าย "ใช้อยู่" — ไม่ใช่จากการ์ดที่กำลังเลือก
    ${badge}=    Set Variable    css=[data-testid^="${PAGE}.option."][data-testid$=".inUse"]
    Wait For Elements State    ${badge}    visible    timeout=${ACTION_TIMEOUT}
    ${testid}=    Get Attribute    ${badge}    data-testid
    ${mode}=    Evaluate    "${testid}"[len("${PAGE}.option."):-len(".inUse")]
    RETURN    ${mode}

Other Mode
    [Arguments]    ${mode}
    ${other}=    Set Variable If    "${mode}" == "erp"    standalone    erp
    RETURN    ${other}

Save Mode
    [Documentation]    เลือกโหมดแล้วบันทึก รอจนระบบยืนยันว่าบันทึกสำเร็จและป้ายย้ายไปที่โหมดใหม่
    [Arguments]    ${mode}
    Click    css=[data-testid="${PAGE}.option.${mode}"]
    Click    css=[data-testid="${PAGE}.form.save"]
    Wait For Elements State    css=[data-testid="${PAGE}.toast.success"]    visible    timeout=${ACTION_TIMEOUT}
    Wait For Elements State    css=[data-testid="${PAGE}.option.${mode}.inUse"]    visible    timeout=${ACTION_TIMEOUT}

Restore Mode And Close Page
    [Arguments]    ${mode}
    Run Keyword And Ignore Error    Ensure Mode Is Saved    ${mode}
    Close Test Page

Ensure Mode Is Saved
    [Arguments]    ${mode}
    Open Equipment Mode Page
    ${current}=    Saved Mode
    IF    "${current}" != "${mode}"    Save Mode    ${mode}

Remember The Saved Mode
    [Documentation]    จำค่าที่บริษัทใช้อยู่ก่อนสวีทเริ่ม เพื่อคืนให้ครบตอนจบ
    Open Browser For Suite
    Open Fresh Logged In Page
    Open Equipment Mode Page
    ${saved}=    Saved Mode
    Set Suite Variable    ${ORIGINAL_MODE}    ${saved}
    Close Test Page

Restore The Saved Mode And Close
    [Documentation]    ตาข่ายชั้นสุดท้าย: ไม่ว่าเคสไหนจะล้ม ค่าของบริษัทต้องกลับเป็นค่าก่อนเริ่มสวีท
    IF    "${ORIGINAL_MODE}" != "${EMPTY}"
        Run Keyword And Ignore Error    Open Fresh Logged In Page
        Run Keyword And Ignore Error    Ensure Mode Is Saved    ${ORIGINAL_MODE}
        Run Keyword And Ignore Error    Close Test Page
    END
    Close Browser    ALL
