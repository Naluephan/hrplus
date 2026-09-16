*** Settings ***
Documentation    Reports API Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Get Reports Dashboard Stats via API
    [Documentation]    Retrieves stats for the reports dashboard.
    ${response}=       Send GET Request Wrapper    /reports/dashboard    expected_status=200
    RETURN             ${response.json()}

Get Monthly Summary Report via API
    [Documentation]    Retrieves monthly summary report for a specific year and month.
    [Arguments]        ${year}    ${month}
    ${response}=       Send GET Request Wrapper    /reports/monthly/${year}/${month}    expected_status=200
    RETURN             ${response.json()}

Get Department Stats via API
    [Documentation]    Retrieves stats grouped by departments.
    ${response}=       Send GET Request Wrapper    /reports/departments    expected_status=200
    RETURN             ${response.json()}

Get Late Absent Report via API
    [Documentation]    Retrieves late and absent report records.
    [Arguments]        ${start_date}=${None}    ${end_date}=${None}    ${dept_id}=${None}    ${employee_id}=${None}
    ${query}=          Set Variable    /reports/late-absent?
    ${query}=          Run Keyword If    '${start_date}' != '${None}'    Set Variable    ${query}startDate=${start_date}&    ELSE    Set Variable    ${query}
    ${query}=          Run Keyword If    '${end_date}' != '${None}'      Set Variable    ${query}endDate=${end_date}&        ELSE    Set Variable    ${query}
    ${query}=          Run Keyword If    '${dept_id}' != '${None}'       Set Variable    ${query}departmentId=${dept_id}&    ELSE    Set Variable    ${query}
    ${query}=          Run Keyword If    '${employee_id}' != '${None}'   Set Variable    ${query}employeeId=${employee_id}&  ELSE    Set Variable    ${query}
    ${response}=       Send GET Request Wrapper    ${query}    expected_status=200
    RETURN             ${response.json()}

Export Report via API
    [Documentation]    Exports a report in csv or excel format.
    [Arguments]        ${type}    ${format}=csv    ${start_date}=${None}    ${end_date}=${None}    ${dept_id}=${None}    ${employee_id}=${None}
    ${query}=          Set Variable    /reports/export/${type}?format=${format}&
    ${query}=          Run Keyword If    '${start_date}' != '${None}'    Set Variable    ${query}startDate=${start_date}&    ELSE    Set Variable    ${query}
    ${query}=          Run Keyword If    '${end_date}' != '${None}'      Set Variable    ${query}endDate=${end_date}&        ELSE    Set Variable    ${query}
    ${query}=          Run Keyword If    '${dept_id}' != '${None}'       Set Variable    ${query}departmentId=${dept_id}&    ELSE    Set Variable    ${query}
    ${query}=          Run Keyword If    '${employee_id}' != '${None}'   Set Variable    ${query}employeeId=${employee_id}&  ELSE    Set Variable    ${query}
    ${response}=       Send GET Request Wrapper    ${query}    expected_status=200
    # Returns raw text (CSV contents)
    RETURN             ${response.text}
