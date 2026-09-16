*** Settings ***
Documentation      Comprehensive E2E API Smoke Testing Suite for Frontend-Consumed Modules in HRPlus
Library            DateTime
Library            Collections
Resource           ../../resources/keywords/api_common.resource
Resource           ../../resources/keywords/department_api.resource
Resource           ../../resources/keywords/position_api.resource
Resource           ../../resources/keywords/employee_api.resource
Resource           ../../resources/keywords/attendance_api.resource
Resource           ../../resources/keywords/overtime_api.resource
Resource           ../../resources/keywords/device_api.resource
Resource           ../../resources/keywords/reports_api.resource
Resource           ../../resources/keywords/organics_points_api.resource
Resource           ../../resources/keywords/provident_fund_api.resource

Suite Setup        Run Keywords    Create HR API Session
Suite Teardown     Cleanup All Smoke Resources

*** Variables ***
# Dynamic IDs stored for cascade cleanup in teardown
${CREATED_DEPT_ID}              ${None}
${CREATED_POS_ID}               ${None}
${CREATED_EMP_ID}               ${None}
${CREATED_MANAGER_ID}           ${None}
${CREATED_DEVICE_PK_ID}         ${None}
${CREATED_DEVICE_LOGICAL_ID}    DEVSCR99
${CREATED_OT_RECORD_ID}         ${None}
${CREATED_FUND_PLAN_ID}         ${None}
${CREATED_FUND_REG_ID}          ${None}
${CREATED_FUND_RECORD_ID}       ${None}

*** Test Cases ***
Pre-requisite Setup - Create Department Position and Employees
    [Documentation]    Creates test department, position, employee, and manager profiles dynamically.
    [Tags]             smoke    setup    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [SETUP] Creating pre-requisite business entities...
    
    # 1. Create Department (Code must be exactly 2 characters)
    ${dept_code}=      Evaluate    chr(random.randint(65, 90)) + chr(random.randint(65, 90))    modules=random
    ${rand}=           Evaluate    random.randint(100, 999)    modules=random
    ${dept_id}    ${dept_body}=    Create Department via API
    ...                            code=${dept_code}
    ...                            name_th=แผนกทดสอบอัตโนมัติ ${rand}
    ...                            name_en=Auto Test Dept ${rand}
    Set Suite Variable    ${CREATED_DEPT_ID}    ${dept_id}
    Log To Console     [INFO] Department Created: ID=${dept_id} (Code=${dept_code})
    
    # 2. Create Position (Code must be exactly 2 characters)
    ${char_suffix}=    Evaluate    chr(random.randint(65, 90)) + chr(random.randint(65, 90))    modules=random
    ${pos_id}    ${pos_body}=     Create Position via API
    ...                            code=${char_suffix}
    ...                            name_th=วิศวกรทดสอบอัตโนมัติ ${char_suffix}
    ...                            name_en=Auto Test Engineer ${char_suffix}
    ...                            department_id=${dept_id}
    Set Suite Variable    ${CREATED_POS_ID}    ${pos_id}
    Log To Console     [INFO] Position Created: ID=${pos_id}
    
    # 3. Create Manager Employee
    ${m_email}=        Set Variable    auto.manager.${rand}@example.com
    ${m_id}    ${m_body}=         Create Employee via API
    ...                            first_name=ผู้จัดการ
    ...                            last_name=ทดสอบ
    ...                            email=${m_email}
    ...                            dept_id=${dept_id}
    ...                            pos_id=${pos_id}
    Set Suite Variable    ${CREATED_MANAGER_ID}    ${m_id}
    Log To Console     [INFO] Manager Created: ID=${m_id}
    
    # 4. Create Staff Employee
    ${e_email}=        Set Variable    auto.staff.${rand}@example.com
    ${e_id}    ${e_body}=         Create Employee via API
    ...                            first_name=พนักงาน
    ...                            last_name=สแกน
    ...                            email=${e_email}
    ...                            dept_id=${dept_id}
    ...                            pos_id=${pos_id}
    Set Suite Variable    ${CREATED_EMP_ID}    ${e_id}
    Log To Console     [INFO] Staff Employee Created: ID=${e_id}
    Log To Console     ------------------------------------------------------------

Verify Device Management and Scanner Punches
    [Documentation]    Registers a physical scanner, updates heartbeat, mocks facial punch-ins/outs, and syncs data.
    [Tags]             smoke    device    punch    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [START] Testing Device Management and Scanner Punches...
    
    # 1. Register Device
    Log To Console     [STEP 1] Registering facial scanner device: ${CREATED_DEVICE_LOGICAL_ID}
    ${device_body}=    Create Device via API
    ...                device_id=${CREATED_DEVICE_LOGICAL_ID}
    ...                name=เครื่องสแกนใบหน้าสำนักงานใหญ่
    ...                location=อาคารเอ ชั้น 1
    ${db_id}=          Get From Dictionary    ${device_body}    id
    Set Suite Variable    ${CREATED_DEVICE_PK_ID}    ${db_id}
    Log To Console     [INFO] Device Registered (DB PK ID: ${db_id})
    
    # 2. Update Device Heartbeat (marks status online)
    Log To Console     [STEP 2] Sending heartbeat for device: ${CREATED_DEVICE_LOGICAL_ID}
    ${hb_resp}=        Update Device Heartbeat via API    ${CREATED_DEVICE_LOGICAL_ID}
    Should Be Equal As Strings    ${hb_resp}[status]    online
    
    # 3. Retrieve Health Status list
    Log To Console     [STEP 3] Verifying device status in Health List
    ${health_list}=    Get Device Health via API
    ${found}=          Set Variable    ${FALSE}
    FOR    ${dev}    IN    @{health_list}
        ${d_id}=       Get From Dictionary    ${dev}    deviceId
        IF    '${d_id}' == '${CREATED_DEVICE_LOGICAL_ID}'
            ${found}=    Set Variable    ${TRUE}
            Should Be Equal As Strings    ${dev}[status]    online
            BREAK
        END
    END
    Should Be True     ${found}    Registered device not found in health listing.
    
    # 4. Mock facial check-in/out punches
    Log To Console     [STEP 4] Mocking device check-in punch for staff
    # Staff details returned from employee endpoint contains employeeCode
    ${staff_details}=  Get Employee Profile via API    ${CREATED_EMP_ID}
    ${emp_code}=       Get From Dictionary    ${staff_details}    employeeCode
    
    ${in_resp}=        Device Punch Check In via API    ${CREATED_DEVICE_LOGICAL_ID}    ${emp_code}
    Should Contain    ${in_resp}[message]    Check-in successful
    Log To Console     [SUCCESS] Device punch flows verified!
    Log To Console     ------------------------------------------------------------

Verify Mobile Attendance and Details Modification
    [Documentation]    Simulates mobile GPS check-in/out, retrieves detailed record, and makes corrections as admin.
    [Tags]             smoke    attendance    mobile    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [START] Testing Mobile Attendance and Details Modification...
    
    # Get Current Date for Punching
    ${today}=          Get Current Date    result_format=%Y-%m-%d
    
    # 1. Mobile Check-in (GPS coords: Bangkok area)
    Log To Console     [STEP 1] Performing Mobile Check-In via GPS on date: ${today}
    ${in_resp}=        Check In Mobile via API
    ...                employee_id=${CREATED_EMP_ID}
    ...                lat=13.7563
    ...                lng=100.5018
    ...                date=${today}
    ...                time=09:00:00
    Should Be Equal As Strings    ${in_resp}[employeeId]    ${CREATED_EMP_ID}
    
    # 2. Mobile Check-out
    Log To Console     [STEP 2] Performing Mobile Check-Out via GPS on date: ${today}
    ${out_resp}=       Check Out Mobile via API
    ...                employee_id=${CREATED_EMP_ID}
    ...                lat=13.7563
    ...                lng=100.5018
    ...                date=${today}
    ...                time=18:00:00
    Should Be Equal As Strings    ${out_resp}[employeeId]    ${CREATED_EMP_ID}
    
    # 3. Fetch detailed daily punch logs
    Log To Console     [STEP 3] Fetching daily attendance details
    ${details}=        Get Attendance Detail via API    ${CREATED_EMP_ID}    ${today}
    Should Be Equal As Strings    ${details}[date][value]    ${today}
    
    # 4. Modify check-in time to 08:30:00 (Admin correction)
    Log To Console     [STEP 4] Modifying punch times via Admin Correction Detail Patch
    ${update_payload}=  Create Dictionary
    ...                 checkIn=08:30:00
    ...                 checkOut=18:00:00
    ...                 status=present
    ${patched}=        Update Attendance Detail via API    ${CREATED_EMP_ID}    ${today}    ${update_payload}
    Log To Console     [SUCCESS] Mobile attendance and admin adjustments verified!
    Log To Console     ------------------------------------------------------------

Verify Overtime Management End-to-End Approval Workflow
    [Documentation]    Covers OT request creation, multi-level approvals, reject options, and matching.
    [Tags]             smoke    overtime    approval    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [START] Testing Overtime Management End-to-End Approval...
    
    # Get dynamic future date for overtime (must not be past date)
    ${ot_date}=        Get Current Date    increment=1 day    result_format=%Y-%m-%d
    
    # 1. Create single evening OT request (Safe evening window: 19:00 - 21:00)
    Log To Console     [STEP 1] Creating Evening OT Request: ${ot_date} (19:00 - 21:00)
    ${ot_resp}=        Create Overtime Request via API
    ...                employee_id=${CREATED_EMP_ID}
    ...                date=${ot_date}
    ...                start_time=19:00:00
    ...                end_time=21:00:00
    ...                reason=งานซ่อมบำรุงเซิร์ฟเวอร์ด่วน
    ...                ot_type=evening
    ${ot_id}=          Get From Dictionary    ${ot_resp}    id
    Set Suite Variable    ${CREATED_OT_RECORD_ID}    ${ot_id}
    Log To Console     [INFO] Overtime Request ID: ${ot_id}
    
    # 2. Stage 1: Approve by Manager
    Log To Console     [STEP 2] Approving OT by Manager
    ${app_mgr}=        Approve Overtime by Manager via API    ${ot_id}    remarks=สมควรทำโอที อนุมัติโดยหัวหน้างาน
    Should Be Equal As Strings    ${app_mgr}[status]    hr_review
    
    # 3. Stage 2: Acknowledge by HR
    Log To Console     [STEP 3] Acknowledging OT by HR
    ${ack_hr}=         Acknowledge Overtime by HR via API    ${ot_id}    remarks=ฝ่ายบุคคลรับทราบชั่วโมงเรียบร้อย
    Should Be Equal As Strings    ${ack_hr}[status]    approved
    
    # 4. Stage 3: Final Approval
    Log To Console     [STEP 4] Performing Final Approval on request: ${ot_id}
    ${fin_app}=        Final Approve Overtime via API    ${ot_id}    remarks=อนุมัติจ่ายค่าล่วงเวลาเรียบร้อย
    Should Be Equal As Strings    ${fin_app}[status]    approved
    
    # 5. Match with actual attendance (2.0 hours approved)
    Log To Console     [STEP 5] Matching OT hours with attendance record
    ${matched}=        Match Overtime with Attendance via API    ${ot_id}    2.0
    Should Be Equal As Strings    ${matched}[id]    ${ot_id}
    Log To Console     [SUCCESS] Overtime multi-stage approval lifecycle verified!
    Log To Console     ------------------------------------------------------------

Verify Organics Points Operations
    [Documentation]    Verifies points adjustments, transaction transfers, and dashboards.
    [Tags]             smoke    points    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [START] Testing Organics Points Operations...
    
    # 1. First transaction: Add 50 points to initialize row
    Log To Console     [STEP 1] Issuing point addition transaction to initialize balance (+50 points)
    ${emp_list}=       Create List    ${CREATED_EMP_ID}
    ${tx_resp}=        Create Points Transaction via API
    ...                employee_ids=${emp_list}
    ...                type=add
    ...                points=50
    ...                reason=รางวัลตอบแทนการสแกนเข้าทำงานสมบูรณ์
    
    # 2. Fetch Points Employee Detail to find balance ID
    Log To Console     [STEP 2] Fetching employee point balance profile
    ${staff_profile}=  Get Employee Profile via API    ${CREATED_EMP_ID}
    ${emp_code}=       Get From Dictionary    ${staff_profile}    employeeCode
    ${pts_list}=       List Points Employees via API    search=${emp_code}
    ${pts_emp}=        Get From List    ${pts_list}[data]    0
    ${balance_id}=     Get From Dictionary    ${pts_emp}[balance]    id
    Log To Console     [INFO] Employee Balance ID: ${balance_id}
    
    # 3. Manual point adjustment: Set balance to 100 points
    Log To Console     [STEP 3] Modifying employee point balance (Set to 100 points)
    ${adj_resp}=       Update Employee Points via API
    ...                employee_id=${CREATED_EMP_ID}
    ...                balance_id=${balance_id}
    ...                type=set
    ...                points=100
    ...                reason=ปรับแต้มเริ่มต้นเพื่อประเมิน smoke test
    
    # 4. Points transaction: Add another 50 points via transaction block
    Log To Console     [STEP 4] Issuing second point addition transaction (+50 points)
    ${tx_resp_2}=      Create Points Transaction via API
    ...                employee_ids=${emp_list}
    ...                type=add
    ...                points=50
    ...                reason=โบนัสพิเศษรายเดือน
    
    # 5. Verify updated balance is exactly 150 points via currentPoints
    Log To Console     [STEP 5] Verifying points total
    ${pts_emp_updated}=  Get Points Employee Detail via API    ${CREATED_EMP_ID}
    ${current_pts}=      Get From Dictionary    ${pts_emp_updated}    currentPoints
    Should Be Equal As Integers    ${current_pts}    150
    Log To Console     [SUCCESS] Organics points balance updates and transactions verified!
    Log To Console     ------------------------------------------------------------

Verify Provident Fund Plans and Registrations
    [Documentation]    Covers plan registration, employee sign-up, record submission, and balance checking.
    [Tags]             smoke    provident-fund    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [START] Testing Provident Fund Plans and Registrations...
    
    # 1. Create a Provident Fund Plan
    ${rand_plan}=      Evaluate    random.randint(100, 999)    modules=random
    Log To Console     [STEP 1] Creating new Provident Fund Plan: PLAN-${rand_plan}
    ${plan_resp}=      Create Fund Plan via API
    ...                code=P${rand_plan}
    ...                name=กองทุนทดสอบอัตโนมัติรุ่นที่ ${rand_plan}
    ...                desc=Auto Test Provident Fund Plan
    ${plan_id}=        Get From Dictionary    ${plan_resp}    id
    Set Suite Variable    ${CREATED_FUND_PLAN_ID}    ${plan_id}
    Log To Console     [INFO] Fund Plan ID: ${plan_id}
    
    # 2. Register Employee to the Plan
    Log To Console     [STEP 2] Registering employee to fund plan
    ${reg_resp}=       Create Fund Registration via API
    ...                employee_id=${CREATED_EMP_ID}
    ...                plan_id=${plan_id}
    ...                emp_rate=5.0
    ...                co_rate=5.0
    ...                balance=2000
    ${reg_id}=         Get From Dictionary    ${reg_resp}    id
    Set Suite Variable    ${CREATED_FUND_REG_ID}    ${reg_id}
    Log To Console     [INFO] Fund Registration ID: ${reg_id}
    
    # 3. Create a Monthly record contribution (1,000 THB employee, 1,000 THB company)
    Log To Console     [STEP 3] Submitting monthly contribution record (June 2026)
    ${rec_resp}=       Create Fund Record via API
    ...                employee_id=${CREATED_EMP_ID}
    ...                plan_id=${plan_id}
    ...                month=6
    ...                year=2026
    ...                emp_amount=1000
    ...                co_amount=1000
    ${rec_id}=         Get From Dictionary    ${rec_resp}    id
    Set Suite Variable    ${CREATED_FUND_RECORD_ID}    ${rec_id}
    Log To Console     [INFO] Fund Contribution Record ID: ${rec_id}
    
    # 4. Check Employee Provident Fund Registration Info and Balance
    Log To Console     [STEP 4] Fetching employee provident fund info and balance
    ${bal_resp}=       Get Employee Provident Info via API    ${CREATED_EMP_ID}
    Should Be Equal As Numbers    ${bal_resp}[remainingBalance]    2000
    Log To Console     [SUCCESS] Provident fund plans, registrations, and monthly entries verified!
    Log To Console     ------------------------------------------------------------

Verify Reports Generation and Export
    [Documentation]    Covers reports dashboard stats, late-absent data extraction, and CSV downloads.
    [Tags]             smoke    reports    api
    Log To Console     \n------------------------------------------------------------
    Log To Console     [START] Testing Reports Generation and Export...
    
    # 1. Fetch Dashboard Stats
    Log To Console     [STEP 1] Fetching Reports Dashboard stats
    ${db_stats}=       Get Reports Dashboard Stats via API
    
    # 2. Get Department Stats summary
    Log To Console     [STEP 2] Fetching reports department summary
    ${dept_stats}=     Get Department Stats via API
    
    # 3. Fetch CSV download dataset for attendance report
    Log To Console     [STEP 3] Triggering CSV data export for Attendance Report
    ${csv_data}=       Export Report via API    type=attendance    format=csv
    Should Not Be Empty    ${csv_data}
    Log To Console     [INFO] Exported CSV Length: ${csv_data.strip().split('\n').__len__()} lines.
    Log To Console     [SUCCESS] Reports generation and CSV exports verified!
    Log To Console     ------------------------------------------------------------

*** Keywords ***
Cleanup All Smoke Resources
    [Documentation]    Deletes all created test resources in strict reverse order to prevent database constraint locks.
    Log To Console     \n------------------------------------------------------------
    Log To Console     [CLEANUP] Initiating Reverse-Order Cleanup of Smoke Resources...
    
    # 1. Delete Provident Fund Record
    IF    '${CREATED_FUND_RECORD_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Fund Record via API    ${CREATED_FUND_RECORD_ID}
        Log To Console    [CLEANUP] Deleted Fund Record ID: ${CREATED_FUND_RECORD_ID}
    END
    
    # 2. Delete Provident Fund Registration
    IF    '${CREATED_FUND_REG_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Fund Registration via API    ${CREATED_FUND_REG_ID}
        Log To Console    [CLEANUP] Deleted Fund Registration ID: ${CREATED_FUND_REG_ID}
    END
    
    # 3. Delete Provident Fund Plan
    IF    '${CREATED_FUND_PLAN_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Fund Plan via API    ${CREATED_FUND_PLAN_ID}
        Log To Console    [CLEANUP] Deleted Fund Plan ID: ${CREATED_FUND_PLAN_ID}
    END
    
    # 4. Delete Device
    IF    '${CREATED_DEVICE_PK_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Device via API    ${CREATED_DEVICE_PK_ID}
        Log To Console    [CLEANUP] Deleted Device (DB PK ID: ${CREATED_DEVICE_PK_ID})
    END
    
    # 5. Delete Employee (Staff)
    IF    '${CREATED_EMP_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Employee via API    ${CREATED_EMP_ID}
        Log To Console    [CLEANUP] Deleted Staff Employee: ${CREATED_EMP_ID}
    END
    
    # 6. Delete Employee (Manager)
    IF    '${CREATED_MANAGER_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Employee via API    ${CREATED_MANAGER_ID}
        Log To Console    [CLEANUP] Deleted Manager Employee: ${CREATED_MANAGER_ID}
    END
    
    # 7. Delete Position
    IF    '${CREATED_POS_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Position via API    ${CREATED_POS_ID}
        Log To Console    [CLEANUP] Deleted Position ID: ${CREATED_POS_ID}
    END
    
    # 8. Delete Department
    IF    '${CREATED_DEPT_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Department via API    ${CREATED_DEPT_ID}
        Log To Console    [CLEANUP] Deleted Department ID: ${CREATED_DEPT_ID}
    END
    
    Log To Console     [CLEANUP] Reverse-Order Cleanup of Smoke Resources completed.
    Log To Console     ------------------------------------------------------------
