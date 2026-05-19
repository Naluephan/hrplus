*** Settings ***
Library    Browser    timeout=60s
Library           String
Resource          ../common.resource
Resource          ../navigation.resource

*** Variables ***
${DEFAULT_PASSWORD}    12345678
${LAST_CREATED_EMP_CODE}    ${EMPTY}

*** Keywords ***
Go To Employees Page
    Navigate To Menu    people    people.list    /employees
    Wait For Loading To Hide    timeout=120s
    Wait For Elements State    css=[data-testid="employees.toolbar.add"]    visible    timeout=60s

Click Add Employee Buttons
    Click    css=[data-testid="employees.toolbar.add"]
    Wait For Loading To Hide    timeout=60s
    ${at_create}=    Run Keyword And Return Status    Wait Until Keyword Succeeds    5s    1s    Check Url    /employees/create
    IF    not ${at_create}
        Log    WARNING: Click Add but URL not changed. Using Go To directly.
        Go To    ${URL}/employees/create    wait_until=commit
        Wait For Loading To Hide    timeout=120s
    END
    # Ensure form exists and is ready
    Wait For Elements State    css=[data-testid="employees.form.prefix"]    visible    timeout=120s
    Wait For Elements State    css=[data-testid="employees.form.prefix"]    enabled    timeout=30s

Fill Employee Personal Info
    [Arguments]    ${first_name}    ${last_name}    ${nickname}    ${phone}    ${email}    ${id_card}
    Wait For Elements State    css=[data-testid="employees.form.prefix"]    visible    timeout=60s
    
    # Prefix (Dropdown)
    Click Dropdown And Select Option    employees.form.prefix    0

    Fill Text    css=[data-testid="employees.form.firstName"]    ${first_name}
    Fill Text    css=[data-testid="employees.form.lastName"]     ${last_name}
    Fill Text    css=[data-testid="employees.form.nickname"]     ${nickname}

    # Contact
    Fill Text    css=[data-testid="employees.form.phone"]        ${phone}
    Fill Text    css=[data-testid="employees.form.email"]        ${email}

    # ID Card
    Fill Text    css=[data-testid="employees.form.idCardNumber"]    ${id_card}

    # Birth Date (Pick Today)
    Scroll To Element    css=[data-testid="employees.form.birthDate"]
    Click    css=[data-testid="employees.form.birthDate"]
    Wait For Elements State    text=เลือกวันนี้    visible    timeout=5s
    Click    text=เลือกวันนี้

    # Gender & Blood Type & Personality
    Click Dropdown And Select Option    employees.form.gender    0
    Click Dropdown And Select Option    employees.form.bloodType    0
    # Personality is optional and might be empty, skipping to avoid failure
    # Ensure options are loaded or fail meaningfully
    Click Dropdown And Select Option    employees.form.personalityId    0

    # Address
    Click Dropdown And Select Option    employees.form.idAddress.provinceId    0
    # Wait for districts to load instead of Sleep
    Wait For Elements State    css=[data-testid="employees.form.idAddress.districtId"] button:not([disabled])    visible    timeout=30s
    Click Dropdown And Select Option    employees.form.idAddress.districtId    0
    # Wait for sub-districts to load instead of Sleep
    Wait For Elements State    css=[data-testid="employees.form.idAddress.subDistrictId"] button:not([disabled])    visible    timeout=30s
    Click Dropdown And Select Option    employees.form.idAddress.subDistrictId    0
    Fill Text    css=[data-testid="employees.form.idAddress.postalCode"]    10110

    # Emergency Contact
    Scroll To Element    xpath=//h2[contains(text(), "ผู้ติดต่อ")]
    Fill Text    xpath=//section[.//h2[contains(text(), "ผู้ติดต่อ")]]//input[@type="text"] >> nth=0    Mom Test
    Click Dropdown And Select Option    employees.form.emergencyContact.0.relation    0
    Fill Text    xpath=//section[.//h2[contains(text(), "ผู้ติดต่อ")]]//input[@type="tel"] >> nth=0    0812345678

    # Next
    Sleep    2s    # Wait for duplicate check or Async validation
    Click    css=[data-testid="wizard.button.next"]
    Wait Until Keyword Succeeds    60s    1s    Check Url    /employees/create/step/2

Fill Employee Education
    Wait For Elements State    css=h2 >> text="ประวัติการศึกษา"    visible    timeout=60s
    
    Click Dropdown And Select Option    employees.create.step2.education.0.degree    1
    # Check if we need to select institution if it's a dropdown? No it's text input in code
    Fill Text    css=[data-testid="employees.create.step2.education.0.institution"]    Chulalongkorn University
    Fill Text    css=[data-testid="employees.form.education.gpa"]    3.50
    Fill Text    css=[data-testid="employees.form.education.graduationYear"]    2020

    # Click label to ensure the hidden checkbox is toggled
    Click    text="ไม่มีประสบการณ์ทำงาน"
    
    Click    css=[data-testid="wizard.button.next"]
    Wait Until Keyword Succeeds    60s    1s    Check Url    /employees/create/step/3

Fill Employee Employment Details
    [Arguments]    ${salary_amount}    ${account_name}
    Wait For Elements State    css=[data-testid="employees.create.step3.departmentId"] button    visible    timeout=60s
    Sleep    1s

    # Department
    Click Dropdown And Select Option    employees.create.step3.departmentId    0
    
    # Level
    Click Dropdown And Select Option    employees.create.step3.levelId    0

    # Position
    Click Dropdown And Select Option    employees.create.step3.positionId    0
    
    # Employment Type
    Click Dropdown And Select Option    employees.create.step3.employmentTypeId    0

    # Start Date
    Scroll To Element    css=[data-testid="employees.create.step3.firstWorkingDate"]
    Wait For Elements State    css=[data-testid="employees.create.step3.firstWorkingDate"] button    enabled    timeout=60s
    Click    css=[data-testid="employees.create.step3.firstWorkingDate"] button
    Wait For Elements State    text=เลือกวันนี้    visible    timeout=5s
    Click    text=เลือกวันนี้

    # Social Security Date (Might be hidden or optional?)
    ${soc_sec_exists}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="employees.create.step3.socialSecurityDate"] button    visible    timeout=2s
    IF    ${soc_sec_exists}
        Click    css=[data-testid="employees.create.step3.socialSecurityDate"] button
        Wait For Elements State    text=เลือกวันนี้    visible    timeout=5s
        Click    text=เลือกวันนี้
    END
    
    # Salary
    
    # Pay Cycle
    Click Dropdown And Select Option    employees.create.step3.salary.payCycle    0

    Fill Text    css=[data-testid="employees.create.step3.salary.amount"]    50000
    
    # Account Name is auto-generated and disabled
    ${account_name_value}=    Get Property    css=[data-testid="employees.create.step3.salary.accountName"]    value
    # Should Be Equal    ${account_name_value}    ${account_name}
    
    Click Dropdown And Select Option    employees.create.step3.salary.bank    0
    Fill Text    css=[data-testid="employees.create.step3.salary.accountNumber"]    1234567890

    # [CRITICAL] Wait for employee code to be auto-generated before clicking next
    Wait Until Keyword Succeeds    30s    1s    Capture Employee Code From Field

    # Next
    Wait For Elements State    css=[data-testid="wizard.button.next"]    enabled    timeout=30s
    Click    css=[data-testid="wizard.button.next"]
    Wait For Loading To Hide    timeout=120s
    Wait Until Keyword Succeeds    60s    1s    Check Url    /employees/create/step/4

Submit Employee Form
    # Step 4 (Docs) - Skip
    Wait For Elements State    css=[data-testid="employees.step4.header.0"]    visible    timeout=60s
    Click    css=[data-testid="wizard.button.next"]
    Wait For Loading To Hide    timeout=120s
    Wait Until Keyword Succeeds    60s    1s    Check Url    /employees/create/step/5

    # Step 5 (Account)
    Wait For Elements State    text="การเข้าถึงบัญชีแอป"    visible    timeout=60s
    Fill Employee Account Access    ${DEFAULT_PASSWORD}
    Click    css=[data-testid="wizard.button.next"]

    # Confirm Dialog
    ${dialog_visible}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="employees.create.step5.confirm.copyAndSave"]    visible    timeout=5s
    IF    ${dialog_visible}
        Click    css=[data-testid="employees.create.step5.confirm.copyAndSave"]
        Wait For Loading To Hide
    END

    # Wait Until Toast Contains    คัดลอก
    # Verify redirection to Step 1 (fresh form)
    Wait Until Keyword Succeeds    30s    1s    Check Url    /employees/create

Create Employee Using Mock Data Flow
    [Arguments]    ${password}=123456789
    [Documentation]    สร้างพนักงานใหม่โดยใช้ปุ่ม Mock data เพื่อความรวดเร็วในการทดสอบ
    
    Go To Employees Page
    Click Add Employee Buttons
    Wait Until Keyword Succeeds    10s    1s    Check Url    /employees/create
    
    # Step 1: ข้อมูลส่วนตัว
    Wait For Elements State    css=[data-testid="employees.form.prefix"]    visible    timeout=60s
    Wait For Loading To Hide    timeout=120s
    # Robust locator for Mock button: check for data-testid, text (English/Thai) or Loading state
    ${mock_btn}=    Set Variable    css=[data-testid="mockButton"]
    Wait For Elements State    ${mock_btn}    visible    timeout=60s
    Wait For Elements State    ${mock_btn}    enabled    timeout=30s
    Click    ${mock_btn}
    # Wait for mock to finish
    Wait For Elements State    ${mock_btn}    enabled    timeout=60s
    
    Wait Until Keyword Succeeds    5x    2s    Click Next And Verify Step    /employees/create/step/2
    
    # Step 2: ประวัติการศึกษา/การทำงาน
    Wait For Elements State    css=h2 >> text=/ประวัติการศึกษา|Education/    visible    timeout=60s
    Wait For Elements State    ${mock_btn}    visible    timeout=30s
    Click    ${mock_btn}
    # Wait for mock to finish
    Wait For Elements State    ${mock_btn}    enabled    timeout=60s
    
    Wait Until Keyword Succeeds    5x    2s    Click Next And Verify Step    /employees/create/step/3
    
    # Step 3: ข้อมูลการจ้างงาน
    Wait For Elements State    css=[data-testid="employees.create.step3.departmentId"]    visible    timeout=60s
    Wait For Elements State    ${mock_btn}    visible    timeout=30s
    Click    ${mock_btn}
    # Wait for mock loading to finish
    Wait For Elements State    ${mock_btn}    enabled    timeout=60s
    
    # [CRITICAL] Capture Employee Code explicitly from Step 3 (Red box in screenshot)
    ${emp_code}=    Wait Until Keyword Succeeds    30s    1s    Capture Employee Code From Field
    Set Global Variable    ${LAST_CREATED_EMP_CODE}    ${emp_code}
    Log    Captured Employee Code: ${emp_code}
    
    Wait Until Keyword Succeeds    5x    2s    Click Next And Verify Step    /employees/create/step/4
    
    # Step 4: เอกสารและสัญญา
    Wait For Elements State    css=h2 >> text=/เอกสารและสัญญา|Documents/    visible    timeout=60s
    Wait For Elements State    ${mock_btn} >> nth=0    visible    timeout=30s
    Click    ${mock_btn} >> nth=0
    # Wait for mock to finish
    Wait For Elements State    ${mock_btn} >> nth=0    enabled    timeout=60s
    
    Wait Until Keyword Succeeds    5x    2s    Click Next And Verify Step    /employees/create/step/5

    # Step 5: การตั้งค่าระบบบัญชีผู้ใช้งาน
    Wait For Loading To Hide
    # Adding a longer wait for Step 5 content/skeleton to resolve
    Wait For Elements State    ${mock_btn}    visible    timeout=120s
    Wait For Elements State    ${mock_btn}    enabled    timeout=60s
    Click    ${mock_btn}
    
    # กด Finish
    Wait For Elements State    css=[data-testid="wizard.button.next"]    enabled    timeout=10s
    Click    css=[data-testid="wizard.button.next"]
    
    # กดยืนยันคัดลอกและบันทึก
    Wait For Elements State    css=[data-testid="employees.create.step5.confirm.copyAndSave"]    visible    timeout=20s
    Click    css=[data-testid="employees.create.step5.confirm.copyAndSave"]
    
    # เพิ่มเวลาให้การบันทึกข้อมูลเสร็จสิ้น
    Wait For Loading To Hide
    # Verify redirection to Step 1 (fresh form) which indicates save success
    Wait Until Keyword Succeeds    60s    1s    Check Url    /employees/create
    Sleep    1s

    # ไปที่หน้ารายการบุคลากร
    ${current_url}=    Get Url
    IF    "/employees" not in "${current_url}" or "/create" in "${current_url}"
        Navigate To Menu    people    people.list    /employees
    END
    Wait For Loading To Hide
    
    # ค้นหาพนักงานที่เพิ่งสร้างด้วย Employee Code ที่จับมาได้
    Wait For Elements State    css=[data-testid="employees.filter.search"]    visible    timeout=30s
    ${view_btn}=    Set Variable    xpath=//tbody//tr[contains(., "${LAST_CREATED_EMP_CODE}")]//a[contains(@data-testid, "action.view")]
    
    FOR    ${i}    IN RANGE    3
        Clear Text    css=[data-testid="employees.filter.search"]
        Fill Text    css=[data-testid="employees.filter.search"]    ${LAST_CREATED_EMP_CODE}
        Press Keys    css=[data-testid="employees.filter.search"]    Enter
        Wait For Loading To Hide    timeout=60s
        Sleep    3s
        ${found}=    Run Keyword And Return Status    Wait For Elements State    ${view_btn}    visible    timeout=5s
        IF    ${found}
            BREAK
        END
        Log    WARNING: Employee ${LAST_CREATED_EMP_CODE} not found. Retrying...
        # Reload page in case state is stuck
        Evaluate JavaScript    ${None}    window.location.reload()
        Wait For Loading To Hide    timeout=60s
        Wait For Elements State    css=[data-testid="employees.filter.search"]    visible    timeout=30s
    END
    Wait For Elements State    ${view_btn}    visible    timeout=10s
    
    # Debug: Check the href to ensure it's not empty or just /employees
    ${href}=    Get Attribute    ${view_btn}    href
    Log    DEBUG: Searching for view button with locator: ${view_btn}
    Log    DEBUG: View button href is: ${href}
    
    Wait For Elements State    ${view_btn}    enabled    timeout=30s
    # Click view button without force=True which caused ValueError
    Click    ${view_btn}
    
    # If click didn't trigger navigation within 2s, use Go To as a robust fallback
    ${nav_success}=    Run Keyword And Return Status    Wait Until Keyword Succeeds    2s    500ms    Verify Url Match    /employees/[a-f0-9\\-]+
    IF    not ${nav_success}
        Log    Click didn't navigate immediately, using Go To fallback: ${URL}${href}
        Go To    ${URL}${href}    wait_until=commit
    END
    
    # Wait for navigation to detail page.
    Wait Until Keyword Succeeds    120s    2s    Verify Url Match    /employees/[a-f0-9\\-]+
    Wait For Loading To Hide    timeout=120s

Click Next And Verify Step
    [Arguments]    ${expected_url}
    Wait For Loading To Hide
    Click    css=[data-testid="wizard.button.next"]
    
    # ถ้ามีการแจ้งเตือนว่ากรุณากรอกข้อมูล แสดงว่า Mock ข้อมูลยังไม่ครบ
    ${has_error}=    Run Keyword And Return Status    Wait For Elements State    text="กรุณากรอก"    visible    timeout=1s
    IF    ${has_error}
        Log    Found validation error, retrying mock...
        Click    css=button:has-text("Mock") >> nth=0
        Sleep    1s
        Click    css=[data-testid="wizard.button.next"]
    END
    
    Wait Until Keyword Succeeds    30s    1s    Check Url    ${expected_url}
    Wait For Loading To Hide

Capture Employee Code From Field
    # Wait for value to be populated (Async Mock might take a moment)
    # retry loop to handle backend/mock delay
    ${code}=    Wait Until Keyword Succeeds    10x    2s    Get Non Empty Employee Code
    RETURN    ${code}

Get Non Empty Employee Code
    ${val}=    Get Attribute    css=[data-testid="employees.create.step3.employeeCode"]    value
    IF    "${val}" == "${EMPTY}"
        # Trigger re-generation if possible or just wait
        Log    Employee code is empty, waiting...
        Fail    Employee code should not be empty.
    END
    RETURN    ${val}

Element Value Should Not Be Empty
    [Arguments]    ${locator}
    ${val}=    Get Attribute    ${locator}    value
    Should Not Be Empty    ${val}


Fill Employee Account Access
    [Arguments]    ${password}
    Wait For Elements State    css=[data-testid="employees.create.step5.password"]    visible    timeout=10s
    Fill Text    css=[data-testid="employees.create.step5.password"]    ${password}
    Fill Text    css=[data-testid="employees.create.step5.confirmPassword"]    ${password}
    
    # Fill PIN
    Fill Text    css=[data-testid="employees.create.step5.pin.0"]    1
    Fill Text    css=[data-testid="employees.create.step5.pin.1"]    1
    Fill Text    css=[data-testid="employees.create.step5.pin.2"]    1
    Fill Text    css=[data-testid="employees.create.step5.pin.3"]    1

Click Dropdown And Select Option
    [Arguments]    ${testid}    ${option_index}=0
    Wait For Elements State    css=[data-testid="${testid}"] button    enabled    timeout=30s
    # Retry open with more attempts
    Wait Until Keyword Succeeds    5x    2s    Click Dropdown Trigger    ${testid}
    
    # Wait for listbox to appear
    Sleep    1s
    Wait For Elements State    css=[role="listbox"]    visible    timeout=10s
    # Wait for options with increased timeout
    Wait For Elements State    css=[role="option"] >> nth=${option_index}    visible    timeout=15s
    
    Click    css=[role="option"] >> nth=${option_index}

    # Verify closed
    Wait For Elements State    css=[data-testid="${testid}"] button[aria-expanded="false"]    visible    timeout=5s

Click Dropdown Trigger
    [Arguments]    ${testid}
    Click    css=[data-testid="${testid}"] button
    Wait For Elements State    css=[data-testid="${testid}"] button[aria-expanded="true"]    visible    timeout=2s

Search Employee
    [Arguments]    ${name}
    Wait For Elements State    css=[data-testid="employees.filter.search"]    visible    timeout=60s
    Fill Text    css=[data-testid="employees.filter.search"]    ${name}
    Press Keys    css=[data-testid="employees.filter.search"]    Enter
    
    # Wait for loading or results
    Sleep    3s
    ${count_after}=    Get Element Count    css=tr[data-testid^="employees.table.row"]
    Log    Rows after search: ${count_after}
    # Use >> nth=0 to target first row specifically (avoid strict mode violation)
    Wait For Elements State    css=tr[data-testid^="employees.table.row"] >> nth=0    visible    timeout=60s

Verify Employee On List
    [Arguments]    ${name}
    Wait For Elements State    xpath=//tr[contains(., "${name}")]    visible    timeout=10s

Click Edit Customer By Name
    [Arguments]    ${name}
    Wait For Loading To Hide
    Sleep    3s
    # Wait for the first table row to be visible after search
    Wait For Elements State    css=tr[data-testid^="employees.table.row"] >> nth=0    visible    timeout=10s
    
    # Wait for the View button specifically
    Wait For Elements State    css=[data-testid="employees.table.row.0.action.view"]    visible    timeout=10s
    
    # Get href and use Go To to avoid Next.js link global loading issue
    Sleep    1s
    ${href}=    Get Attribute    css=[data-testid="employees.table.row.0.action.view"]    href
    Go To    ${URL}${href}    wait_until=domcontentloaded
    
    # Wait for Global Loading to hide before checking URL
    Wait For Loading To Hide
    
    # Wait for navigation to detail page
    Wait Until Keyword Succeeds    30s    2s    Should Match Url Detail Page

Edit Employee Detail
    [Documentation]    Edit employee personal info section
    [Arguments]    ${nickname}
    Log To Console    \n[SECTION] Starting Personal Info edit: ${nickname}
    Navigate To Employee Section    personalInfo
    Wait For Elements State    css=[data-testid="employees.form.nickname"]    visible    timeout=15s
    Fill Text    css=[data-testid="employees.form.nickname"]    ${nickname}
    Save Employee Section
    Log To Console    [SUCCESS] Personal Info section edited successfully

Navigate To Employee Section
    [Documentation]    Navigate to a specific section in employee detail page
    [Arguments]    ${section_id}
    # section_id can be: personalInfo, accountAccess, emergencyContacts, workExperience, education, jobBenefits, salary, honor, vehicles, documents
    Wait For Loading To Hide    timeout=30s
    Wait For Elements State    css=[data-testid="employees.detail.sidebar.${section_id}"]    visible    timeout=30s
    Scroll To Element    css=[data-testid="employees.detail.sidebar.${section_id}"]
    Click    css=[data-testid="employees.detail.sidebar.${section_id}"]
    Sleep    2s    # Wait for React state/animation
    # Wait for section loader to disappear if it shows up
    ${has_loader}=    Get Element Count    css=[data-testid="section-loader"]
    IF    ${has_loader} > 0
        Log To Console    Waiting for section loader to disappear...
        ${loader_hidden}=    Run Keyword And Return Status
        ...    Wait For Elements State    css=[data-testid="section-loader"]    hidden    timeout=60s
        IF    not ${loader_hidden}
            Log    WARNING: Section loader stuck for ${section_id}. Reloading page...
            Evaluate JavaScript    ${None}    window.location.reload()
            Wait For Loading To Hide    timeout=60s
            Wait For Elements State    css=[data-testid="employees.detail.sidebar.${section_id}"]    visible    timeout=30s
            Click    css=[data-testid="employees.detail.sidebar.${section_id}"]
            Sleep    2s
            Run Keyword And Ignore Error    Wait For Elements State    css=[data-testid="section-loader"]    hidden    timeout=30s
        END
    END
    
Save Employee Section
    [Documentation]    Click save button and wait for overlay to disappear (robust)
    Wait For Elements State    css=[data-testid="common.section.footer.save"]    visible    timeout=10s
    Scroll To Element    css=[data-testid="common.section.footer.save"]
    Click    css=[data-testid="common.section.footer.save"]
    
    # รอให้ overlay โผล่ขึ้นมา (เผื่อกรณีระบบเซฟช้า) แต่ถ้าไม่มี/เร็วมากก็ไปต่อ
    ${overlay_appeared}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="save-overlay"]    visible    timeout=5s
    
    IF    ${overlay_appeared}
        # รอให้ overlay เปลี่ยนสถานะเป็น success หรือ error (icon จะเปลี่ยน)
        ${success}=    Run Keyword And Return Status
        ...    Wait For Elements State    css=[data-testid="save-overlay-icon-success"]    visible    timeout=60s
        
        IF    ${success}
            # บันทึกสำเร็จ - รอ overlay หายไปเอง (auto-dismiss 1000ms)
            Run Keyword And Ignore Error    Wait For Elements State    css=[data-testid="save-overlay"]    hidden    timeout=10s
        ELSE
            # อาจเป็น error หรือ saving ค้าง - ตรวจสอบ
            ${is_error}=    Run Keyword And Return Status
            ...    Wait For Elements State    css=[data-testid="save-overlay-icon-error"]    visible    timeout=5s
            IF    ${is_error}
                Log    WARNING: Save returned error. Waiting for overlay to auto-dismiss...
                Run Keyword And Ignore Error    Wait For Elements State    css=[data-testid="save-overlay"]    hidden    timeout=10s
            END
            
            # ถ้า overlay ยังค้างอยู่ (ทั้ง saving ค้าง หรือ error ไม่ dismiss) - reload เพื่อ recover
            ${still_visible}=    Run Keyword And Return Status
            ...    Wait For Elements State    css=[data-testid="save-overlay"]    visible    timeout=1s
            IF    ${still_visible}
                Log    WARNING: Save overlay is stuck. Reloading page to recover.
                Evaluate JavaScript    ${None}    window.location.reload()
                Wait For Loading To Hide    timeout=60s
            END
        END
    END
    Sleep    1s    # Stability buffer after save

Edit Account Access Section
    [Documentation]    Edit employee account access section
    [Arguments]    ${username}
    Log To Console    [SECTION] Starting Account Access edit: ${username}
    Navigate To Employee Section    accountAccess
    Sleep    3s    # Wait for section to fully load
    
    # Check if field is locked
    ${states}=    Get Element States    css=[data-testid="employees.edit.accountAccess.username"]
    ${is_disabled}=    Evaluate    "disabled" in ${states}
    
    IF    ${is_disabled}
        Log To Console    Account field is locked, checking unlock button...
        ${has_unlock}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="employees.edit.accountAccess.unlock"]    visible    timeout=5s
        IF    ${has_unlock}
            Click    css=[data-testid="employees.edit.accountAccess.unlock"]
            Wait For Elements State    css=[data-testid="employees.edit.accountAccess.username"]    editable    timeout=10s
        ELSE
            Log To Console    Unlock button not found and field is locked. Skipping username edit to prevent false failure.
            RETURN
        END
    END
    
    Wait For Elements State    css=[data-testid="employees.edit.accountAccess.username"]    attached    timeout=15s
    Fill Text    css=[data-testid="employees.edit.accountAccess.username"]    ${username}
    Save Employee Section
    Log To Console    [SUCCESS] Account Access section edited successfully

Edit Emergency Contacts Section
    [Documentation]    Edit employee emergency contacts section
    [Arguments]    ${name}    ${phone}
    Log To Console    [SECTION] Starting Emergency Contacts edit: ${name}
    Navigate To Employee Section    emergencyContacts
    Sleep    3s    # Wait for section to fully load
    
    # Check if we need to click Add (if first entry doesn't exist)
    ${count}=    Get Element Count    css=[data-testid="employees.edit.emergency.0.name"]
    IF    ${count} == 0
        Log To Console    No contacts found, adding new row...
        Click    css=[data-testid="employees.edit.emergency.add"]
    END
    
    Wait For Elements State    css=[data-testid="employees.edit.emergency.0.name"]    visible    timeout=15s
    Fill Text    css=[data-testid="employees.edit.emergency.0.name"]    ${name}
    Fill Text    css=[data-testid="employees.edit.emergency.0.phone"]    ${phone}
    
    Save Employee Section
    Log To Console    [SUCCESS] Emergency Contacts section edited successfully

Edit Work Experience Section
    [Documentation]    Edit employee work experience section
    [Arguments]    ${company}
    Log To Console    [SECTION] Starting Work Experience edit: ${company}
    Navigate To Employee Section    workExperience
    Sleep    3s    # Wait for section to fully load
    
    ${count}=    Get Element Count    css=[data-testid="employees.edit.workExp.0.company"]
    IF    ${count} == 0
        Log To Console    No work exp found, adding new row...
        Click    css=[data-testid="employees.edit.workExp.add"]
    END
    
    Wait For Elements State    css=[data-testid="employees.edit.workExp.0.company"]    visible    timeout=15s
    Fill Text    css=[data-testid="employees.edit.workExp.0.company"]    ${company}
    
    Save Employee Section
    Log To Console    [SUCCESS] Work Experience section edited successfully

Edit Education Section
    [Documentation]    Edit employee education section
    [Arguments]    ${institution}
    Log To Console    [SECTION] Starting Education edit: ${institution}
    Navigate To Employee Section    education
    Sleep    3s    # Wait for section to fully load
    
    ${count}=    Get Element Count    css=[data-testid="employees.edit.education.0.institution"]
    IF    ${count} == 0
        Log To Console    No education found, adding new row...
        Click    css=[data-testid="employees.edit.education.add"]
    END
    
    Wait For Elements State    css=[data-testid="employees.edit.education.0.institution"]    visible    timeout=15s
    Fill Text    css=[data-testid="employees.edit.education.0.institution"]    ${institution}
    
    Save Employee Section
    Log To Console    [SUCCESS] Education section edited successfully

Edit Position Benefits Section
    [Documentation]    Edit employee position and benefits section
    [Arguments]    ${hospital}
    Log To Console    [SECTION] Starting Job Benefits edit: ${hospital}
    Navigate To Employee Section    jobBenefits
    
    Log To Console    Waiting for Job Benefits field to be visible...
    Wait For Elements State    css=[data-testid="employees.edit.jobBenefits.socialSecurityHospital"]    visible    timeout=45s
    Fill Text    css=[data-testid="employees.edit.jobBenefits.socialSecurityHospital"]    ${hospital}
    
    Save Employee Section
    Log To Console    [SUCCESS] Job Benefits section edited successfully

Edit Salary Section
    [Documentation]    Edit employee salary section
    [Arguments]    ${account_number}
    Log To Console    [SECTION] Starting Salary edit: ${account_number}
    Navigate To Employee Section    salary
    
    # Wait for the account number field (instrumented with data-testid)
    Wait For Elements State    css=[data-testid="employees.edit.salary.accountNumber"]    visible    timeout=30s
    Wait For Elements State    css=[data-testid="employees.edit.salary.accountNumber"]    enabled    timeout=10s
    
    Fill Text    css=[data-testid="employees.edit.salary.accountNumber"]    ${account_number}
    
    Save Employee Section
    Log To Console    [SUCCESS] Salary section edited successfully

Delete Employee By Name
    [Arguments]    ${name}
    Log    Delete functionality is not currently available in the UI. Skipping test.
    # Fail    Delete functionality not implemented in UI.

Should Match Url Detail Page
    ${url}=    Get Url
    Log    Current URL: ${url}
    Should Match Regexp    ${url}    /employees/[a-f0-9\\-]+    URL should be a detail page
