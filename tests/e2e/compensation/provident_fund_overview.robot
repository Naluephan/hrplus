*** Settings ***
Library    Browser    timeout=60s
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource

*** Test Cases ***
User Can View Provident Fund Overview
    [Documentation]    ทดสอบการเข้าหน้าภาพรวมกองทุนสำหรับจัดการเงินเดือน
    [Tags]             smoke    compensation    provident_fund

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # 2. ไปที่หน้ารายรวมกองทุน
    Navigate To Menu    compensation    compensation.fund.overview    /wallet/fund
    
    # รอจนกว่า URL จะเปลี่ยนและหน้าเว็บโหลดเสร็จจริง
    Wait Until Keyword Succeeds    15s    1s    Check Url    /wallet/fund
    Wait For Load State    networkidle    timeout=15s
    # ยืนยันหน้าเว็บด้วยข้อความ
    Wait For Elements State    h1 >> text="กองทุนสำรองเลี้ยงชีพ"    visible    timeout=10s
