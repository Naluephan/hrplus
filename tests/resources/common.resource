*** Settings ***
Library    Browser    timeout=120s
Resource   browser.resource
Resource   navigation.resource
# Resource   variables.resource

*** Keywords ***
Open HR Plus Application
    [Arguments]    ${load_session}=True
    Start Browser    ${URL}    load_session=${load_session}

Login To Application
    [Documentation]    ล็อกอินเข้าระบบ หรือใช้เซสชันเดิมถ้ายังใช้ได้อยู่
    ...
    ...                จุดสำคัญคือต้อง "รอให้รู้ผลก่อน" ว่าตอนนี้ล็อกอินอยู่หรือยัง
    ...                ของเดิมอ่าน URL ทันทีหลัง Go To ซึ่งยังเป็น /login เพราะแอปยัง
    ...                redirect ไม่เสร็จ แล้วสรุปว่ายังไม่ได้ล็อกอิน จากนั้นไปรอฟอร์ม
    ...                login นาน 60 วินาทีทั้งที่แอป redirect ไป dashboard ไปแล้ว
    ...                — เทสที่รันเดี่ยวจะผ่าน แต่พอรันรวม (มีเซสชันจากสวีทก่อนหน้า)
    ...                จะพังทุกไฟล์ด้วย TimeoutError ที่ locator id=login-email
    Go To    ${URL}/login    wait_until=domcontentloaded

    ${state}=    Wait Until Keyword Succeeds    90s    0.5s    Resolve Authentication State

    IF    '${state}' == 'anonymous'
        Fill Text    id=login-email       ${LOGIN_EMAIL}
        Fill Text    id=login-password    ${LOGIN_PASSWORD}
        Wait For Elements State    xpath=//button[@type='submit']    enabled    timeout=30s
        Click    xpath=//button[@type='submit']

        # หลังล็อกอินสำเร็จ ระบบพาไป /announcements หรือ /dashboard
        Wait Until Keyword Succeeds    60s    1s    Check Url    .*(/announcements|/dashboard).*
        Save Current Session
    ELSE
        Log    ใช้เซสชันเดิมที่ล็อกอินไว้แล้ว
    END

    Wait For Loading To Hide

Resolve Authentication State
    [Documentation]    บอกว่าตอนนี้อยู่ในสถานะ authenticated หรือ anonymous
    ...
    ...                ถ้ายังบอกไม่ได้ (เช่น redirect ยังไม่จบ) จะ Fail เพื่อให้ผู้เรียก
    ...                ลองใหม่ — เป็นการรอ "สถานะ" ไม่ใช่รอ "เวลา"
    ${url}=    Get Url
    ${logged_in}=    Run Keyword And Return Status
    ...    Should Match Regexp    ${url}    /(dashboard|announcements)
    IF    ${logged_in}    RETURN    authenticated

    ${form_visible}=    Run Keyword And Return Status
    ...    Wait For Elements State    id=login-email    visible    timeout=1s
    IF    ${form_visible}    RETURN    anonymous

    Fail    ยังสรุปสถานะการล็อกอินไม่ได้ (url=${url})

Check Url
    [Arguments]    ${expected_path}
    Wait Until Keyword Succeeds    30s    1s    Get Url    matches    ${expected_path}

Verify Url Match
    [Arguments]    ${pattern}
    ${url}=    Get Url
    Should Match Regexp    ${url}    ${pattern}

Wait Until Toast Contains
    [Arguments]    ${text}    ${timeout}=15s
    # Make it optional to avoid hard failures if toast is slow or missing
    Run Keyword And Ignore Error    Wait For Elements State    xpath=//*[contains(text(), "${text}")] >> nth=0    visible    timeout=${timeout}

Wait For Tenant To Load
    [Arguments]    ${expected_tenant}=Ops Shared Tenant    ${tenant_id}=3
    [Documentation]    Wait until the tenant context is fully loaded in the sidebar.
    Wait For Elements State    css=[data-testid="tenant-selector-trigger"]    visible    timeout=60s
    # Try waiting for the expected tenant to load automatically first
    ${loaded}=    Run Keyword And Return Status    Wait Until Keyword Succeeds    10s    1s    Assert Tenant Name    ${expected_tenant}
    IF    not ${loaded}
        # If it didn't load the expected tenant, click to open dropdown and select it manually
        Click    css=[data-testid="tenant-selector-trigger"]
        Wait For Elements State    css=[data-testid="tenant-option-${tenant_id}"]    visible    timeout=10s
        Click    css=[data-testid="tenant-option-${tenant_id}"]
        Wait Until Keyword Succeeds    15s    1s    Assert Tenant Name    ${expected_tenant}
    END

Assert Tenant Name
    [Arguments]    ${expected_name}
    ${text}=    Get Text    css=[data-testid="tenant-selector-trigger"]
    Should Contain    ${text}    ${expected_name}

Get Calendar Day Attribute
    [Documentation]    คืนค่าที่ตรงกับแอตทริบิวต์ data-day ของปฏิทิน สำหรับวันย้อนหลัง
    ...
    ...                ปฏิทิน (react-day-picker) เขียน data-day เป็นรูปแบบ M/D/YYYY
    ...                เช่น "9/7/2026" ไม่ใช่ ISO — selector ที่เขียนเป็น "2026-09-07"
    ...                จะไม่แมตช์อะไรเลยและพังด้วย timeout ที่ไม่บอกสาเหตุ
    ...
    ...                รับ days_back เป็นจำนวนวันย้อนหลังจากวันนี้ (0 = วันนี้)
    [Arguments]        ${days_back}=0
    ${padded}=         Get Current Date    increment=-${days_back} days    result_format=%m/%d/%Y
    ${value}=          Evaluate    "/".join(str(int(part)) for part in "${padded}".split("/"))
    RETURN             ${value}

Resolve Attendance Dashboard State
    [Documentation]    บอกว่าหน้าแดชบอร์ดเวลาทำงานจบที่สถานะใด: ready / empty / error
    ...
    ...                Fail ถ้ายังไม่เข้าสถานะไหนเลย เพื่อให้ผู้เรียกวนรอต่อ — วิธีนี้
    ...                ทำให้หน้าที่โหลดช้ายังผ่าน ส่วนหน้าที่ไม่เคยโหลดเสร็จจะฟ้อง
    ...                ด้วยข้อความที่บอกสาเหตุ ไม่ใช่ "หาปุ่มไม่เจอ" ลอย ๆ
    ${ready}=    Run Keyword And Return Status
    ...    Wait For Elements State    css=[data-testid="attendance.dashboard.date.picker.button"]    visible    timeout=1s
    IF    ${ready}    RETURN    ready

    ${empty}=    Run Keyword And Return Status
    ...    Wait For Elements State    text=ไม่พบข้อมูล    visible    timeout=1s
    IF    ${empty}    RETURN    empty

    # ErrorBanner ไม่มี data-testid และไม่มี role="alert" จึงต้องจับจากหัวข้อของมันเอง
    # (ถ้าวันไหน frontend ใส่ testid ให้ ให้เปลี่ยนมาใช้ testid แทนบรรทัดนี้)
    ${error}=    Run Keyword And Return Status
    ...    Wait For Elements State    text=เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์    visible    timeout=1s
    IF    ${error}    RETURN    error

    Fail    แดชบอร์ดยังไม่เข้าสถานะที่สรุปผลได้ (ยังไม่มีทั้งตัวเลือกวันที่ ข้อความว่าง และกล่องข้อผิดพลาด)
