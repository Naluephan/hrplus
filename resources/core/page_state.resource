*** Settings ***
Documentation    รอสถานะของหน้าตามสัญญาใน docs/TESTING_STANDARDS.md
...
...              ทุกหน้าที่ดึงข้อมูลต้องประกาศสถานะสามอย่าง —
...              `<page>.page.loading`, `<page>.page.ready`, `<page>.page.error` —
...              คีย์เวิร์ดในไฟล์นี้รอสถานะเหล่านั้นเท่านั้น ไม่มี `Sleep` แม้แต่ที่เดียว
...              เพราะการรอตามเวลาคือที่มาของเทสที่พังแบบสุ่ม

Library    Browser


*** Variables ***
${PAGE_READY_TIMEOUT}       30s
${ACTION_TIMEOUT}           15s


*** Keywords ***
Wait For Page Ready
    [Documentation]    รอจน `<page>.page.ready` ปรากฏ และ `<page>.page.loading` หายไป
    ...                ถ้าหน้าขึ้นสถานะ error จะฟ้องทันทีพร้อมข้อความบนหน้าจอ แทนที่จะรอจนหมดเวลา
    [Arguments]    ${page}    ${timeout}=${PAGE_READY_TIMEOUT}

    ${failed}=    Run Keyword And Return Status
    ...    Wait For Elements State    css=[data-testid="${page}.page.error"]    visible    timeout=1s
    IF    ${failed}    Fail Page With Error State    ${page}

    Wait For Elements State    css=[data-testid="${page}.page.ready"]      visible    timeout=${timeout}
    Wait For Elements State    css=[data-testid="${page}.page.loading"]    hidden     timeout=${timeout}

Fail Page With Error State
    [Documentation]    รายงานข้อความ error ที่หน้าจอแสดงจริง เพื่อให้ผลเทสบอกสาเหตุได้ทันที
    [Arguments]    ${page}
    ${message}=    Get Text    css=[data-testid="${page}.page.error"]
    Fail    หน้า "${page}" อยู่ในสถานะ error: ${message}

Wait For Table Ready
    [Documentation]    รอให้ตารางโหลดเสร็จ — ใช้หลังค้นหา กรอง หรือเปลี่ยนหน้า
    [Arguments]    ${page}    ${timeout}=${PAGE_READY_TIMEOUT}
    Wait For Elements State    css=[data-testid="${page}.table.loading"]    hidden     timeout=${timeout}
    Wait For Elements State    css=[data-testid="${page}.table"]            visible    timeout=${timeout}

Wait For Save To Finish
    [Documentation]    รอจนตัวบ่งชี้ `modal.<type>.saving` หายไป แล้วยืนยันว่าโมดัลปิด
    ...                (ตามสัญญา: สำเร็จ = โมดัลปิด + toast success)
    [Arguments]    ${page}    ${type}=create    ${timeout}=${ACTION_TIMEOUT}
    Wait For Elements State    css=[data-testid="${page}.modal.${type}.saving"]    hidden      timeout=${timeout}
    Wait For Elements State    css=[data-testid="${page}.modal.${type}"]           detached    timeout=${timeout}

Wait For Success Toast
    [Documentation]    ยืนยันว่าระบบตอบกลับว่าสำเร็จจริง ไม่ใช่แค่โมดัลปิดไปเฉย ๆ
    [Arguments]    ${page}    ${timeout}=${ACTION_TIMEOUT}
    Wait For Elements State    css=[data-testid="${page}.toast.success"]    visible    timeout=${timeout}

Wait For Error Toast
    [Documentation]    ใช้ในเคสด้านลบ — ระบบต้องบอกผู้ใช้ว่าทำไมถึงไม่สำเร็จ
    [Arguments]    ${page}    ${timeout}=${ACTION_TIMEOUT}
    Wait For Elements State    css=[data-testid="${page}.toast.error"]    visible    timeout=${timeout}
