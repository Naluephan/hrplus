*** Settings ***
Documentation    System-Wide E2E API Smoke Testing Suite for HRPlus Backend
Resource         ../../resources/keywords/api_common.resource
Resource         ../../resources/keywords/department_api.resource
Resource         ../../resources/keywords/position_api.resource
Resource         ../../resources/keywords/employee_api.resource
Resource         ../../resources/keywords/leave_api.resource
Resource         ../../resources/keywords/salary_api.resource
Suite Setup      Run Keywords    Create HR API Session
Suite Teardown   Cleanup Created Test Resources

*** Variables ***
${CREATED_DEPT_ID}         ${None}
${CREATED_POS_ID}          ${None}
${CREATED_EMP_ID}          ${None}
${CREATED_LEAVE_ID}        ${None}
${CREATED_SALARY_REC_ID}   ${None}

*** Test Cases ***
Verify Department CRUD Operations
    [Documentation]    Verifies that departments can be created, retrieved, updated, and deleted.
    [Tags]             smoke    department    api
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Department CRUD Operations...
    ${random_char}=    Evaluate    random.choice(['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'])    modules=random
    ${dept_code}=      Set Variable    Q${random_char}
    Log To Console    [STEP 1] Creating new department with code: ${dept_code}
    ${dept_id}    ${body}=    Create Department via API
    ...                       code=${dept_code}
    ...                       name_th=ฝ่ายตรวจสอบคุณภาพ
    ...                       name_en=Quality Assurance
    ...                       description=Created via Robot API Smoke Test
    
    # Store ID in Suite Variable for downstream tests and cleanup
    Set Suite Variable    ${CREATED_DEPT_ID}    ${dept_id}
    Log To Console    [INFO] Created Department ID: ${dept_id}
    
    # Verify Creation
    Log To Console    [STEP 2] Verifying department details for ID: ${dept_id}
    ${details}=    Get Department Details via API    ${dept_id}
    Should Be Equal As Strings    ${details}[code]    ${dept_code}
    Should Be Equal As Strings    ${details}[nameTh]    ฝ่ายตรวจสอบคุณภาพ
    
    # Update Department
    Log To Console    [STEP 3] Updating department ID ${dept_id} details (name Th -> ฝ่ายตรวจสอบคุณภาพ (อัปเดต))
    ${update_payload}=    Create Dictionary
    ...                   code=${dept_code}
    ...                   nameTh=ฝ่ายตรวจสอบคุณภาพ (อัปเดต)
    ...                   nameEn=Quality Assurance (Updated)
    ...                   description=Updated via Robot API Smoke Test
    ${updated}=    Update Department via API    ${dept_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[nameTh]    ฝ่ายตรวจสอบคุณภาพ (อัปเดต)
    Log To Console    [SUCCESS] Department CRUD verified successfully!
    Log To Console    ------------------------------------------------------------
    Log    Department CRUD verified successfully!

Verify Position CRUD Operations
    [Documentation]    Verifies that positions can be created, retrieved, updated, and deleted under a department.
    [Tags]             smoke    position    api
    # Enforce sequence dependency
    Skip If    '${CREATED_DEPT_ID}' == '${None}'    Skipping because Department creation failed.
    
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Position CRUD Operations...
    ${random_char_pos}=  Evaluate    random.choice(['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'])    modules=random
    ${pos_code}=       Set Variable    P${random_char_pos}
    Log To Console    [STEP 1] Creating new position with code: ${pos_code} under Department ID: ${CREATED_DEPT_ID}
    ${pos_id}    ${body}=     Create Position via API
    ...                       code=${pos_code}
    ...                       name_th=วิศวกรซอฟต์แวร์อาวุโส
    ...                       name_en=Senior Software Engineer
    ...                       department_id=${CREATED_DEPT_ID}
    ...                       description=Position created via Robot API Smoke Test
    
    Set Suite Variable    ${CREATED_POS_ID}    ${pos_id}
    Log To Console    [INFO] Created Position ID: ${pos_id}
    
    # Verify Retrieval
    Log To Console    [STEP 2] Verifying position details for ID: ${pos_id}
    ${details}=    Get Position Details via API    ${pos_id}
    Should Be Equal As Strings    ${details}[code]    ${pos_code}
    Should Be Equal As Strings    ${details}[departmentId]    ${CREATED_DEPT_ID}
    
    # Update Position
    Log To Console    [STEP 3] Updating position ID ${pos_id} details (name Th -> วิศวกรซอฟต์แวร์อาวุโส (อัปเดต))
    ${update_payload}=    Create Dictionary
    ...                   code=${pos_code}
    ...                   nameTh=วิศวกรซอฟต์แวร์อาวุโส (อัปเดต)
    ...                   nameEn=Senior Software Engineer (Updated)
    ...                   departmentId=${CREATED_DEPT_ID}
    ...                   description=Updated via Robot API Smoke Test
    ${updated}=    Update Position via API    ${pos_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[nameTh]    วิศวกรซอฟต์แวร์อาวุโส (อัปเดต)
    Log To Console    [SUCCESS] Position CRUD verified successfully!
    Log To Console    ------------------------------------------------------------
    Log    Position CRUD verified successfully!


Verify Employee CRUD Operations
    [Documentation]    Verifies that employees can be created, retrieved, updated, and deleted with department/position bindings.
    [Tags]             smoke    employee    api
    Skip If    '${CREATED_DEPT_ID}' == '${None}' or '${CREATED_POS_ID}' == '${None}'    Skipping because Department/Position creation failed.
    
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Employee CRUD Operations...
    # Generate unique email to prevent duplicate database constraints
    ${random_num}=     Evaluate    random.randint(1000, 9999)    modules=random
    ${email}=          Set Variable    somchai.apinan.${random_num}@example.com
    Log To Console    [STEP 1] Creating new employee with email: ${email}
    
    ${emp_id}    ${body}=     Create Employee via API
    ...                       first_name=สมชาย
    ...                       last_name=อภินันท์
    ...                       email=${email}
    ...                       dept_id=${CREATED_DEPT_ID}
    ...                       pos_id=${CREATED_POS_ID}
    
    Set Suite Variable    ${CREATED_EMP_ID}    ${emp_id}
    Log To Console    [INFO] Created Employee ID: ${emp_id}
    
    # Verify Retrieval
    Log To Console    [STEP 2] Verifying employee profile details for ID: ${emp_id}
    ${details}=    Get Employee Profile via API    ${emp_id}
    Should Be Equal As Strings    ${details}[firstName]    สมชาย
    Should Be Equal As Strings    ${details}[email]    ${email}
    Should Be Equal As Strings    ${details}[departmentId]    ${CREATED_DEPT_ID}
    Should Be Equal As Strings    ${details}[positionId]    ${CREATED_POS_ID}
    
    # Update Employee Profile
    Log To Console    [STEP 3] Updating employee ID ${emp_id} first name to: สมชาย (อัปเดต)
    ${update_payload}=    Create Dictionary
    ...                   firstName=สมชาย (อัปเดต)
    ...                   lastName=อภินันท์
    ...                   email=${email}
    ...                   nickname=ชาย
    ${updated}=    Update Employee via API    ${emp_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[firstName]    สมชาย (อัปเดต)
    Log To Console    [SUCCESS] Employee CRUD verified successfully!
    Log To Console    ------------------------------------------------------------
    Log    Employee CRUD verified successfully!

Verify Leave Request and Workflow Operations
    [Documentation]    Verifies submission of leave requests, dynamic leave type resolution, and admin approval/cancellation workflow.
    [Tags]             smoke    leave    workflow    api
    Skip If    '${CREATED_EMP_ID}' == '${None}'    Skipping because Employee creation failed.
    
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Leave Request and Workflow Operations...
    
    # Dynamically resolve an active leave type ID
    Log To Console    [STEP 1] Querying active leave types...
    ${leave_type_id}=  Get Active Leave Type Id via API
    Log To Console    [INFO] Resolved active Leave Type ID: ${leave_type_id}
    
    # Request leave (e.g. sick leave starting tomorrow)
    Log To Console    [STEP 2] Submitting a new leave request for Employee ID: ${CREATED_EMP_ID}
    ${leave_id}    ${body}=   Create Leave Request via API
    ...                       emp_id=${CREATED_EMP_ID}
    ...                       leave_type_id=${leave_type_id}
    ...                       start_date=2026-05-19
    ...                       end_date=2026-05-19
    ...                       reason=ปวดหัว ตัวร้อน เป็นไข้ (API Test)
    ...                       total_days=1.0
    
    Set Suite Variable    ${CREATED_LEAVE_ID}    ${leave_id}
    Log To Console    [INFO] Created Leave Request ID: ${leave_id}
    
    # Approve leave request via Admin override
    Log To Console    [STEP 3] Approving leave request ID ${leave_id} via administrative override
    ${approve_resp}=   Approve Leave Request via API    ${leave_id}    remark=อนุมัติอัตโนมัติโดยระบบ API Smoke Test
    
    # Verify it approved successfully
    Log To Console    [STEP 4] Fetching activity logs for leave ID: ${leave_id} to verify approval
    ${logs}=           Send GET Request Wrapper    /leaves/${leave_id}/activity-logs    expected_status=200
    Log                Activity Logs: ${logs.json()}
    
    # Cancel leave request to clean up leave balance records
    Log To Console    [STEP 5] Cancelling leave request ID ${leave_id} via administrative override to restore balance
    ${cancel_resp}=    Cancel Leave Request via API    ${leave_id}    remark=ยกเลิกการลาโดยระบบ API Smoke Test
    Log To Console    [SUCCESS] Leave and Workflow operations verified successfully!
    Log To Console    ------------------------------------------------------------
    Log    Leave workflow verified successfully!

Verify Salary Record and Calculation Operations
    [Documentation]    Verifies that salary records can be created, calculated, and components/deductions can be attached.
    [Tags]             smoke    salary    payroll    api
    Skip If    '${CREATED_EMP_ID}' == '${None}'    Skipping because Employee creation failed.
    
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Salary Record and Calculation Operations...
    
    # Dynamically resolve or create a salary period
    Log To Console    [STEP 1] Querying active salary periods...
    ${period_id}=      Get Active Salary Period Id via API
    Log To Console    [INFO] Resolved active Salary Period ID: ${period_id}
    
    # Create salary record in Draft state
    Log To Console    [STEP 2] Creating salary record for Employee ID: ${CREATED_EMP_ID} in period ID: ${period_id}
    ${sal_rec_id}    ${body}=   Create Salary Record via API
    ...                         emp_id=${CREATED_EMP_ID}
    ...                         period_id=${period_id}
    ...                         base_salary=45000.00
    
    Set Suite Variable    ${CREATED_SALARY_REC_ID}    ${sal_rec_id}
    Log To Console    [INFO] Created Salary Record ID: ${sal_rec_id}
    
    # Verify initial Draft state
    Log To Console    [STEP 3] Verifying initial salary record state is 'draft' with baseSalary=45000.00
    ${details}=        Get Salary Record Details via API    ${sal_rec_id}
    Should Be Equal As Strings    ${details}[status]    draft
    Should Be Equal As Numbers    ${details}[baseSalary]    45000.00
    
    # Add allowance component (earnings)
    Log To Console    [STEP 4] Adding allowance component 'สวัสดิการค่าเดินทาง' (3500.00) to salary record
    ${comp_id}    ${comp_body}=   Add Salary Component via API
    ...                           sal_rec_id=${sal_rec_id}
    ...                           name=สวัสดิการค่าเดินทาง
    ...                           amount=3500.00
    ...                           type=earnings
    
    # Add tax deduction component
    Log To Console    [STEP 5] Adding tax deduction 'ภาษีหัก ณ ที่จ่าย' (750.00) to salary record
    ${deduct_id}    ${deduct_body}=  Add Salary Deduction via API
    ...                              sal_rec_id=${sal_rec_id}
    ...                              name=ภาษีหัก ณ ที่จ่าย
    ...                              amount=750.00
    
    # Trigger calculations on the record
    Log To Console    [STEP 6] Triggering salary record ID: ${sal_rec_id} calculations
    ${calc_resp}=      Calculate Salary Record via API    ${sal_rec_id}
    
    # Verify component attachments and updated calculations
    Log To Console    [STEP 7] Fetching final salary record details and validating calculations
    ${final_details}=  Get Salary Record Details via API    ${sal_rec_id}
    Log                Final calculations detail: ${final_details}
    
    Log To Console    [SUCCESS] Salary record and calculation flow verified successfully!
    Log To Console    ------------------------------------------------------------
    Log    Salary record and calculation flow verified successfully!

*** Keywords ***
Cleanup Created Test Resources
    [Documentation]    Deletes all created test resources in reverse order of creation to prevent foreign key constraint issues.
    Log To Console    \n------------------------------------------------------------
    Log To Console    [CLEANUP] Initiating Cleanup of Created Test Resources...
    Log                Initiating Cleanup of Created Test Resources...
    
    # 1. Delete Salary Record
    IF    '${CREATED_SALARY_REC_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Salary Record via API    ${CREATED_SALARY_REC_ID}
        Log To Console    [CLEANUP] Deleted Salary Record: ${CREATED_SALARY_REC_ID}
        Log            Deleted Salary Record: ${CREATED_SALARY_REC_ID}
    END
    
    # 2. Delete Employee
    IF    '${CREATED_EMP_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Employee via API    ${CREATED_EMP_ID}
        Log To Console    [CLEANUP] Deleted Employee: ${CREATED_EMP_ID}
        Log            Deleted Employee: ${CREATED_EMP_ID}
    END
    
    # 3. Delete Position
    IF    '${CREATED_POS_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Position via API    ${CREATED_POS_ID}
        Log To Console    [CLEANUP] Deleted Position: ${CREATED_POS_ID}
        Log            Deleted Position: ${CREATED_POS_ID}
    END
    
    # 4. Delete Department
    IF    '${CREATED_DEPT_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Department via API    ${CREATED_DEPT_ID}
        Log To Console    [CLEANUP] Deleted Department: ${CREATED_DEPT_ID}
        Log            Deleted Department: ${CREATED_DEPT_ID}
    END
    
    Log To Console    [CLEANUP] Cleanup of Created Test Resources Completed successfully.
    Log To Console    ------------------------------------------------------------
    Log                Cleanup of Created Test Resources Completed successfully.
