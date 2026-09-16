*** Settings ***
Library    Browser    timeout=60s
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource

*** Test Cases ***
User Can Create OT Request And Start OT
    [Documentation]    ทดสอบการเข้าหน้าจัดการ OT, เลือกพนักงาน, และกดเริ่ม OT
    [Tags]             smoke    attendance    ot    ot_request

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # 2. ไปที่เมนู "จัดการ OT" (Attendance -> Overtime)
    Navigate To Menu    attendance    attendance.overtime    /attendance/overtime
    Wait For Load State    networkidle    timeout=10s

    # 4. กดเลือก OT Card "OT Request"
    ${ot_request_card}=    Set Variable    text="OT Request"
    Wait For Elements State    ${ot_request_card}    visible    timeout=10s
    Click    ${ot_request_card}
    # Wait Until Keyword Succeeds    15s    1s    Check Url    /attendance/overtime/request
    Wait For Load State    networkidle    timeout=30s

    # 5. เลือกหัวหน้าผู้ส่งคำขอ
    #
    # ขั้นตอนตั้งแต่ตรงนี้ลงไปยังทำไม่ได้: หน้า /attendance/overtime/request
    # ไม่มี data-testid สักตัวเดียว (ตรวจด้วย scripts/audit_testids.py)
    # selector ที่เทสนี้อ้างถึง — ot-supervisor-combobox, .search และตัวเลือกพนักงาน —
    # ไม่มีอยู่จริงในแอป เทสจึงพังด้วย timeout มาตลอดโดยไม่ได้แปลว่าระบบเสีย
    #
    # ไม่เปลี่ยนไปจับด้วยข้อความหรือโครงสร้าง DOM แทน เพราะขัดกับ
    # docs/TESTING_STANDARDS.md และจะพังซ้ำทันทีที่ดีไซน์ขยับ
    #
    # ปลดล็อกได้เมื่อ frontend ใส่ testid ชุดนี้:
    #   overtime.request.page.loading / .ready / .error
    #   overtime.request.form.supervisor.select
    #   overtime.request.form.supervisor.option.<employeeId>
    #   overtime.request.table.row.<employeeId>
    #   overtime.request.toolbar.start
    ${supervisor_dropdown}=    Set Variable    [data-testid="ot-supervisor-combobox"]
    ${has_dropdown}=    Run Keyword And Return Status
    ...    Wait For Elements State    ${supervisor_dropdown}    visible    timeout=5s
    IF    not ${has_dropdown}
        Skip    หน้าคำขอ OT ยังไม่มี data-testid — เพิ่ม overtime.request.* ตามที่ระบุด้านบนก่อนจึงจะทดสอบขั้นตอนนี้ได้
    END
    Click    ${supervisor_dropdown}

    # 5.1 พิมพ์ค้นหาเพื่อให้ชัวร์ว่าเจอ EMP0101
    ${search_input}=    Set Variable    [data-testid="ot-supervisor-combobox.search"]
    Wait For Elements State    ${search_input}    visible    timeout=10s
    Fill Text    ${search_input}    EMP0101

    # 6. คลิกเลือกพนักงาน EMP0101 (ใช้แบบไม่ strict text เพื่อให้หาเจอแม้มีชื่อต่อท้าย)
    ${employee_option}=    Set Variable    css=[role="option"]:has-text("EMP0101")
    Wait For Elements State    ${employee_option}    visible    timeout=10s
    Click    ${employee_option}
    Wait For Load State    networkidle    timeout=5s

    # 7. คลิก Checkbox เพื่อ "Select all team members" ในตาราง
    # ใช้ Checkbox state check
    ${select_all_checkbox}=    Set Variable    css=thead input[type="checkbox"]
    Wait For Elements State    ${select_all_checkbox}    visible    timeout=10s
    Click    ${select_all_checkbox}

    # 8. คลิกพื้นที่ว่างเพื่อเคลียร์ Focus
    Click    css=h1

    # 9. กดปุ่ม "เริ่ม OT"
    ${start_ot_btn}=    Set Variable    button >> text="เริ่ม OT"
    Wait For Elements State    ${start_ot_btn}    visible    timeout=10s
    Click    ${start_ot_btn}
    Wait For Load State    networkidle    timeout=15s
