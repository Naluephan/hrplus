*** Settings ***
Documentation    Holiday and Day Resource Keywords for HTTP API Testing
Resource         api_common.resource

*** Keywords ***
Create Holiday Year via API
    [Documentation]    Creates a new holiday calendar year.
    [Arguments]        ${year}    ${description}=${None}    ${tenant_id}=${DEFAULT_TENANT_ID}
    ${tenant_num}=     Convert To Integer    ${tenant_id}
    ${year_num}=       Convert To Integer    ${year}
    ${payload}=        Create Dictionary
    ...                year=${year_num}
    ...                tenantId=${tenant_num}
    Run Keyword If     '${description}' != '${None}'   Set To Dictionary    ${payload}    description=${description}
    ${response}=       Send POST Request Wrapper    /holiday-years    ${payload}    expected_status=201
    ${year_id}=        Get From Dictionary    ${response.json()}    id
    Log                Holiday Year created with ID: ${year_id}
    RETURN             ${year_id}    ${response.json()}

List Holiday Years via API
    [Documentation]    Retrieves holiday calendar years.
    [Arguments]        ${tenant_id}=${DEFAULT_TENANT_ID}
    ${response}=       Send GET Request Wrapper    /holiday-years?tenantId=${tenant_id}    expected_status=200
    RETURN             ${response.json()}

Update Holiday Year via API
    [Documentation]    Updates a holiday calendar year.
    [Arguments]        ${year_id}    ${payload}
    ${response}=       Send PATCH Request Wrapper    /holiday-years/${year_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Holiday Year via API
    [Documentation]    Deletes a holiday calendar year.
    [Arguments]        ${year_id}
    ${response}=       Send DELETE Request Wrapper    /holiday-years/${year_id}    expected_status=200
    RETURN             ${response}

Create Holiday Day via API
    [Documentation]    Creates a new holiday day under a calendar year.
    [Arguments]        ${holiday_year_id}    ${name}    ${date_start}    ${date_end}    ${type}=${1}    ${description}=${None}    ${tenant_id}=${DEFAULT_TENANT_ID}
    ${tenant_num}=     Convert To Integer    ${tenant_id}
    ${year_id_num}=    Convert To Integer    ${holiday_year_id}
    ${type_num}=       Convert To Integer    ${type}
    ${payload}=        Create Dictionary
    ...                holidayYearId=${year_id_num}
    ...                name=${name}
    ...                dateStart=${date_start}
    ...                dateEnd=${date_end}
    ...                type=${type_num}
    ...                tenantId=${tenant_num}
    Run Keyword If     '${description}' != '${None}'   Set To Dictionary    ${payload}    description=${description}
    ${response}=       Send POST Request Wrapper    /holiday-year-days    ${payload}    expected_status=201
    ${day_id}=         Get From Dictionary    ${response.json()}    id
    Log                Holiday Day created with ID: ${day_id}
    RETURN             ${day_id}    ${response.json()}

List Holiday Days by Year via API
    [Documentation]    Retrieves holiday days for a calendar year.
    [Arguments]        ${holiday_year_id}    ${year}    ${tenant_id}=${DEFAULT_TENANT_ID}
    ${tenant_num}=     Convert To Integer    ${tenant_id}
    ${year_num}=       Convert To Integer    ${year}
    ${year_id_num}=    Convert To Integer    ${holiday_year_id}
    ${payload}=        Create Dictionary
    ...                tenantId=${tenant_num}
    ...                year=${year_num}
    ...                holidayYearId=${year_id_num}
    ${response}=       Send POST Request Wrapper    /holiday-year-days/by-year    ${payload}    expected_status=201
    RETURN             ${response.json()}

Update Holiday Day via API
    [Documentation]    Updates a holiday day.
    [Arguments]        ${day_id}    ${payload}
    ${response}=       Send PATCH Request Wrapper    /holiday-year-days/${day_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Holiday Day via API
    [Documentation]    Deletes a holiday day.
    [Arguments]        ${day_id}
    ${response}=       Send DELETE Request Wrapper    /holiday-year-days/${day_id}    expected_status=200
    RETURN             ${response}
