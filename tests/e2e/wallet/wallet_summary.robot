*** Settings ***
Library    Browser    timeout=60s
Library           String
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource

*** Test Cases ***
User Can Add And Deduct Organics Wallet Points
    [Documentation]    ทดสอบการเพิ่มแต้มและหักแต้ม Organics ผ่าน Bulk Modal บนหน้า สรุป Organics
    [Tags]             smoke    wallet    points

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # 2. ไปที่หน้า Organic Wallet Summary
    Navigate To Menu    sidebar.wallet    sidebar.wallet.summary    /wallet/summary
    Wait For Loading To Hide

    # 3. ถ่ายภาพหน้าจอเพื่อยืนยัน
    Take Screenshot    wallet_summary_page

    # ============================
    # ส่วนที่ 1: เพิ่มแต้ม (Add Points)
    # ============================
    Click    xpath=//button[contains(., "เพิ่มแต้ม")]

    # รอ Modal เปิด
    Wait For Elements State    xpath=//input[@placeholder="0"]    visible    timeout=10s

    # กรอกจำนวนคะแนน
    Fill Text    xpath=//input[@placeholder="0"]    10

    # คลิก dropdown เหตุผล
    Wait For Elements State    xpath=(//div[@role="button" and contains(., "เลือกเหตุผล")] | //button[contains(., "เลือกเหตุผล")])[1]    visible    timeout=5s
    Click    xpath=(//div[@role="button" and contains(., "เลือกเหตุผล")] | //button[contains(., "เลือกเหตุผล")])[1]

    # เลือก "ทำความดี" จาก dropdown
    Wait For Elements State    xpath=//button[normalize-space(.)="ทำความดี"]    visible    timeout=5s
    Click    xpath=//button[normalize-space(.)="ทำความดี"]

    # ปิด dropdown ด้วย Escape
    Keyboard Key    press    Escape
    Sleep    0.3s

    # เลือกพนักงานทั้งหมด (required ก่อน "บันทึก" จะ enable)
    Wait For Elements State    xpath=//button[normalize-space(.)="เลือกทั้งหมด"]    visible    timeout=10s
    Click    xpath=//button[normalize-space(.)="เลือกทั้งหมด"]
    Sleep    0.5s

    # คลิก "บันทึก"
    Wait For Elements State    xpath=//button[contains(., "บันทึก") and not(@disabled)]    enabled    timeout=5s
    Click    xpath=//button[contains(., "บันทึก") and not(@disabled)]

    # รอ Modal ปิด
    Wait For Elements State    xpath=//button[contains(., "เพิ่มแต้ม")]    visible    timeout=15s
    Sleep    1s

    # ============================
    # ส่วนที่ 2: หักแต้ม (Deduct Points)
    # ============================
    Click    xpath=//button[contains(., "เพิ่มแต้ม")]

    # รอ Modal เปิด
    Wait For Elements State    xpath=//input[@placeholder="0"]    visible    timeout=10s

    # สลับโหมดเป็น "ตัดคะแนน (หลายคน)"
    Click    xpath=//button[contains(., "ตัดคะแนน")]
    Sleep    0.5s

    # กรอกจำนวนคะแนน
    Clear Text    xpath=//input[@placeholder="0"]
    Fill Text    xpath=//input[@placeholder="0"]    5

    # คลิก dropdown เหตุผล
    Wait For Elements State    xpath=(//div[@role="button" and contains(., "เลือกเหตุผล")] | //button[contains(., "เลือกเหตุผล")])[1]    visible    timeout=5s
    Click    xpath=(//div[@role="button" and contains(., "เลือกเหตุผล")] | //button[contains(., "เลือกเหตุผล")])[1]

    # เลือก "ฝ่าฝืนกฎระเบียบ"
    Wait For Elements State    xpath=//button[contains(., "ฝ่าฝืนกฎระเบียบ")]    visible    timeout=5s
    Click    xpath=//button[contains(., "ฝ่าฝืนกฎระเบียบ")]

    # ปิด dropdown ด้วย Escape
    Keyboard Key    press    Escape
    Sleep    0.3s

    # เลือกพนักงานทั้งหมด
    Wait For Elements State    xpath=//button[normalize-space(.)="เลือกทั้งหมด"]    visible    timeout=10s
    Click    xpath=//button[normalize-space(.)="เลือกทั้งหมด"]
    Sleep    0.5s

    # คลิก "บันทึก"
    Wait For Elements State    xpath=//button[contains(., "บันทึก") and not(@disabled)]    enabled    timeout=5s
    Click    xpath=//button[contains(., "บันทึก") and not(@disabled)]

    # รอ Modal ปิด
    Wait For Elements State    xpath=//button[contains(., "เพิ่มแต้ม")]    visible    timeout=15s

    # Screenshot สุดท้าย
    Take Screenshot    wallet_points_add_deduct_success
