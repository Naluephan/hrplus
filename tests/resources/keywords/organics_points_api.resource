*** Settings ***
Documentation    Organics Points API Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Get Points Dashboard via API
    [Documentation]    Retrieves dashboard stats for Organics Points.
    ${response}=       Send GET Request Wrapper    /organics-points/dashboard    expected_status=200
    RETURN             ${response.json()}

List Points Employees via API
    [Documentation]    Retrieves points balances for employees.
    [Arguments]        ${search}=${None}    ${page}=1    ${limit}=10
    ${query}=          Set Variable    /organics-points/employees?page=${page}&limit=${limit}
    ${query}=          Run Keyword If    '${search}' != '${None}'    Set Variable    ${query}&search=${search}    ELSE    Set Variable    ${query}
    ${response}=       Send GET Request Wrapper    ${query}    expected_status=200
    RETURN             ${response.json()}

Get Points Employee Detail via API
    [Documentation]    Retrieves detailed points balance for a specific employee.
    [Arguments]        ${employee_id}
    ${response}=       Send GET Request Wrapper    /organics-points/employees/${employee_id}    expected_status=200
    RETURN             ${response.json()}

Update Employee Points via API
    [Documentation]    Updates (adds, subtracts, or sets) employee points balance.
    [Arguments]        ${employee_id}    ${balance_id}    ${type}    ${points}    ${reason}    ${operator_id}=00000000-0000-0000-0000-000000000000
    ${payload}=        Create Dictionary
    ...                balanceId=${balance_id}
    ...                type=${type}
    ...                points=${points}
    ...                reason=${reason}
    ...                operatorId=${operator_id}
    ${response}=       Send PATCH Request Wrapper    /organics-points/employees/${employee_id}/points    ${payload}    expected_status=200
    RETURN             ${response.json()}

Create Points Transaction via API
    [Documentation]    Creates points transaction for multiple employees.
    [Arguments]        ${employee_ids}    ${type}    ${points}    ${reason}    ${operator_id}=00000000-0000-0000-0000-000000000000
    ${payload}=        Create Dictionary
    ...                employeeIds=${employee_ids}
    ...                type=${type}
    ...                points=${points}
    ...                reason=${reason}
    ...                operatorId=${operator_id}
    ${response}=       Send POST Request Wrapper    /organics-points/transactions    ${payload}    expected_status=201
    RETURN             ${response.json()}

List Points Transactions via API
    [Documentation]    Retrieves list of points transactions.
    [Arguments]        ${page}=1    ${limit}=10
    ${response}=       Send GET Request Wrapper    /organics-points/transactions?page=${page}&limit=${limit}    expected_status=200
    RETURN             ${response.json()}
