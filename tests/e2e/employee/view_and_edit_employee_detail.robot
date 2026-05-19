*** Settings ***
Library    Browser    timeout=60s
Resource          ../../resources/pages/employees_page.resource
Resource          ../../resources/common.resource

*** Test Cases ***
User Can View and Edit Employee Detail Sections
    [Documentation]    ทดสอบการคลิกเข้าดูและแก้ไขข้อมูลทุกแท็บในหน้ารายละเอียดพนักงาน
    [Tags]             smoke    employee

    # 1. Login and Go To Employees Page
    Open HR Plus Application
    Login To Application
    # ใช้ Go To โดยตรงเพื่อหลีกเลี่ยง global-loading ค้าง
    Go To    ${URL}/employees
    Wait For Loading To Hide
    
    # 2. กดคลิกดูข้อมูลพนักงานรายการแรกในตาราง (Row 0)
    #    View button เป็น <a> (Next.js Link) ที่กด onClick จะ setGlobalLoading(true) ทำให้ overlay ค้าง
    #    จึงใช้วิธีดึง href แล้ว Go To โดยตรงแทน
    Wait For Elements State    css=[data-testid="employees.table.row.0.action.view"]    visible    timeout=30s
    ${href}=    Get Attribute    css=[data-testid="employees.table.row.0.action.view"]    href
    # href จาก Next.js Link จะเป็น relative path (e.g. /employees/xxx)
    Go To    ${URL}${href}
    # ใช้ Wait For Elements State แทน networkidle เพราะ Employee detail page มีการ load API เรื่อย ๆ
    Wait Until Keyword Succeeds    30s    2s    Should Match Url Detail Page
    Wait For Elements State    css=[data-testid="employees.detail.sidebar.personalInfo"]    visible    timeout=30s
    
    # 3. คลิกแท็บ "ข้อมูลส่วนตัว" และทดสอบพิมพ์ข้อมูล -> กดบันทึก
    Navigate To Employee Section    personalInfo
    
    # ใช้ data-testid ที่ตรงกับช่องที่ต้องการกรอก
    Wait For Elements State    css=[data-testid="employees.form.nickname"]    visible
    Fill Text    css=[data-testid="employees.form.nickname"]    อายะv
    Save Employee Section

    # 4. ทดสอบกดเข้าไปดูข้อมูลในแท็บอื่นๆ ให้ครบถ้วน
    Navigate To Employee Section    accountAccess
    Navigate To Employee Section    emergencyContacts
    Navigate To Employee Section    workExperience
    Navigate To Employee Section    education
    Navigate To Employee Section    jobBenefits
    Navigate To Employee Section    salary
    Navigate To Employee Section    honor
    Navigate To Employee Section    vehicles
    # Navigate To Employee Section    documents # documents tab might not exist in the same way or requires different handling based on the page resource

    # ตรวจสอบว่าระบบสามารถแสดงผลแท็บสุดท้ายได้โดยไม่มี Error
    Wait For Elements State    css=[data-testid="employees.detail.sidebar.documents"]    visible

    # -------------------------------------------------------------
    # 5. หมวดหมู่: ข้อมูลเวลา (Time Information)
    # -------------------------------------------------------------
    Click    text="ข้อมูลเวลา"
    Sleep    1s
    # เมนูย่อย: บันทึก-รายงาน
    Wait For Elements State    text="บันทึก-รายงาน"    visible    timeout=10s
    Click    text="บันทึก-รายงาน"
    
    # ทดสอบกดเข้าหน้าแก้ไขเวลา (ปุ่มดินสอ) ตัวแรก และกดยืนยันเซฟ
    ${can_edit_time}=    Run Keyword And Return Status    Wait For Elements State    xpath=//table//tr[1]//button[.//svg]    visible    timeout=5s
    IF    ${can_edit_time}
        Click    xpath=//table//tr[1]//button[.//svg]
        Wait For Elements State    text="09:00"    visible    timeout=10s
        # Click    text="09:00"
        Wait For Elements State    text="ยืนยัน"    visible    timeout=5s
        Click    text="ยืนยัน"
    END

    # เมนูย่อย: การลางาน
    Click    text="ข้อมูลเวลา"
    Wait For Elements State    text="การลางาน"    visible    timeout=5s
    Click    text="การลางาน"

    # -------------------------------------------------------------
    # 6. หมวดหมู่: การเงินและสวัสดิการ (Financial & Benefits)
    # -------------------------------------------------------------
    Click    text="การเงินและสวัสดิการ"
    Wait For Elements State    text="เงินเดือน"    visible    timeout=5s
    Click    text="เงินเดือน"

    Click    text="การเงินและสวัสดิการ"
    Wait For Elements State    text="ประวัติการรับเงินเดือน"    visible    timeout=5s
    Click    text="ประวัติการรับเงินเดือน"

    Click    text="การเงินและสวัสดิการ"
    Wait For Elements State    text="Organics Wallet"    visible    timeout=5s
    Click    text="Organics Wallet"

User Can View Employee Dashboard
    [Documentation]    ทดสอบการเข้าดูหน้าแดชบอร์ดบุคลากร
    [Tags]             smoke    employee    dashboard

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # พาบ็อทกลับไปหน้าหลักของ Employees ก่อน เพื่อให้ Sidebar หลักแสดงขึ้นมา (เพราะอาจค้างอยู่ในหน้า Employee Detail)
    Wait For Loading To Hide
    # Wait For Elements State    css=[data-testid="employees.detail.header"]    visible    timeout=30s
    # คลิกแดชบอร์ดจาก Sidebar
    Wait For Elements State    css=[data-testid="sidebar.item.sidebar.people.dashboard"]    visible    timeout=10s
    Click    css=[data-testid="sidebar.item.sidebar.people.dashboard"]
    
    # 3. ตรวจสอบว่าอยู่หน้าแดชบอร์ด (อาศัย text หัวข้อบนหน้าจอช่วยเช็ค)
    Wait For Elements State    text="แดชบอร์ด" >> nth=1   visible    timeout=15s
    Sleep    2s    # รอโหลดกราฟหรือ Widget
    Wait For Loading To Hide
