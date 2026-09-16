*** Settings ***
Documentation    เปิดเบราว์เซอร์ครั้งเดียวต่อสวีท แต่ให้ทุกเคสได้หน้าใหม่ที่สะอาด
...
...              เดิมทุกเคสเปิดเบราว์เซอร์ใหม่ + ล็อกอิน + ปิดทิ้ง (85 ครั้งต่อ 89 เคส)
...              การเปิด process เบราว์เซอร์คือส่วนที่แพง ส่วน context ของ Playwright ถูกมาก
...
...              แบบใหม่:
...                Suite Setup   → เปิดเบราว์เซอร์หนึ่งครั้ง และทำให้มีไฟล์เซสชันที่ใช้ได้
...                Test Setup    → context ใหม่ที่โหลดเซสชันเดิม: ไม่มี modal/สถานะค้างจากเคสก่อน
...                                และไม่ต้องกรอกล็อกอินใหม่
...                Test Teardown → บันทึกเซสชันกลับลงไฟล์ แล้วปิด context ของเคสนั้น
...                Suite Teardown→ ปิดเบราว์เซอร์
...
...              ห้ามแชร์ "หน้า" เดียวกันข้ามเคส: หลายเคสเปิด modal แล้วจบโดยไม่ปิด
...              modal ที่ค้างจะบังการคลิกของเคสถัดไป
...
...              อายุเซสชัน: Central ออก access token และ refresh token อายุ 1 ชั่วโมง
...              และหมุน (blacklist) refresh token ทุกครั้งที่หน้าเว็บ refresh เงียบ ๆ
...              ถ้าไม่บันทึก token ที่หมุนแล้วกลับลงไฟล์ เคสถัดไปจะโหลด token ที่ถูก
...              ยกเลิกไปแล้ว และถ้าเริ่มเคสใกล้ครบชั่วโมง จะถูกเด้งไป /login กลางเคส
...              สองข้อนี้คือเหตุผลของ Close Test Page และการเช็คอายุใน Open Fresh Page
Library    Browser    timeout=60s
Library    OperatingSystem
Library    session_lifetime.py
Resource   browser.resource
Resource   common.resource


*** Variables ***
# ถ้าเซสชันเหลืออายุน้อยกว่านี้ ให้ล็อกอินใหม่ก่อนเริ่มเคส แทนที่จะเสี่ยงหมดอายุกลางเคส
# เผื่อไว้มากกว่าเคสที่ยาวที่สุดในชุดเทสปัจจุบัน (ราว 7 นาที)
${MIN_SESSION_MINUTES}    10


*** Keywords ***
Open Browser For Suite
    [Documentation]    เปิดเบราว์เซอร์ครั้งเดียว แล้วตรวจให้แน่ใจว่าไฟล์เซสชันล็อกอินใช้ได้
    New Browser    browser=${BROWSER}    headless=${HEADLESS}
    Open Fresh Page
    Login To Application
    Close Test Page

Open Fresh Page
    [Documentation]    context ใหม่สำหรับเคสนี้ โหลดเซสชันที่บันทึกไว้ถ้ายังมีอายุพอ
    ...
    ...                ถ้าไฟล์ไม่มี เสีย หรือเหลืออายุน้อยกว่า ${MIN_SESSION_MINUTES} นาที
    ...                จะเปิด context เปล่า เพื่อให้ Login To Application ล็อกอินจริงและได้เซสชันใหม่เต็มชั่วโมง
    ${session_file}=    Resolve Session File
    ${minutes_left}=    Session Minutes Left    ${session_file}
    IF    ${minutes_left} >= ${MIN_SESSION_MINUTES}
        New Context    viewport={'width': 1280, 'height': 720}    storageState=${session_file}
    ELSE
        Log    เซสชันเหลือ ${minutes_left} นาที (ต่ำกว่า ${MIN_SESSION_MINUTES}) — เริ่มใหม่เพื่อล็อกอินใหม่
        New Context    viewport={'width': 1280, 'height': 720}
    END
    Set Browser Timeout    120s
    New Page    ${URL}

Open Fresh Logged In Page
    [Documentation]    context ใหม่ที่ล็อกอินอยู่แล้ว — ล็อกอินจริงเฉพาะเมื่อจำเป็น
    ...
    ...                ถ้าไฟล์เซสชันยังมีอายุพอ context จะโหลดเซสชันนั้นมาและพร้อมใช้ทันที
    ...                ไม่ต้องแวะ /login เพื่อตรวจ — การแวะนั้นต้องรอ redirect กลับ ซึ่งบน next dev
    ...                ใช้ 10–20 วินาทีต่อครั้ง และเคยกินเวลาไป 31 นาทีในสวีท settings สวีทเดียว
    ...                ล็อกอินจริงเฉพาะเมื่อไฟล์หาย เสีย หรือใกล้หมดอายุ (Open Fresh Page เปิด context เปล่าไว้ให้)
    ${session_file}=    Resolve Session File
    ${minutes_left}=    Session Minutes Left    ${session_file}
    Open Fresh Page
    IF    ${minutes_left} < ${MIN_SESSION_MINUTES}
        Login To Application
    END

Close Test Page
    [Documentation]    บันทึกเซสชันกลับลงไฟล์ (ถ้ายังล็อกอินอยู่) แล้วปิดเฉพาะ context ของเคสนี้
    ...
    ...                หน้าเว็บอาจ refresh token ระหว่างเคส ซึ่ง Central จะยกเลิก refresh token เดิม
    ...                การบันทึกตรงนี้ส่ง token ใบใหม่ต่อให้เคสถัดไป
    ...                ไม่บันทึกถ้าหน้าอยู่ที่ /login — จะเขียนทับเซสชันดีด้วยสถานะที่ออกจากระบบแล้ว
    ${has_url}    ${url}=    Run Keyword And Ignore Error    Get Url
    IF    "${has_url}" == "PASS" and "/login" not in """${url}"""
        Run Keyword And Ignore Error    Save Current Session
    END
    Close Context
