*** Settings ***
Library    Browser    timeout=60s
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource

*** Test Cases ***
User Can Navigate To Mission Organics Page
    [Documentation]    ทดสอบการเข้าถึงหน้า "ภารกิจสะสม Point" (Mission Organics) จากเมนู Sidebar
    [Tags]             smoke    wallet    mission

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # 2. ไปที่หน้า ภารกิจสะสม Point
    # ใช้ Sidebar Section: sidebar.wallet และ Sidebar Item: sidebar.wallet.loan
    Navigate To Menu    sidebar.wallet    sidebar.wallet.loan    /wallet/loan
    Wait For Loading To Hide

    # 3. ตรวจสอบว่าหน้าโหลดสำเร็จ
    # รอให้หัวข้อที่มีข้อความ "ภารกิจ" แสดงขึ้นมา
    Wait For Elements State    xpath=//*[(self::h1 or self::h2 or self::span) and contains(., "ภารกิจ")]    visible    timeout=10s

    # 5. ถ่ายภาพหน้าจอเพื่อยืนยัน
    Take Screenshot    mission_organics_page
