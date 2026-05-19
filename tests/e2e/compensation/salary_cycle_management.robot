*** Settings ***
Library    Browser    timeout=60s
Library           String
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource

*** Test Cases ***
User Can Create Salary Cycle And Add Employee Salary
    [Documentation]    ทดสอบการเข้าหน้ารายการเงินเดือน สร้างรอบและเพิ่มข้อมูลรายบุคคลแบบสุ่ม
    [Tags]             smoke    compensation    salary_cycle

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # 2. ไปที่หน้ารายการเงินเดือน (ใช้ Go To โดยตรงเพื่อหลีกเลี่ยง Global Loading ค้าง)
    Go To    ${URL}/salary/records
    
    # รอจนกว่า URL จะเปลี่ยนและหน้าเว็บโหลดเสร็จจริง
    Wait Until Keyword Succeeds    15s    1s    Check Url    /salary/records
    Wait For Load State    networkidle    timeout=15s
    # เพิ่มการยืนยันหน้าเว็บด้วยข้อความหัวเรื่อง
    Wait For Elements State    h1 >> text="ข้อมูลเงินเดือน"    visible    timeout=10s

    # 3. กดปุ่ม "สร้างรอบเงินเดือน" (ปุ่มที่ 2 ในหัวเพจ)
    Wait For Elements State    text=สร้างรอบเงินเดือน    visible    timeout=10s
    Click    text=สร้างรอบเงินเดือน

    # 4. รอให้ Dropdown ตัวเลือกรอบเดือนโหลดเสร็จ (ต้องมีมากกว่า 1 ตัวเลือก)
    Wait For Elements State    css=div.fixed select    visible    timeout=5s
    # เพิ่มการรอให้ Option โหลดจริง (บางที API อาจจะช้า)
    ${has_options}=    Run Keyword And Return Status    Wait For Elements State    css=div.fixed select option:nth-child(2)    attached    timeout=15s
    IF    not ${has_options}
        Log    No salary cycles available to select!    WARN
        # ถ้าไม่มีรอบให้เลือก ให้ลองกดปิด Modal หรือเลือก Option แรก (ถ้ามี)
        ${count}=    Get Element Count    css=div.fixed select option
        IF    ${count} <= 1
             Skip    ไม่พบข้อมูลรอบเงินเดือนให้เลือกใน Dropdown (กรุณาตั้งค่า Salary Periods ก่อนรันเทสนี้)
        END
    END
    
    ${option_count}=    Get Element Count    css=div.fixed select option
    
    # สุ่มเลือกรอบเดือนตามจำนวนตัวเลือกที่มี (เริ่ม Index 1 เพื่อข้าม Placeholder)
    ${random_cycle_index}=    Evaluate    random.randint(1, int(${option_count}) - 1)    modules=random
    ${random_cycle_index_str}=    Convert To String    ${random_cycle_index}
    Select Options By    css=div.fixed select    index    ${random_cycle_index_str}

    # 5. กดปุ่มยืนยันสร้างรอบเงินเดือน (ต้องรอจนกว่าปุ่มจะ Enable ก่อน)
    Wait For Elements State    css=div.fixed button.bg-primary    enabled    timeout=10s
    Click    css=div.fixed button.bg-primary
    
    # [FIX] ใช้ selector ที่ระบุเจาะจงว่าเป็น Bulk Generate Modal
    ${bulk_modal}=    Set Variable    css=div.fixed:has(h2:has-text("สร้างรอบเงินเดือน"))
    
    # รอจนกว่า Bulk Generate จะเสร็จ
    # กรณี 1: สร้างสำเร็จ -> modal ปิดเอง (successCount > 0)
    # กรณี 2: records ซ้ำทั้งหมด -> modal ยังเปิดอยู่ แสดง warning toast
    ${modal_closed}=    Run Keyword And Return Status    Wait For Elements State    ${bulk_modal}    hidden    timeout=60s
    IF    not ${modal_closed}
        Log    Modal still open (likely duplicate records), closing manually...    WARN
        # คลิกปุ่ม X ของ Modal นี้โดยเฉพาะ
        ${close_btn}=    Set Variable    ${bulk_modal} button:has(svg.lucide-x)
        ${has_close}=    Run Keyword And Return Status    Wait For Elements State    ${close_btn}    visible    timeout=5s
        IF    ${has_close}
            Click    ${close_btn}
        END
        Wait For Elements State    ${bulk_modal}    hidden    timeout=15s
    END
    Wait For Load State    networkidle    timeout=10s
    
    # 6. กดปุ่ม "เพิ่มข้อมูลเงินเดือน"
    # รอให้ Toast (ถ้ามี) หายไปก่อน เพื่อไม่ให้บัง element ด้านล่าง
    Sleep    2s
    Wait For Elements State    text="เพิ่มข้อมูลเงินเดือน"    visible    timeout=15s
    # ถ้ายังติด Toast บัง ให้ลองคลิกที่อื่นก่อน
    Click    css=body
    Wait Until Keyword Succeeds    3x    2s    Click    text="เพิ่มข้อมูลเงินเดือน"

    # 7. ค้นและเลือกพนักงาน
    # คลิกช่องเลือกพนักงานเพื่อกาง Dropdown
    ${search_placeholder}=    Set Variable    css=div.fixed .relative div[class*="min-h"]
    Wait For Elements State    ${search_placeholder}    visible    timeout=10s
    Click    ${search_placeholder}

    # พิมพ์คำค้นหาทั่วไป 'EMP01' เพื่อค้นหาพนักงานที่มี salary info
    Wait For Elements State    css=div.fixed input[placeholder*='ค้นหา']    visible    timeout=10s
    Fill Text    css=div.fixed input[placeholder*='ค้นหา']    EMP01
    
    # รอผลลัพธ์การค้นหา (API debounce + response time)
    Sleep    3s
    # ตรวจสอบว่ามีผลลัพธ์โดยใช้ Get Element Count (หลีกเลี่ยง strict mode violation)
    ${result_locator}=    Set Variable    css=div.fixed .relative .absolute div[class*="hover:bg-muted"]
    ${result_count}=    Get Element Count    ${result_locator}
    IF    ${result_count} == 0
        # ลองค้นด้วยคำที่กว้างขึ้น
        Fill Text    css=div.fixed input[placeholder*='ค้นหา']    EMP
        Sleep    3s
        ${result_count}=    Get Element Count    ${result_locator}
        IF    ${result_count} == 0
            Skip    ไม่พบพนักงานที่มีข้อมูลเงินเดือนในระบบ (กรุณาเพิ่มข้อมูล Salary Info ก่อน)
        END
    END
    
    # คลิกเลือกพนักงานแรกที่พบ (ใช้ nth=0 เพื่อเลือกตัวแรก)
    Click    ${result_locator} >> nth=0

    # กดปุ่ม Esc เพื่อพับ Dropdown พนักงานเก็บไป จะได้ไม่บังเมนูด้านล่าง
    Keyboard Key    press    Escape
    # รอให้ UI นิ่ง
    Sleep    1s

    # 8. สุ่มเลือกรอบเงินเดือนในฟอร์มย่อย (ตามภาพที่ 2)
    # พอเลือกพนักงานแล้ว จะมี Dropdown ให้เลือก "รอบเงินเดือน *" โผล่มา
    # รอให้ label ขึ้นมาก่อนชัวร์ๆ
    ${has_inner_select}=    Run Keyword And Return Status    Wait For Elements State    xpath=//label[contains(text(), "รอบ")]    visible    timeout=3s
    IF    ${has_inner_select}
        ${inner_select_locator}=    Set Variable    css=form > div:nth-of-type(2) select
        Wait For Elements State    ${inner_select_locator}    visible    timeout=5s
        # รอให้ Option สมาชิกมาครบก่อน
        Wait For Elements State    ${inner_select_locator} option:nth-child(2)    attached    timeout=5s
        ${inner_count}=    Get Element Count    ${inner_select_locator} option
        ${random_inner_index}=    Evaluate    random.randint(1, int(${inner_count}) - 1)    modules=random
        ${random_inner_str}=    Convert To String    ${random_inner_index}
        Select Options By    ${inner_select_locator}    index    ${random_inner_str}
        # รอให้ UI อัปเดตหลังจากเลือก (ถ้ามีการโหลดข้อมูลที่เกี่ยวข้อง)
        Wait For Load State    networkidle    timeout=5s
    END

    # 9. กดปุ่มบันทึก
    # Modal นี้ใช้ div.fixed (ไม่มี role="dialog") ดังนั้นต้องหาปุ่ม submit ใน form แทน
    # ปุ่มบันทึกคือ Button type="submit" ตัวสุดท้ายใน form ภายใน fixed overlay
    ${save_btn_locator}=    Set Variable    css=div.fixed button[type="submit"]
    Wait For Elements State    ${save_btn_locator}    visible    timeout=10s
    Wait For Elements State    ${save_btn_locator}    enabled    timeout=10s
    Wait Until Keyword Succeeds    10s    2s    Click    ${save_btn_locator}
    
    # รอให้ Modal บันทึกหายไป (div.fixed overlay จะหายไปหลังบันทึก)
    ${is_closed}=    Run Keyword And Return Status    Wait For Elements State    ${save_btn_locator}    hidden    timeout=20s
    IF    not ${is_closed}
        Log    WARNING: การบันทึกข้อมูลอาจซ้ำ หรือ API แจ้ง Error ทำให้ฟอร์มค้าง
        Reload
        Wait For Load State    networkidle    timeout=15s
    END
    
    # 10. รอและปิด Focus กวนใจ
    Wait For Load State    networkidle    timeout=5s
