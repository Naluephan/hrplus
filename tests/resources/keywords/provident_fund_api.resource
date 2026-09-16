*** Settings ***
Documentation    Provident Fund API Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
# ==================== Fund Plans ====================
Create Fund Plan via API
    [Documentation]    Creates a new Provident Fund plan.
    [Arguments]        ${code}    ${name}    ${desc}=Robot created plan    ${min_emp}=2.0    ${max_emp}=15.0    ${def_emp}=5.0    ${min_co}=2.0    ${max_co}=15.0    ${def_co}=5.0
    ${payload}=        Create Dictionary
    ...                code=${code}
    ...                name=${name}
    ...                description=${desc}
    ...                minEmployeeRate=${min_emp}
    ...                maxEmployeeRate=${max_emp}
    ...                defaultEmployeeRate=${def_emp}
    ...                minCompanyRate=${min_co}
    ...                maxCompanyRate=${max_co}
    ...                defaultCompanyRate=${def_co}
    ${response}=       Send POST Request Wrapper    /provident-funds/plans    ${payload}    expected_status=201
    RETURN             ${response.json()}

List Fund Plans via API
    [Documentation]    Retrieves list of Provident Fund plans.
    ${response}=       Send GET Request Wrapper    /provident-funds/plans    expected_status=200
    RETURN             ${response.json()}

Get Fund Plan Details via API
    [Documentation]    Retrieves details of a specific fund plan.
    [Arguments]        ${plan_id}
    ${response}=       Send GET Request Wrapper    /provident-funds/plans/${plan_id}    expected_status=200
    RETURN             ${response.json()}

Update Fund Plan via API
    [Documentation]    Updates fund plan details.
    [Arguments]        ${plan_id}    ${payload}
    ${response}=       Send PATCH Request Wrapper    /provident-funds/plans/${plan_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Fund Plan via API
    [Documentation]    Deletes a specific fund plan by ID.
    [Arguments]        ${plan_id}
    ${response}=       Send DELETE Request Wrapper    /provident-funds/plans/${plan_id}    expected_status=200
    RETURN             ${response}

# ==================== Registrations ====================
Create Fund Registration via API
    [Documentation]    Registers an employee to a fund plan.
    [Arguments]        ${employee_id}    ${plan_id}    ${emp_rate}=5.0    ${co_rate}=5.0    ${balance}=0    ${status}=active
    ${payload}=        Create Dictionary
    ...                employeeId=${employee_id}
    ...                fundPlanId=${plan_id}
    ...                employeeContributionRate=${emp_rate}
    ...                companyContributionRate=${co_rate}
    ...                remainingBalance=${balance}
    ...                status=${status}
    ${response}=       Send POST Request Wrapper    /provident-funds/registrations    ${payload}    expected_status=201
    RETURN             ${response.json()}

List Fund Registrations via API
    [Documentation]    Retrieves list of employee registrations.
    [Arguments]        ${page}=1    ${limit}=10
    ${response}=       Send GET Request Wrapper    /provident-funds/registrations?page=${page}&limit=${limit}    expected_status=200
    RETURN             ${response.json()}

Get Fund Registration Details via API
    [Arguments]        ${reg_id}
    ${response}=       Send GET Request Wrapper    /provident-funds/registrations/${reg_id}    expected_status=200
    RETURN             ${response.json()}

Update Fund Registration via API
    [Arguments]        ${reg_id}    ${payload}
    ${response}=       Send PATCH Request Wrapper    /provident-funds/registrations/${reg_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Fund Registration via API
    [Documentation]    Deletes an employee fund registration by ID.
    [Arguments]        ${reg_id}
    ${response}=       Send DELETE Request Wrapper    /provident-funds/registrations/${reg_id}    expected_status=200
    RETURN             ${response}

# ==================== Records ====================
Create Fund Record via API
    [Documentation]    Creates a monthly contribution record for an employee.
    [Arguments]        ${employee_id}    ${plan_id}    ${month}    ${year}    ${emp_amount}=${None}    ${co_amount}=${None}    ${data_source}=manual
    ${payload}=        Create Dictionary
    ...                employeeId=${employee_id}
    ...                fundPlanId=${plan_id}
    ...                month=${month}
    ...                year=${year}
    ...                dataSource=${data_source}
    Run Keyword If     '${emp_amount}' != '${None}'    Set To Dictionary    ${payload}    employeeContributionAmount=${emp_amount}
    Run Keyword If     '${co_amount}' != '${None}'     Set To Dictionary    ${payload}    companyContributionAmount=${co_amount}
    # Wait, note that RequestsLibrary/Robot has a minor glitch if we call Set To Dictionary twice. We'll do it cleanly.
    ${response}=       Send POST Request Wrapper    /provident-funds/records    ${payload}    expected_status=201
    RETURN             ${response.json()}

List Fund Records via API
    [Documentation]    Retrieves list of monthly fund contribution records.
    [Arguments]        ${employee_id}=${None}    ${page}=1    ${limit}=10
    ${query}=          Set Variable    /provident-funds/records?page=${page}&limit=${limit}
    ${query}=          Run Keyword If    '${employee_id}' != '${None}'    Set Variable    ${query}&employeeId=${employee_id}    ELSE    Set Variable    ${query}
    ${response}=       Send GET Request Wrapper    ${query}    expected_status=200
    RETURN             ${response.json()}

Get Fund Record Details via API
    [Arguments]        ${record_id}
    ${response}=       Send GET Request Wrapper    /provident-funds/records/${record_id}    expected_status=200
    RETURN             ${response.json()}

Delete Fund Record via API
    [Documentation]    Deletes a monthly contribution record by ID.
    [Arguments]        ${record_id}
    ${response}=       Send DELETE Request Wrapper    /provident-funds/records/${record_id}    expected_status=200
    RETURN             ${response}

Get Employee Fund Balance via API
    [Documentation]    Retrieves the provident fund balance and stats for an employee.
    [Arguments]        ${employee_id}
    ${response}=       Send GET Request Wrapper    /provident-funds/employees/${employee_id}/balance    expected_status=200
    RETURN             ${response.json()}

Get Employee Provident Info via API
    [Documentation]    Retrieves detailed provident fund registration and info for an employee.
    [Arguments]        ${employee_id}
    ${response}=       Send GET Request Wrapper    /provident-funds/employees/${employee_id}/info    expected_status=200
    RETURN             ${response.json()}

