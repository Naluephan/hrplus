*** Settings ***
Library           String
Library           DateTime
Resource          ${CURDIR}/common.resource
Resource          ${CURDIR}/navigation.resource

*** Keywords ***
Search Department Should Exist
    [Arguments]    ${dept_name}
    Wait For Elements State    xpath=//input[contains(@placeholder, "ค้นหา")]    visible    timeout=10s
    Fill Text    xpath=//input[contains(@placeholder, "ค้นหา")]    ${dept_name}
    Press Keys   xpath=//input[contains(@placeholder, "ค้นหา")]    Enter
    Wait For Loading To Hide
    # เลือกเฉพาะช่อง TH ที่ "เท่ากับ" ชื่อพอดี (ไม่ชนกับ EN)
    Wait For Elements State    xpath=//td[normalize-space(.)="${dept_name}"]    visible    timeout=15s


Click First Department Edit
    Wait For Elements State    xpath=//tbody/tr[1]    visible    timeout=5s
    Hover    xpath=//tbody/tr[1]
    # Edit button is the 1st button in the last column
    ${edit_btn}=    Set Variable    css=[data-testid^="settings.departments.table.row.edit."] >> nth=0
    Scroll To Element          ${edit_btn}
    Wait For Elements State    ${edit_btn}    stable    timeout=5s
    Click                      ${edit_btn}

Department Should Not Exist
    [Arguments]    ${dept_name}
    Fill Text    xpath=//input[contains(@placeholder, "ค้นหา")]    ${dept_name}
    Press Keys   xpath=//input[contains(@placeholder, "ค้นหา")]    Enter
    ${cnt}=      Get Element Count    xpath=//td[normalize-space(.)="${dept_name}"]
    Should Be Equal As Integers    ${cnt}    0

Department Row Should Exist
    [Arguments]    ${dept_name}
    Fill Text    xpath=//input[contains(@placeholder, "ค้นหา")]    ${dept_name}
    Press Keys   xpath=//input[contains(@placeholder, "ค้นหา")]    Enter
    Wait For Elements State
    ...    xpath=//tr[.//td//*[contains(normalize-space(.), "${dept_name}")] or contains(normalize-space(.), "${dept_name}")]
    ...    visible
    ...    timeout=2s


Department Row Exists By Search
    [Arguments]    ${name}
    Fill Text    xpath=//input[contains(@placeholder, "ค้นหา")]    ${name}
    Press Keys   xpath=//input[contains(@placeholder, "ค้นหา")]    Enter
    ${ok}=    Run Keyword And Return Status
    ...    Wait For Elements State    xpath=//td[normalize-space(.)="${name}"]    visible    timeout=2s
    RETURN    ${ok}

Create Department Quick And Return Name
    [Arguments]    ${create_position}=${False}
    # Ensure a level exists because it is required for positions in department form (otherwise submit is disabled)
    Create Level Quick And Return Name

    ${rid}=   Generate Random String    4    [NUMBERS]
    ${name}=  Set Variable    Auto Dept ${rid}
    ${code}=  Generate Random String    2    [UPPER]

    Navigate To Menu    ${EMPTY}    settings.departments    /settings/departments
    Wait For Elements State    xpath=//h1[contains(., "แผนก")]    visible    timeout=60s
    Wait For Elements State    xpath=//button[contains(., "เพิ่มรายการ")]    visible

    # Retry opening sheet because of setTimeout in frontend
    Wait Until Keyword Succeeds    3x    5s    Open Department Form Retry

    Fill Text    css=[data-testid="settings.departments.form.nameTh.input"]    ${name}
    Fill Text    css=[data-testid="settings.departments.form.nameEng.input"]   ${name} EN
    Fill Text    css=[data-testid="settings.departments.form.code.input"]      ${code}

    IF    ${create_position}
        Click    css=[data-testid="settings.departments.positions.add"]
        Fill Text    css=[data-testid="settings.departments.positions.0.nameTh"]    Auto Pos ${rid}
        Fill Text    css=[data-testid="settings.departments.positions.0.nameEn"]    Auto Pos ${rid} EN
        Fill Text    css=[data-testid="settings.departments.positions.0.code"]      P${rid}
        # Select Level 1 (assuming index 1 or value level-1)
        Select Options By    css=[data-testid="settings.departments.positions.0.level"]    index    1
    END

    Wait For Elements State    css=[data-testid="settings.departments.form.submit"]    enabled    timeout=60s
    Click    css=[data-testid="settings.departments.form.submit"]

    # รอจบการบันทึกแบบไม่พึ่ง sheet ปิดเอง
    ${did_disable}=    Run Keyword And Return Status
    ...    Wait For Elements State    css=[data-testid="settings.departments.form.submit"]    disabled    timeout=10s
    IF    ${did_disable}
        Wait For Elements State    css=[data-testid="settings.departments.form.submit"]    enabled    timeout=60s
    END

    # กลับหน้า list แล้ว verify ว่ามีจริง
    Go To    ${URL}/settings/departments    wait_until=domcontentloaded
    Wait Until Keyword Succeeds    10x    2s    Search Department Should Exist Exact    ${name}
    RETURN    ${name}


Create Department With Position Quick And Return Names
    # Ensure a level exists because it is required for positions in department form
    # Ensure a level exists and get its name
    ${level_name}=    Create Level Quick And Return Name

    ${rid}=   Generate Random String    4    [NUMBERS]
    ${name}=  Set Variable    Auto Dept ${rid}
    ${code}=  Generate Random String    2    [UPPER]
    ${pos_name}=  Set Variable    Auto Pos ${rid}

    Navigate To Menu    ${EMPTY}    settings.departments    /settings/departments
    Wait For Elements State    xpath=//h1[contains(., "แผนก")]    visible    timeout=60s
    Wait For Elements State    xpath=//button[contains(., "เพิ่มรายการ")]    visible

    # Retry opening sheet because of setTimeout in frontend
    Wait Until Keyword Succeeds    3x    5s    Open Department Form Retry

    Fill Text    css=[data-testid="settings.departments.form.nameTh.input"]    ${name}
    Fill Text    css=[data-testid="settings.departments.form.nameEng.input"]   ${name} EN
    Fill Text    css=[data-testid="settings.departments.form.code.input"]      ${code}

    Click    css=[data-testid="settings.departments.positions.add"]
    Fill Text    css=[data-testid="settings.departments.positions.0.nameTh"]    ${pos_name}
    Fill Text    css=[data-testid="settings.departments.positions.0.nameEn"]    ${pos_name} EN
    Fill Text    css=[data-testid="settings.departments.positions.0.code"]      P${rid}
    # Select Level 1 (assuming index 1)
    Select Options By    css=[data-testid="settings.departments.positions.0.level"]    index    1

    Wait For Elements State    css=[data-testid="settings.departments.form.submit"]    enabled    timeout=60s
    Click    css=[data-testid="settings.departments.form.submit"]
    
    # Wait for save
    ${did_disable}=    Run Keyword And Return Status
    ...    Wait For Elements State    css=[data-testid="settings.departments.form.submit"]    disabled    timeout=10s
    IF    ${did_disable}
        Wait For Elements State    css=[data-testid="settings.departments.form.submit"]    enabled    timeout=60s
    END

    # Verify
    Go To    ${URL}/settings/departments    wait_until=domcontentloaded
    Wait Until Keyword Succeeds    10x    2s    Search Department Should Exist Exact    ${name}
    
    RETURN    ${name}    ${pos_name}    ${level_name}


Open Department Form Retry
    Click    xpath=//button[contains(., "เพิ่มรายการ")]
    Wait For Elements State    css=[data-testid="settings.departments.form.sheet"]    visible    timeout=2s

Search Department Should Exist Exact
    [Arguments]    ${dept_name}
    Wait For Elements State    xpath=//input[contains(@placeholder, "ค้นหา")]    visible    timeout=10s
    Fill Text    xpath=//input[contains(@placeholder, "ค้นหา")]    ${dept_name}
    Press Keys   xpath=//input[contains(@placeholder, "ค้นหา")]    Enter
    Wait For Elements State    xpath=//td[normalize-space(.)="${dept_name}"]    visible    timeout=3s



Delete Department By Name
    [Arguments]    ${name}
    Wait For Elements State    xpath=//input[contains(@placeholder, "ค้นหา")]    visible    timeout=60s
    Fill Text    xpath=//input[contains(@placeholder, "ค้นหา")]    ${name}
    Press Keys   xpath=//input[contains(@placeholder, "ค้นหา")]    Enter

    ${row}=    Set Variable    xpath=//tr[.//td[contains(normalize-space(.), "${name}")]]
    Wait For Elements State    ${row}    visible    timeout=60s

    ${delete_btn}=    Set Variable    ${row}//button[starts-with(@data-testid,"settings.departments.table.row.delete.")]
    Scroll To Element          ${delete_btn}
    Wait For Elements State    ${delete_btn}    stable    timeout=10s
    
    # Handle native confirm dialog
    Handle Future Dialogs    action=accept
    Click                      ${delete_btn}

    # Wait for row to disappear (no toast in this case)
    Wait For Elements State    ${row}    hidden    timeout=60s



Create Level Quick And Return Name
    ${rid}=   Generate Random String    4    [NUMBERS]
    ${name}=  Set Variable    Auto Level ${rid}
    
    Navigate To Menu    ${EMPTY}    settings.levels    /settings/levels
    Wait For Elements State    xpath=//h1[contains(., "เลเวล")]    visible    timeout=60s
    Wait For Elements State    xpath=//button[contains(., "เพิ่มรายการ")]    visible
    
    # Retry opening sheet
    Wait Until Keyword Succeeds    3x    5s    Open Level Form Retry

    Fill Text    css=[data-testid="settings.levels.form.nameTh.input"]    ${name}
    Fill Text    css=[data-testid="settings.levels.form.nameEng.input"]   ${name} EN

    Wait For Elements State    css=[data-testid="settings.levels.form.submit"]    enabled    timeout=60s
    Click    css=[data-testid="settings.levels.form.submit"]
    
    # Verify Success (Toast might not exist, check for element visibility instead)
    Wait For Elements State    css=[data-testid="settings.levels.form.sheet"]    hidden    timeout=60s
    Wait For Elements State    xpath=//td[normalize-space(.)="${name}"]    visible    timeout=10s
    
    RETURN    ${name}

Open Level Form Retry
    Click    xpath=//button[contains(., "เพิ่มรายการ")]
    Wait For Elements State    css=[data-testid="settings.levels.form.sheet"]    visible    timeout=2s





Create Holiday Item Quick And Return Name
    [Documentation]    Creates a holiday item quickly and returns its name.
    Navigate To Menu    ${EMPTY}    settings.holidays    /settings/holidays
    Wait For Elements State    css=[data-testid="settings.holidays.page.root"]    visible    timeout=60s
    
    # Select first available calendar year (check visiblity first)
    ${card_selector}=    Set Variable    xpath=(//div[contains(@data-testid, "settings.holidays.card.")])[1]
    Wait For Elements State    ${card_selector}    visible    timeout=10s
    
    # Extract Year from card ID to ensure we add holiday to the correct year
    ${card_id}=    Get Attribute    ${card_selector}    data-testid
    ${year}=    Fetch From Right    ${card_id}    .
    
    Click    ${card_selector}
    
    # Click Add Holiday
    Click    css=[data-testid="settings.holidays.add.button"]
    Wait For Elements State    css=[data-testid="settings.holidays.holiday.modal"]    visible    timeout=10s
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${holiday_name}=    Set Variable    Auto Holiday ${random_id}
    # Use the specific year from the card
    ${start_date}=    Set Variable    ${year}-01-01
    
    Fill Text    css=[data-testid="settings.holidays.holiday.form.name"]    ${holiday_name}
    Fill Text    css=[data-testid="settings.holidays.holiday.form.dateStart"]    ${start_date}
    Fill Text    css=[data-testid="settings.holidays.holiday.form.dateEnd"]    ${start_date}
    Click    css=[data-testid="settings.holidays.holiday.form.type.traditional"]
    
    # Fill description if needed (optional)
    Fill Text    css=[data-testid="settings.holidays.holiday.form.description"]    Auto Created For Test
    
    Click    css=[data-testid="settings.holidays.holiday.form.submit"]
    
    Wait For Elements State    css=[data-testid="settings.holidays.holiday.modal"]    hidden    timeout=60s
    # Wait for table to update by searching
    Fill Text    css=[data-testid="settings.holidays.search.input"]    ${holiday_name}
    Wait For Elements State    css=tr:has-text("${holiday_name}")    visible    timeout=10s
    
    RETURN    ${holiday_name}


Create Shift Quick And Return Name
    [Documentation]    Creates a shift quickly and returns its name.
    Go To    ${URL}/settings/shifts
    Wait For Elements State    css=[data-testid="settings.shifts.page.root"]    visible    timeout=60s
    
    # Click Add Shift (Corrected ID)
    Click    css=[data-testid="settings.shifts.button.add"]
    Wait For Elements State    css=[data-testid="settings.shifts.modal"]    visible    timeout=10s
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${shift_name}=    Set Variable    Auto Shift ${random_id}
    ${shift_code}=    Set Variable    S${random_id}
    
    Fill Text    css=[data-testid="settings.shifts.form.code"]    ${shift_code}
    Fill Text    css=[data-testid="settings.shifts.form.name"]    ${shift_name}
    Fill Text    css=[data-testid="settings.shifts.form.description"]    Test Shift
    Fill Text    css=[data-testid="settings.shifts.form.shiftStart"]    09:00
    Fill Text    css=[data-testid="settings.shifts.form.shiftEnd"]    18:00
    Fill Text    css=[data-testid="settings.shifts.form.breakStart"]    12:00
    Fill Text    css=[data-testid="settings.shifts.form.breakEnd"]    13:00
    # Optional fields
    Fill Text    css=[data-testid="settings.shifts.form.otStart"]    18:30
    Fill Text    css=[data-testid="settings.shifts.form.otEnd"]    20:30
    
    # Save
    Click    css=[data-testid="settings.shifts.form.submit"]
    Wait For Elements State    css=[data-testid="settings.shifts.modal"]    hidden    timeout=60s
    
    # Wait for table to update by searching using DIV selector
    Fill Text    css=[data-testid="settings.shifts.filter.search"]    ${shift_name}
    Wait For Elements State    css=div[data-testid^="settings.shifts.table.row."]:has-text("${shift_name}")    visible    timeout=10s
    
    RETURN    ${shift_name}

Create Separation Reason Quick And Return Name
    [Documentation]    Creates a separation reason quickly and returns its name.
    Go To    ${URL}/settings/separation-reasons
    Wait For Elements State    css=[data-testid="settings.separationReasons.page.root"]    visible    timeout=60s
    
    Click    css=[data-testid="settings.separationReasons.add.button"]
    Wait For Elements State    css=[data-testid="settings.separationReasons.form.name"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${reason_name}=    Set Variable    Auto Reason ${random_id}
    
    Fill Text    css=[data-testid="settings.separationReasons.form.name"]    ${reason_name}
    Click    css=[data-testid="settings.separationReasons.form.submit"]
    Wait Until Toast Contains    สำเร็จ    timeout=120s
    
    # Wait for table to update by searching
    Fill Text    css=[data-testid="settings.separationReasons.search.input"]    ${reason_name}
    Wait For Elements State    css=tr[data-testid^="settings.separationReasons.table.row."]:has-text("${reason_name}")    visible    timeout=10s
    
    RETURN    ${reason_name}


Create Tag Quick And Return Name
    [Documentation]    Creates a tag quickly and returns its name.
    Go To    ${URL}/settings/tags
    Wait For Elements State    css=[data-testid="settings.tags.page.root"]    visible    timeout=60s
    
    Click    css=[data-testid="settings.tags.add.button"]
    Wait For Elements State    css=[data-testid="settings.tags.form.name"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${tag_name}=    Set Variable    Auto Tag ${random_id}
    
    Fill Text    css=[data-testid="settings.tags.form.name"]    ${tag_name}
    
    # Select Tag Group
    Click    css=[data-testid="settings.tags.form.group"]
    
    # No Sleep replacement: wait for options
    Wait For Elements State    css=[role="option"]    visible    timeout=5s
    
    # Try selecting by role first, then text as fallback
    # Note: Get Element Count without wait might return 0 if transition is slow
    ${option_count}=    Get Element Count    css=[role="option"]
    IF    ${option_count} > 0
        Click    xpath=(//div[@role="option"])[last()]
    ELSE
        Click    xpath=//*[contains(text(), "บุคลากร") or contains(text(), "HR")]
    END
    
    Click    css=[data-testid="settings.tags.form.submit"]
    
    # Verify Success (sheet closes)
    Wait For Elements State    css=[data-testid="settings.tags.sheet"]    hidden    timeout=60s

    
    # Wait for table to update by searching (using filter input)
    Fill Text    css=[data-testid="settings.tags.filter.search"]    ${tag_name}
    Click    css=[data-testid="settings.tags.filter.search"]
    Press Keys    css=[data-testid="settings.tags.filter.search"]    Enter
    Wait For Elements State    xpath=//tr[contains(., "${tag_name}")]    visible    timeout=10s
    
    RETURN    ${tag_name}


Create Income Quick And Return Code
    [Documentation]    Creates an income type quickly and returns its code.
    Go To    ${URL}/salary/components
    Wait For Elements State    css=[data-testid="salary.components.page.root"]    visible    timeout=60s
    
    Click    css=[data-testid="salary.components.page.root"] >> text="เพิ่มองค์ประกอบ"
    Wait For Elements State    css=[data-testid="salary.components.form.code"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${code}=    Set Variable    INC_${random_id}
    
    Fill Text    css=[data-testid="salary.components.form.code"]    ${code}
    Fill Text    css=[data-testid="salary.components.form.name"]    Auto Income ${random_id}
    Select Options By    css=[data-testid="salary.components.form.category"]    value    income
    Select Options By    css=[data-testid="salary.components.form.type"]    value    fixed
    
    Click    css=[data-testid="salary.components.form.submit"]
    Wait Until Toast Contains    สำเร็จ    timeout=120s
    RETURN    ${code}

Create Deduction Quick And Return Code
    [Documentation]    Creates a deduction type quickly and returns its code.
    Go To    ${URL}/salary/deductions
    Wait For Elements State    css=[data-testid="salary.deductions.page.root"]    visible    timeout=60s
    
    Click    css=[data-testid="salary.deductions.page.root"] >> text="เพิ่มการหักเงิน"
    Wait For Elements State    css=[data-testid="salary.deductions.form.code"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${code}=    Set Variable    DED_${random_id}
    
    Fill Text    css=[data-testid="salary.deductions.form.code"]    ${code}
    Fill Text    css=[data-testid="salary.deductions.form.name"]    Auto Deduction ${random_id}
    Select Options By    css=[data-testid="salary.deductions.form.category"]    value    other
    Select Options By    css=[data-testid="salary.deductions.form.calculationType"]    value    fixed
    
    Click    css=[data-testid="salary.deductions.form.submit"]
    Wait Until Toast Contains    สำเร็จ    timeout=120s
    RETURN    ${code}

Create Salary Setting Quick And Return Key
    [Documentation]    Creates a salary setting quickly and returns its key.
    Go To    ${URL}/salary/settings
    # Page now has data-testid="salary.settings.page.root" (added to page.tsx)
    Wait For Elements State    css=[data-testid="salary.settings.page.root"]    visible    timeout=60s
    
    Click    xpath=//button[contains(., "เพิ่มตั้งค่า")]
    Wait For Elements State    css=[data-testid="salary.settings.form.key"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${key}=    Set Variable    KEY_${random_id}
    
    Fill Text    css=[data-testid="salary.settings.form.key"]    ${key}
    Fill Text    css=[data-testid="salary.settings.form.value"]    100
    Select Options By    css=[data-testid="salary.settings.form.type"]    value    number
    Select Options By    css=[data-testid="salary.settings.form.category"]    value    other
    
    Click    css=[data-testid="salary.settings.form.submit"]
    Wait Until Toast Contains    สำเร็จ    timeout=120s
    RETURN    ${key}

Create Period Quick And Return Code
    [Documentation]    Creates a salary period quickly and returns its code.
    Navigate To Menu    salary    salary.periods    /salary/periods
    Wait For Elements State    css=[data-testid="salary.periods.page.root"]    visible    timeout=60s
    Click    css=[data-testid="salary.periods.add"]
    Wait For Elements State    css=[data-testid="salary.periods.form.code"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${year_suffix}=    Generate Random String    2    [NUMBERS]
    ${year}=    Set Variable    20${year_suffix}
    ${code}=    Set Variable    P${random_id}
    Fill Text    css=[data-testid="salary.periods.form.code"]    ${code}
    Fill Text    css=[data-testid="salary.periods.form.name"]    Auto Period ${random_id}
    Fill Text    css=[data-testid="salary.periods.form.startDate"]    ${year}-02-01
    Fill Text    css=[data-testid="salary.periods.form.endDate"]    ${year}-02-28
    
    Wait For Elements State    css=[data-testid="salary.periods.form.submit"]    enabled    timeout=60s
    Click    css=[data-testid="salary.periods.form.submit"]
    
    # Wait for save cycle: button disabled then enabled again, then navigate back
    ${did_disable}=    Run Keyword And Return Status
    ...    Wait For Elements State    css=[data-testid="salary.periods.form.submit"]    disabled    timeout=10s
    IF    ${did_disable}
        Wait For Elements State    css=[data-testid="salary.periods.form.submit"]    enabled    timeout=60s
    END
    
    # Navigate back to list and verify
    Go To    ${URL}/salary/periods
    Wait For Elements State    css=[data-testid="salary.periods.page.root"]    visible    timeout=60s
    Wait For Elements State    css=[data-testid="salary.periods.search.input"]    visible    timeout=60s
    Fill Text    css=[data-testid="salary.periods.search.input"]    ${code}
    Press Keys   css=[data-testid="salary.periods.search.input"]    Enter
    Wait Until Keyword Succeeds    10x    2s    Salary Period Row Should Exist    ${code}
    
    RETURN    ${code}


Create Fund Plan Quick And Return Code
    [Documentation]    Creates a fund plan quickly and returns its code.
    Go To    ${URL}/wallet/fund/plans
    Wait For Elements State    css=[data-testid="wallet.fund.plans.page.root"]    visible    timeout=60s
    Click    css=[data-testid="wallet.fund.plans.add"]
    Wait For Elements State    css=[data-testid="wallet.fund.plans.form.code"]    visible
    
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${code}=    Set Variable    FQ${random_id}
    Fill Text    css=[data-testid="wallet.fund.plans.form.code"]    ${code}
    Fill Text    css=[data-testid="wallet.fund.plans.form.name"]    Auto Fund ${random_id}
    Fill Text    css=[data-testid="wallet.fund.plans.form.minEmployeeRate"]    2
    Fill Text    css=[data-testid="wallet.fund.plans.form.defaultEmployeeRate"]    5
    Fill Text    css=[data-testid="wallet.fund.plans.form.maxEmployeeRate"]    15
    Fill Text    css=[data-testid="wallet.fund.plans.form.minCompanyRate"]    2
    Fill Text    css=[data-testid="wallet.fund.plans.form.defaultCompanyRate"]    5
    Fill Text    css=[data-testid="wallet.fund.plans.form.maxCompanyRate"]    15
    Click    css=[data-testid="wallet.fund.plans.form.submit"]
    Wait Until Toast Contains    สำเร็จ    timeout=120s
    RETURN    ${code}

Create Fund Registration Quick And Return Employee Code
    [Documentation]    Creates a fund registration quickly and returns employee code.
    Go To    ${URL}/wallet/fund/registrations
    Wait For Elements State    css=[data-testid="wallet.fund.registrations.page.root"]    visible    timeout=60s
    Click    css=[data-testid="wallet.fund.registrations.add"]
    Wait For Elements State    css=[data-testid="wallet.fund.registrations.form.employeeSearch"]    visible
    
    Fill Text    css=[data-testid="wallet.fund.registrations.form.employeeSearch"]    00
    
    # Replaced Sleep with wait for option
    Wait For Elements State    xpath=(//button[@data-testid="wallet.fund.registrations.form.employeeSearch.option"])[1]    visible    timeout=5s

    # Extract Employee Code from the second SPAN in the first dropdown item
    ${emp_code}=    Get Text    xpath=(//button[@data-testid="wallet.fund.registrations.form.employeeSearch.option"])[1]//span[2]
    # Remove everything after the bullet or space
    ${emp_code}=    Fetch From Left    ${emp_code}    ${SPACE}
    
    Click    xpath=(//button[@data-testid="wallet.fund.registrations.form.employeeSearch.option"])[1]
    Select Options By    css=[data-testid="wallet.fund.registrations.form.fundPlan"]    index    1
    
    Click    css=[data-testid="wallet.fund.registrations.form.submit"]
    Wait For Elements State    css=[data-testid="wallet.fund.registrations.form.submit"]    hidden    timeout=60s
    RETURN    ${emp_code}

Salary Period Row Should Exist
    [Arguments]    ${code}
    Wait For Elements State    css=[data-testid="salary.periods.table.row.${code}"]    visible    timeout=5s

Salary Period Name Should Be
    [Arguments]    ${code}    ${updated_name}
    Wait For Elements State
    ...    xpath=//tr[contains(@data-testid,"salary.periods.table.row.${code}")]//td[contains(normalize-space(.), "${updated_name}")]
    ...    visible
    ...    timeout=2s

Salary Period Delete Button Should Exist
    [Arguments]    ${code}
    Wait For Elements State    css=[data-testid="salary.periods.table.delete.${code}"]    visible    timeout=2s

Salary Period Should Not Exist
    [Arguments]    ${code}
    Fill Text    css=[data-testid="salary.periods.search.input"]    ${code}
    Press Keys   css=[data-testid="salary.periods.search.input"]    Enter
    ${cnt}=    Get Element Count    css=[data-testid="salary.periods.table.row.${code}"]
    Should Be Equal As Integers    ${cnt}    0
