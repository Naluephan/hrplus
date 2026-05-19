*** Settings ***
Documentation    Salary and Payroll Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Get Active Salary Period Id via API
    [Documentation]    Fetches list of salary periods and returns the first active one. If none exist, it creates a new default one.
    ${response}=       Send GET Request Wrapper    /salary-periods    expected_status=200
    ${data}=           Get From Dictionary    ${response.json()}    data
    ${length}=         Get Length    ${data}
    IF    ${length} > 0
        ${period_id}=  Get From Dictionary    ${data}[0]    id
        ${name}=       Get From Dictionary    ${data}[0]    periodName
        Log            Found existing Salary Period: ${name} with ID: ${period_id}
        RETURN         ${period_id}
    END
    
    # Otherwise, provision a new default salary period
    Log                No existing Salary Periods found. Auto-provisioning a new period...
    ${payload}=        Create Dictionary
    ...                month=${5}
    ...                year=${2026}
    ...                periodCode=P202605
    ...                periodName=May 2026 API Period
    ...                startDate=2026-05-01
    ...                endDate=2026-05-31
    ...                payDate=2026-05-28
    ...                status=${0}
    ${post_resp}=      Send POST Request Wrapper    /salary-periods    ${payload}    expected_status=201
    ${new_id}=         Get From Dictionary    ${post_resp.json()}    id
    Log                Auto-provisioned Salary Period: May 2026 API Period with ID: ${new_id}
    RETURN             ${new_id}

Create Salary Record via API
    [Documentation]    Creates a new salary record for an employee in a salary period.
    [Arguments]        ${emp_id}    ${period_id}    ${base_salary}=35000.00
    ${payload}=        Create Dictionary
    ...                employeeId=${emp_id}
    ...                periodId=${period_id}
    ...                baseSalary=${base_salary}
    ...                status=draft
    ${response}=       Send POST Request Wrapper    /salary-records    ${payload}    expected_status=201
    ${sal_rec_id}=     Get From Dictionary    ${response.json()}    id
    Log                Salary record created successfully with ID: ${sal_rec_id}
    RETURN             ${sal_rec_id}    ${response.json()}

Get Salary Record Details via API
    [Documentation]    Retrieves salary record details by ID.
    [Arguments]        ${sal_rec_id}
    ${response}=       Send GET Request Wrapper    /salary-records/${sal_rec_id}    expected_status=200
    RETURN             ${response.json()}

Calculate Salary Record via API
    [Documentation]    Triggers payroll calculation for a salary record.
    [Arguments]        ${sal_rec_id}
    ${response}=       Send POST Request Wrapper    /salary-records/${sal_rec_id}/calculate    ${None}    expected_status=201
    Log                Salary record ${sal_rec_id} calculation triggered.
    RETURN             ${response.json()}

Add Salary Component via API
    [Documentation]    Adds an earnings or allowance component to a salary record.
    [Arguments]        ${sal_rec_id}    ${name}    ${amount}    ${type}=earnings
    ${comp_resp}=      Send GET Request Wrapper    /salary-components    expected_status=200
    ${comp_list}=      Set Variable    ${comp_resp.json()}
    ${comp_id}=        Set Variable    ${None}
    FOR    ${comp}    IN    @{comp_list}
        ${code}=       Get From Dictionary    ${comp}    code
        IF    '${code}' == 'ALLOWANCE_TRANSPORT'
            ${comp_id}=  Get From Dictionary    ${comp}    id
            BREAK
        END
    END
    IF    '${comp_id}' == '${None}'
        ${comp_id}=    Get From Dictionary    ${comp_list}[0]    id
    END
    ${amount_num}=     Convert To Number    ${amount}
    ${payload}=        Create Dictionary
    ...                componentId=${comp_id}
    ...                amount=${amount_num}
    ...                description=${name}
    ${response}=       Send POST Request Wrapper    /salary-records/${sal_rec_id}/components    ${payload}    expected_status=201
    ${component_id}=   Get From Dictionary    ${response.json()}    id
    Log                Added component '${name}' with ID: ${component_id}
    RETURN             ${component_id}    ${response.json()}

Add Salary Deduction via API
    [Documentation]    Adds a deduction component to a salary record.
    [Arguments]        ${sal_rec_id}    ${name}    ${amount}
    ${deduct_resp}=    Send GET Request Wrapper    /salary-deductions    expected_status=200
    ${deduct_list}=    Set Variable    ${deduct_resp.json()}
    ${deduct_id}=      Set Variable    ${None}
    FOR    ${deduct}    IN    @{deduct_list}
        ${code}=       Get From Dictionary    ${deduct}    code
        IF    '${code}' == 'TAX'
            ${deduct_id}=  Get From Dictionary    ${deduct}    id
            BREAK
        END
    END
    IF    '${deduct_id}' == '${None}'
        ${deduct_id}=  Get From Dictionary    ${deduct_list}[0]    id
    END
    ${amount_num}=     Convert To Number    ${amount}
    ${payload}=        Create Dictionary
    ...                deductionId=${deduct_id}
    ...                amount=${amount_num}
    ...                description=${name}
    ${response}=       Send POST Request Wrapper    /salary-records/${sal_rec_id}/deductions    ${payload}    expected_status=201
    ${deduction_id}=   Get From Dictionary    ${response.json()}    id
    Log                Added deduction '${name}' with ID: ${deduction_id}
    RETURN             ${deduction_id}    ${response.json()}

Delete Salary Record via API
    [Documentation]    Deletes a salary record by ID.
    [Arguments]        ${sal_rec_id}
    ${response}=       Send DELETE Request Wrapper    /salary-records/${sal_rec_id}    expected_status=200
    RETURN             ${response}
