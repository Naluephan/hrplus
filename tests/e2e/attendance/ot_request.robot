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

    # 5. กดปุ่มเปิด Dropdown เลือกหัวหน้าผู้ส่งคำขอ
    # Combobox แสดงเป็น Skeleton ขณะ loadingSupervisors=true จนกว่า API ตอบกลับ
    # ใช้ retry pattern เพราะ global loading ไม่ครอบคลุม component-level loading
    ${supervisor_dropdown}=    Set Variable    [data-testid="ot-supervisor-combobox"]
    Wait Until Keyword Succeeds    60s    2s    Wait For Elements State    ${supervisor_dropdown}    visible    timeout=3s
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
