*** Settings ***
Documentation     ตั้งค่า › วิธีลงเวลาของแต่ละแผนก (App / Scanner)
...
...               การบันทึกหน้านี้เปลี่ยนวิธีลงเวลาของพนักงานทุกคนในแผนก และสร้างสิทธิ์ให้คนที่ยังไม่มี
...               แผนกที่พนักงานใช้ปนกันสองวิธี ถ้าถูกบันทึกทับจะกลายเป็นวิธีเดียวและคืนสภาพเดิมไม่ได้
...
...               สวีทนี้รันบนข้อมูลที่ใช้ร่วมกัน จึงทดสอบเฉพาะพฤติกรรมที่ไม่ทำลายข้อมูล:
...               เลือก → นับการเปลี่ยนแปลง → ยกเลิกคืนค่า, ปุ่มบันทึก, และแผนกที่ไม่มีพนักงาน
...               ส่วน "บันทึกแล้วข้อมูลเปลี่ยนจริง" ต้องพิสูจน์ในชั้น API บนฐานข้อมูลทดสอบ
Resource          ../../resources/session.resource
Resource          ../../../resources/core/page_state.resource

Suite Setup       Open Browser For Suite
Suite Teardown    Close Browser    ALL
Test Setup        Open Fresh Logged In Page
Test Teardown     Close Test Page


*** Variables ***
${PAGE}           settings.attendanceMethods
${PATH}           /settings/attendance-methods
${ROW_PREFIX}     settings.attendanceMethods.table.row.


*** Test Cases ***
Page Loads Into A Ready State
    [Tags]    smoke    settings    attendance_methods
    Open Attendance Methods Page
    Wait For Elements State    css=[data-testid="${PAGE}.page.error"]    detached    timeout=1s

The Department Count Matches The Departments Listed
    [Documentation]    ตัวเลขสรุปด้านบนต้องตรงกับจำนวนแผนกในตาราง
    [Tags]    smoke    settings    attendance_methods
    Open Attendance Methods Page
    ${listed}=    Get Element Count    css=[data-testid^="${ROW_PREFIX}"][data-employees]
    ${metric}=    Get Attribute    css=[data-testid="${PAGE}.metric.departments"]    data-value
    Should Be Equal As Integers    ${metric}    ${listed}

Save Is Disabled While Nothing Has Changed
    [Tags]    settings    attendance_methods
    Open Attendance Methods Page
    Wait For Elements State    css=[data-testid="${PAGE}.toolbar.save"]    disabled    timeout=5s
    Get Attribute    css=[data-testid="${PAGE}.toolbar.save"]    data-count    ==    0
    Wait For Elements State    css=[data-testid="${PAGE}.toolbar.discard"]    detached    timeout=1s

A Changed Method Is Counted And Can Be Discarded Without Saving
    [Documentation]    เปลี่ยนวิธีของแผนกหนึ่ง → ต้องถูกนับเป็นการเปลี่ยน 1 รายการ → ยกเลิกแล้วกลับเป็นค่าเดิมทั้งหมด
    [Tags]    smoke    settings    attendance_methods
    Open Attendance Methods Page
    ${department}    ${current}    ${other}=    Pick An Editable Department
    Click    css=[data-testid="${ROW_PREFIX}${department}.method.${other}"]
    Wait For Elements State    css=[data-testid="${ROW_PREFIX}${department}"][data-changed="true"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.toolbar.save"]    enabled    timeout=5s
    Get Attribute    css=[data-testid="${PAGE}.toolbar.save"]    data-count    ==    1
    Click    css=[data-testid="${PAGE}.toolbar.discard"]
    Wait For Elements State    css=[data-testid="${ROW_PREFIX}${department}"][data-changed="false"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${ROW_PREFIX}${department}.method.${current}"][data-state="selected"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.toolbar.save"]    disabled    timeout=5s

Departments Without Employees Cannot Be Changed
    [Documentation]    แผนกที่ไม่มีพนักงานไม่มีใครให้เปลี่ยนวิธีลงเวลา ปุ่มเลือกวิธีจึงต้องกดไม่ได้
    [Tags]    settings    attendance_methods
    Open Attendance Methods Page
    ${empty_rows}=    Get Element Count    css=[data-testid^="${ROW_PREFIX}"][data-employees="0"]
    IF    ${empty_rows} == 0
        Skip    ไม่มีแผนกที่ไม่มีพนักงานในข้อมูลปัจจุบัน — ไม่มีอะไรให้ตรวจ
    END
    ${row}=    Get Element    css=[data-testid^="${ROW_PREFIX}"][data-employees="0"] >> nth=0
    ${testid}=    Get Attribute    ${row}    data-testid
    ${department}=    Evaluate    "${testid}"[len("${ROW_PREFIX}"):]
    Wait For Elements State    css=[data-testid="${ROW_PREFIX}${department}.method.app"]    disabled    timeout=5s
    Wait For Elements State    css=[data-testid="${ROW_PREFIX}${department}.method.scanner"]    disabled    timeout=5s


*** Keywords ***
Open Attendance Methods Page
    Go To    ${URL}${PATH}
    Wait For Page Ready    ${PAGE}

Pick An Editable Department
    [Documentation]    คืน id ของแผนกแรกที่มีพนักงาน พร้อมวิธีที่เลือกอยู่และวิธีอีกแบบหนึ่ง
    ${rows}=    Get Elements    css=[data-testid^="${ROW_PREFIX}"][data-employees]:not([data-employees="0"])
    ${count}=    Get Length    ${rows}
    IF    ${count} == 0
        Skip    ไม่มีแผนกที่มีพนักงานในข้อมูลปัจจุบัน — ไม่มีอะไรให้ทดสอบการเปลี่ยนวิธี
    END
    ${testid}=    Get Attribute    ${rows}[0]    data-testid
    ${department}=    Evaluate    "${testid}"[len("${ROW_PREFIX}"):]
    ${app_selected}=    Run Keyword And Return Status
    ...    Wait For Elements State    css=[data-testid="${ROW_PREFIX}${department}.method.app"][data-state="selected"]    visible    timeout=2s
    ${current}=    Set Variable If    ${app_selected}    app    scanner
    ${other}=    Set Variable If    ${app_selected}    scanner    app
    RETURN    ${department}    ${current}    ${other}
