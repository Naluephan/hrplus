*** Settings ***
Documentation     ตั้งค่า › เหตุผลที่ไม่ผ่านการคัดเลือก
...
...               เหตุผลเหล่านี้ถูกเลือกตอน HR บันทึกว่าผู้สมัครไม่ผ่าน จึงต้องสร้าง แก้ไข
...               ปิดใช้งาน และลบได้อย่างถูกต้อง โดยไม่ทำให้รายการของคนอื่นเสียหาย
...
...               ทุกเคสสร้างข้อมูลด้วยชื่อที่ไม่ซ้ำ และลบทิ้งเองตอนจบ
Resource          ../../resources/session.resource
Resource          ../../resources/pages/sortable_list_page.resource
Library           String

Suite Setup       Open Browser For Suite
Suite Teardown    Close Browser    ALL
Test Setup        Open Fresh Logged In Page
Test Teardown     Close Test Page


*** Variables ***
${LIST_PAGE}      settings.rejectionReasons
${LIST_PATH}      /settings/rejection-reasons
${LIST_FIELD}     reason


*** Test Cases ***
Page Loads Into A Ready State
    [Documentation]    หน้าต้องเข้าสู่สถานะ ready — ไม่ใช่ error และไม่ค้างที่ loading
    [Tags]    smoke    settings    rejection_reasons
    Open List Page
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.page.error"]    detached    timeout=1s

Creating A Reason Adds It To The List
    [Tags]    smoke    settings    rejection_reasons    crud
    ${reason}=    Unique Reason
    Open List Page
    ${id}=    Add List Item    ${reason}
    List Item Should Read    ${id}    ${reason}
    [Teardown]    Clean Up List Item And Close Page    ${reason}

A Reason Survives A Page Reload
    [Documentation]    ยืนยันว่าบันทึกลงระบบจริง ไม่ใช่แค่แสดงในหน้าจอชั่วคราว
    [Tags]    settings    rejection_reasons    crud
    ${reason}=    Unique Reason
    Open List Page
    ${id}=    Add List Item    ${reason}
    Open List Page
    List Item Should Read    ${id}    ${reason}
    [Teardown]    Clean Up List Item And Close Page    ${reason}

Saving An Empty Reason Is Refused
    [Documentation]    API ของเหตุผลยอมรับค่าว่าง (ดู hrplus/docs/API_TESTING.md) หน้าเว็บจึงเป็นด่านเดียวที่กันไว้
    [Tags]    settings    rejection_reasons    negative
    Open List Page
    Start Adding A List Item
    Click    css=[data-testid="${LIST_PAGE}.modal.create.save"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.form.${LIST_FIELD}.error"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.create"]    visible    timeout=1s

Cancelling The Form Creates Nothing
    [Tags]    settings    rejection_reasons    negative
    ${reason}=    Unique Reason
    Open List Page
    Start Adding A List Item
    Fill Text    css=[data-testid="${LIST_PAGE}.form.${LIST_FIELD}.input"]    ${reason}
    Click    css=[data-testid="${LIST_PAGE}.modal.create.cancel"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.create"]    detached    timeout=5s
    Wait For Elements State
    ...    css=[data-testid$=".name"]:text-is("${reason}")    detached    timeout=2s

Renaming A Reason Updates It
    [Tags]    settings    rejection_reasons    crud
    ${reason}=    Unique Reason
    ${renamed}=    Set Variable    ${reason} (แก้ไข)
    Open List Page
    ${id}=    Add List Item    ${reason}
    Rename List Item    ${id}    ${renamed}
    List Item Should Read    ${id}    ${renamed}
    [Teardown]    Clean Up List Item And Close Page    ${renamed}

Deactivating And Reactivating A Reason
    [Tags]    settings    rejection_reasons    crud
    ${reason}=    Unique Reason
    Open List Page
    ${id}=    Add List Item    ${reason}
    Toggle List Item    ${id}    inactive
    Toggle List Item    ${id}    active
    [Teardown]    Clean Up List Item And Close Page    ${reason}

Deleting A Reason Removes It
    [Tags]    smoke    settings    rejection_reasons    crud
    ${reason}=    Unique Reason
    Open List Page
    ${id}=    Add List Item    ${reason}
    Delete List Item    ${id}
    Open List Page
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.table.row.${id}"]    detached    timeout=5s


*** Keywords ***
Unique Reason
    ${suffix}=    Generate Random String    8    [LOWER][NUMBERS]
    RETURN    ทดสอบระบบ ${suffix}

