*** Settings ***
Documentation     ตั้งค่า › ช่องทางที่รู้จักตำแหน่งงาน
...
...               ตัวเลือกเหล่านี้แสดงเป็น dropdown ในใบสมัครงาน ให้ผู้สมัครระบุว่ารู้จักงานจากที่ไหน
...               ข้อมูลนี้ใช้วัดผลช่องทางสรรหา จึงต้องสร้าง แก้ไข ปิดใช้งาน และลบได้ถูกต้อง
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
${LIST_PAGE}      settings.applicationSources
${LIST_PATH}      /settings/application-sources
${LIST_FIELD}     label


*** Test Cases ***
Page Loads Into A Ready State
    [Documentation]    หน้าต้องเข้าสู่สถานะ ready — ไม่ใช่ error และไม่ค้างที่ loading
    [Tags]    smoke    settings    application_sources
    Open List Page
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.page.error"]    detached    timeout=1s

Creating A Source Adds It To The List
    [Tags]    smoke    settings    application_sources    crud
    ${source}=    Unique Source
    Open List Page
    ${id}=    Add List Item    ${source}
    List Item Should Read    ${id}    ${source}
    [Teardown]    Clean Up List Item And Close Page    ${source}

A Source Survives A Page Reload
    [Documentation]    ยืนยันว่าบันทึกลงระบบจริง ไม่ใช่แค่แสดงในหน้าจอชั่วคราว
    [Tags]    settings    application_sources    crud
    ${source}=    Unique Source
    Open List Page
    ${id}=    Add List Item    ${source}
    Open List Page
    List Item Should Read    ${id}    ${source}
    [Teardown]    Clean Up List Item And Close Page    ${source}

Saving An Empty Source Is Refused
    [Tags]    settings    application_sources    negative
    Open List Page
    Start Adding A List Item
    Click    css=[data-testid="${LIST_PAGE}.modal.create.save"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.form.${LIST_FIELD}.error"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.create"]    visible    timeout=1s

Cancelling The Form Creates Nothing
    [Tags]    settings    application_sources    negative
    ${source}=    Unique Source
    Open List Page
    Start Adding A List Item
    Fill Text    css=[data-testid="${LIST_PAGE}.form.${LIST_FIELD}.input"]    ${source}
    Click    css=[data-testid="${LIST_PAGE}.modal.create.cancel"]
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.modal.create"]    detached    timeout=5s
    Wait For Elements State
    ...    css=[data-testid$=".name"]:text-is("${source}")    detached    timeout=2s

Renaming A Source Updates It
    [Tags]    settings    application_sources    crud
    ${source}=    Unique Source
    ${renamed}=    Set Variable    ${source} (แก้ไข)
    Open List Page
    ${id}=    Add List Item    ${source}
    Rename List Item    ${id}    ${renamed}
    List Item Should Read    ${id}    ${renamed}
    [Teardown]    Clean Up List Item And Close Page    ${renamed}

Deactivating And Reactivating A Source
    [Documentation]    ช่องทางที่ปิดใช้งานต้องไม่หายจากรายการ — แค่เปลี่ยนสถานะ
    [Tags]    settings    application_sources    crud
    ${source}=    Unique Source
    Open List Page
    ${id}=    Add List Item    ${source}
    Toggle List Item    ${id}    inactive
    Toggle List Item    ${id}    active
    [Teardown]    Clean Up List Item And Close Page    ${source}

Deleting A Source Removes It
    [Tags]    smoke    settings    application_sources    crud
    ${source}=    Unique Source
    Open List Page
    ${id}=    Add List Item    ${source}
    Delete List Item    ${id}
    Open List Page
    Wait For Elements State    css=[data-testid="${LIST_PAGE}.table.row.${id}"]    detached    timeout=5s


*** Keywords ***
Unique Source
    ${suffix}=    Generate Random String    8    [LOWER][NUMBERS]
    RETURN    ช่องทางทดสอบ ${suffix}
