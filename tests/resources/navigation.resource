*** Settings ***
Library    Browser    timeout=60s
Resource   common.resource

*** Keywords ***
Wait For Loading To Hide
    [Arguments]    ${timeout}=120s
    [Documentation]    รอให้ Loading Overlay (GlobalLoadingNavigator) หายไป
    ...    GlobalLoadingNavigator returns null when isLoading=false
    # หมายเหตุ (2026-09-14): ห้ามตัด Sleep / ย่อ timeout ในคีย์เวิร์ดนี้จนกว่า frontend จะประกาศ
    # page.ready — เคยลองย่อหน้าต่างจับ loader จาก ~1.3 วินาทีเหลือ 0.5 วินาที ผลคือ loader
    # ยังคลุมหน้าจอตอนเทสไปคลิกเมนู คลิกไม่ติด 120 วินาที และเคสที่เคยผ่านพัง
    Sleep    0.3s
    
    # ตรวจสอบว่า element มีอยู่ใน DOM ไหม
    ${loading_exists}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="global-loading"]    visible    timeout=1s
    
    IF    ${loading_exists}
        # รอให้หายไป (ใช้ hidden เพื่อให้ครอบคลุมทั้ง detached และ display:none)
        # ใช้ Run Keyword And Ignore Error เพื่อไม่ให้เทสพังทันทีถ้าติดที่นี่ แต่จะไปจัดการต่อด้านล่าง
        Run Keyword And Ignore Error    Wait For Elements State    css=[data-testid="global-loading"]    hidden    timeout=${timeout}
        
        # เช็คอีกครั้งว่ายังอยู่ไหม
        ${still_visible}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="global-loading"]    visible    timeout=1s
        IF    ${still_visible}
            Log    WARNING: Global loading is stuck! Force reloading the page to recover.
            ${current_url_for_reload}=    Get Url
            Go To    ${current_url_for_reload}    wait_until=domcontentloaded
            # หลังโหลดใหม่ รอให้โหลดจริงๆ เสร็จ
            Sleep    2s
            Run Keyword And Ignore Error    Wait For Elements State    css=[data-testid="global-loading"]    hidden    timeout=30s
        END
    END
    
    # มั่นใจว่าหน้าจอพร้อม
    Wait For Elements State    css=body    visible    timeout=10s
    Sleep    0.2s

Navigate To Menu
    [Arguments]    ${section_name}    ${item_name}    ${expected_path}
    [Documentation]    คลิกเมนู Sidebar อย่างปลอดภัย รองรับทั้ง Section ขยายได้ (People) และ Item ตรง (Settings)
    
    # รอหน้าเว็บพร้อม
    Wait For Loading To Hide
    
    # กำหนด Locators ที่เป็นไปได้
    ${item_locator}=    Set Variable    css=[data-testid="sidebar.item.sidebar.${item_name}"]
    ${section_locator}=    Set Variable    css=[data-testid="sidebar.section.sidebar.${section_name}"]
    ${parent_item_locator}=    Set Variable    css=[data-testid="sidebar.item.sidebar.${section_name}"]
    
    # 1. ลองดูว่า Item เป้าหมายปรากฏอยู่แล้วหรือไม่ (อาจจะขยายอยู่แล้ว หรือเป็นเมนูชั้นเดียวนอกสุด)
    ${is_item_visible}=    Run Keyword And Return Status    Wait For Elements State    ${item_locator}    visible    timeout=3s
    
    IF    ${is_item_visible}
        Click    ${item_locator}
    ELSE
        # 2. ถ้าไม่เห็น Item ให้เช็ค Parent (Section หรือ Item)
        IF    "${section_name}" != "${EMPTY}" and "${section_name}" != "None"
            # ลองกด Parent (ถ้ามีชื่อกำมา)
            ${is_section}=    Run Keyword And Return Status    Wait For Elements State    ${section_locator}    visible    timeout=2s
            IF    ${is_section}
                Click    ${section_locator}
                ${is_now_visible}=    Run Keyword And Return Status    Wait For Elements State    ${item_locator}    visible    timeout=5s
                IF    ${is_now_visible}
                    Click    ${item_locator}
                END
            ELSE
                ${is_parent}=    Run Keyword And Return Status    Wait For Elements State    ${parent_item_locator}    visible    timeout=2s
                IF    ${is_parent}
                    Click    ${parent_item_locator}
                END
                ${is_now_visible_p}=    Run Keyword And Return Status    Wait For Elements State    ${item_locator}    visible    timeout=5s
                IF    ${is_now_visible_p}
                    Click    ${item_locator}
                END
            END
        END
    END
    
    # 3. รอให้ Loading หลังคลิกหายไป ก่อนจะไปเช็ค URL
    Wait For Loading To Hide

    # 3. Fallback: ถ้ายังเข้าไม่ถึง Path ที่ต้องการ ให้ใช้ Go To (สำหรับเมนูที่ไม่อยู่ใน Sidebar หรือ UI เปลี่ยน)
    # เราย้ายออกมาข้างนอกเพื่อให้รันเสมอถ้า URL ยังไม่เปลี่ยน
    ${current_url}=    Get Url
    ${at_dest}=    Evaluate    "${expected_path}" in """${current_url}"""
    IF    not ${at_dest}
        Go To    ${URL}${expected_path}    wait_until=commit
    END
    
    # 3. ตรวจสอบ URL และรอ Loading ของหน้าใหม่
    Wait For Loading To Hide    timeout=120s
    Wait Until Keyword Succeeds    30s    2s    Check Url    ${expected_path}
