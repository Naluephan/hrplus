*** Settings ***
Documentation       A test suite for the Employees module.
Resource            ../resources/common.resource
Resource            ../resources/settings_keywords.resource
Resource            ../resources/pages/employees_page.resource

Library             String

Test Setup        Run Keywords    Open HR Plus Application    AND    Login To Application
Test Teardown     Close Application


*** Variables ***
${EMPLOYEES_URL}    ${URL}/employees

*** Test Cases ***
Create Employee Using Mock Data
    [Documentation]    Verify creating a new employee using mock data for faster execution.
    [Tags]    smoke    employees    crud
    
    Create Employee Using Mock Data Flow    123456789

Create Employee
    [Documentation]    Verify creating a new employee with full-step process.
    [Tags]    critical    employees    crud

    Go To Employees Page
    
    # Wait for page load
    Wait For Elements State    css=[data-testid="employees.toolbar.add"]    visible    timeout=60s
    # มั่นใจว่าปุ่มพร้อมกด (Hydration)
    Wait For Elements State    css=[data-testid="employees.toolbar.add"]    enabled    timeout=30s
    
    Click Add Employee Buttons

    # Generate Data
    ${random_id}=    Generate Random String    4    [NUMBERS]
    ${first_name}=    Set Variable    AutoUser${random_id}
    ${last_name}=     Set Variable    Test
    ${email}=         Set Variable    auto.user.${random_id}@example.com
    ${phone}=         Generate Random String    10    [NUMBERS]
    ${id_card}=       Generate Random String    13    [NUMBERS]

    # Step 1
    Fill Employee Personal Info    ${first_name}    ${last_name}    TestNick    ${phone}    ${email}    ${id_card}
    
    # Step 2
    Fill Employee Education
    
    # Step 3
    Fill Employee Employment Details    50000    ${first_name} ${last_name}
    
    # Submit
    Submit Employee Form
    
    # Verify Success by checking list
    Go To Employees Page
    Wait For Loading To Hide
    Search Employee    ${first_name}
    Verify Employee On List    ${first_name}


Search Employee
    [Documentation]    Verify searching for an existing employee.
    [Tags]    employees    search
    
    Go To Employees Page
    
    # Use a known name or one created in previous test (ideal to have separate data)
    # For now, we search for "EMP" pattern which likely exists from seeded mock data
    Search Employee    EMP
    # Verify at least one result appears (avoid strict mode on multiple rows)
    ${count}=    Get Element Count    css=tr[data-testid^="employees.table.row"]
    Should Be True    ${count} >= 1    No employees found matching 'AutoUser'

Edit Employee
    [Documentation]    Verify editing an employee across all sections.
    [Tags]    employees    crud    edit
    
    # Navigate to employee list
    Go To Employees Page
    
    # Find an existing employee
    Search Employee    EMP
    ${count}=    Get Element Count    css=tr[data-testid^="employees.table.row"]
    Should Be True    ${count} >= 1    No employees found matching 'EMP'
    
    # Click to open employee detail
    Click Edit Customer By Name    EMP
    
    # Generate Random Data for Edits
    ${rand_nick}=    Generate Random String    6    [LETTERS]
    ${rand_user}=    Generate Random String    8    [LETTERS][NUMBERS]
    ${rand_emer_name}=    Generate Random String    10    [LETTERS]
    ${rand_emer_phone}=    Generate Random String    10    [NUMBERS]
    ${rand_company}=    Generate Random String    12    [LETTERS]
    ${rand_education}=    Generate Random String    12    [LETTERS]
    ${rand_hospital}=    Generate Random String    12    [LETTERS]
    ${rand_account}=    Generate Random String    10    [NUMBERS]
    
    # Test all sections
    # 1. Personal Info (ข้อมูลส่วนตัว)
    Edit Employee Detail    ${rand_nick}
    
    # 2. Account Access (ข้อมูลบัญชีผู้ใช้)
    Edit Account Access Section    ${rand_user}
    
    # 3. Emergency Contacts (ผู้ติดต่อฉุกเฉิน)
    Edit Emergency Contacts Section    ${rand_emer_name}    ${rand_emer_phone}
    
    # 4. Work Experience (ประสบการณ์ทำงาน)
    Edit Work Experience Section    ${rand_company}
    
    # 5. Education (การศึกษา)
    Edit Education Section    ${rand_education}
    
    # 6. Position Benefits (ตำแหน่งงานและสวัสดิการ)
    Edit Position Benefits Section    ${rand_hospital}
    
    # 7. Salary (เงินเดือน)
    Edit Salary Section    ${rand_account}
    
    Log    All 7 sections tested successfully
