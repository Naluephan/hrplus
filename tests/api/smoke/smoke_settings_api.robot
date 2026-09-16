*** Settings ***
Documentation    System-Wide E2E API Smoke Testing Suite for Settings Modules in HRPlus Backend
Resource         ../../resources/keywords/api_common.resource
Resource         ../../resources/keywords/level_api.resource
Resource         ../../resources/keywords/employment_type_api.resource
Resource         ../../resources/keywords/benefit_api.resource
Resource         ../../resources/keywords/holiday_api.resource
Suite Setup      Run Keywords    Create HR API Session
Suite Teardown   Cleanup Settings Test Resources

*** Variables ***
${CREATED_LEVEL_ID}          ${None}
${CREATED_EMP_TYPE_ID}       ${None}
${CREATED_BENEFIT_ID}        ${None}
${CREATED_HOLIDAY_YEAR_ID}   ${None}
${CREATED_HOLIDAY_DAY_ID}    ${None}

*** Test Cases ***
Verify Levels API CRUD Operations
    [Documentation]    Verifies that settings levels can be created, retrieved, updated, and deleted.
    [Tags]             smoke    settings    level    api
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Levels API CRUD Operations...
    
    ${rand_num}=       Evaluate    random.randint(100, 999)    modules=random
    ${level_val}=      Evaluate    random.randint(50, 100)    modules=random
    ${level_name}=     Set Variable    Auto Level ${rand_num}
    
    Log To Console    [STEP 1] Creating new level: ${level_name} (Value: ${level_val})
    ${level_id}    ${body}=    Create Level via API
    ...                        name_th=${level_name}
    ...                        level=${level_val}
    ...                        name_en=${level_name} EN
    ...                        description=Created via Robot API Smoke Test
    
    Set Suite Variable    ${CREATED_LEVEL_ID}    ${level_id}
    Log To Console    [INFO] Created Level ID: ${level_id}
    
    # Verify Creation and List Retrieval
    Log To Console    [STEP 2] Verifying level details in list
    ${list}=    List Levels via API
    ${found}=   Set Variable    ${FALSE}
    FOR    ${item}    IN    @{list}
        ${id}=    Get From Dictionary    ${item}    id
        IF    '${id}' == '${level_id}'
            ${found}=    Set Variable    ${TRUE}
            Should Be Equal As Strings    ${item}[nameTh]    ${level_name}
            BREAK
        END
    END
    Should Be True    ${found}    Created level not found in list.
    
    # Update Level
    Log To Console    [STEP 3] Updating level details (nameTh -> ${level_name} (อัปเดต))
    ${update_payload}=    Create Dictionary
    ...                   nameTh=${level_name} (อัปเดต)
    ...                   level=${level_val}
    ${updated}=    Update Level via API    ${level_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[nameTh]    ${level_name} (อัปเดต)
    Log To Console    [SUCCESS] Levels API CRUD verified successfully!
    Log To Console    ------------------------------------------------------------

Verify Employment Types API CRUD Operations
    [Documentation]    Verifies that employment types can be created, retrieved, updated, and deleted.
    [Tags]             smoke    settings    employment-type    api
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Employment Types API CRUD Operations...
    
    ${rand_num}=       Evaluate    random.randint(100, 999)    modules=random
    ${type_name}=      Set Variable    Auto Type ${rand_num}
    
    Log To Console    [STEP 1] Creating new employment type: ${type_name}
    ${type_id}    ${body}=    Create Employment Type via API
    ...                        name=${type_name}
    ...                        description=Created via Robot API Smoke Test
    
    Set Suite Variable    ${CREATED_EMP_TYPE_ID}    ${type_id}
    Log To Console    [INFO] Created Employment Type ID: ${type_id}
    
    # Verify Retrieval
    Log To Console    [STEP 2] Verifying employment type in list
    ${list}=    List Employment Types via API
    ${found}=   Set Variable    ${FALSE}
    FOR    ${item}    IN    @{list}
        ${id}=    Get From Dictionary    ${item}    id
        IF    '${id}' == '${type_id}'
            ${found}=    Set Variable    ${TRUE}
            Should Be Equal As Strings    ${item}[name]    ${type_name}
            BREAK
        END
    END
    Should Be True    ${found}    Created employment type not found in list.
    
    # Update Employment Type
    Log To Console    [STEP 3] Updating employment type details (name -> ${type_name} (อัปเดต))
    ${update_payload}=    Create Dictionary
    ...                   name=${type_name} (อัปเดต)
    ...                   description=Updated via Robot API Smoke Test
    ${updated}=    Update Employment Type via API    ${type_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[name]    ${type_name} (อัปเดต)
    Log To Console    [SUCCESS] Employment Types API CRUD verified successfully!
    Log To Console    ------------------------------------------------------------

Verify Benefits API CRUD Operations
    [Documentation]    Verifies that benefits can be created, retrieved, updated, and deleted.
    [Tags]             smoke    settings    benefit    api
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Benefits API CRUD Operations...
    
    ${rand_num}=       Evaluate    random.randint(100, 999)    modules=random
    ${benefit_name}=   Set Variable    Auto Benefit ${rand_num}
    
    Log To Console    [STEP 1] Creating new benefit: ${benefit_name}
    ${benefit_id}    ${body}=    Create Benefit via API
    ...                        name=${benefit_name}
    ...                        benefit_type=required
    ...                        description=Created via Robot API Smoke Test
    
    Set Suite Variable    ${CREATED_BENEFIT_ID}    ${benefit_id}
    Log To Console    [INFO] Created Benefit ID: ${benefit_id}
    
    # Verify Retrieval
    Log To Console    [STEP 2] Verifying benefit in list
    ${list_resp}=    List Benefits via API
    ${items}=        Get From Dictionary    ${list_resp}    items
    ${found}=        Set Variable    ${FALSE}
    FOR    ${item}    IN    @{items}
        ${id}=    Get From Dictionary    ${item}    id
        IF    '${id}' == '${benefit_id}'
            ${found}=    Set Variable    ${TRUE}
            Should Be Equal As Strings    ${item}[name]    ${benefit_name}
            BREAK
        END
    END
    Should Be True    ${found}    Created benefit not found in list.
    
    # Update Benefit
    Log To Console    [STEP 3] Updating benefit details (name -> ${benefit_name} (อัปเดต))
    ${update_payload}=    Create Dictionary
    ...                   name=${benefit_name} (อัปเดต)
    ...                   benefitType=required
    ...                   description=Updated via Robot API Smoke Test
    ${updated}=    Update Benefit via API    ${benefit_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[name]    ${benefit_name} (อัปเดต)
    Log To Console    [SUCCESS] Benefits API CRUD verified successfully!
    Log To Console    ------------------------------------------------------------

Verify Holidays and Days API CRUD Operations
    [Documentation]    Verifies that holiday calendar years and daily schedules can be created, retrieved, updated, and deleted.
    [Tags]             smoke    settings    holiday    api
    Log To Console    \n------------------------------------------------------------
    Log To Console    [START] Testing Holidays and Days API CRUD Operations...
    
    ${rand_year}=      Evaluate    random.randint(2030, 2040)    modules=random
    Log To Console    [STEP 1] Creating new holiday year calendar: ${rand_year}
    ${year_id}    ${year_body}=    Create Holiday Year via API
    ...                            year=${rand_year}
    ...                            description=Created via Robot API Smoke Test
    
    Set Suite Variable    ${CREATED_HOLIDAY_YEAR_ID}    ${year_id}
    Log To Console    [INFO] Created Holiday Year ID: ${year_id}
    
    # Verify Year Retrieval
    Log To Console    [STEP 2] Verifying holiday year in list
    ${year_list}=    List Holiday Years via API
    ${year_found}=   Set Variable    ${FALSE}
    FOR    ${item}    IN    @{year_list}
        ${id}=    Get From Dictionary    ${item}    id
        IF    ${id} == ${year_id}
            ${year_found}=    Set Variable    ${TRUE}
            Should Be Equal As Integers    ${item}[year]    ${rand_year}
            BREAK
        END
    END
    Should Be True    ${year_found}    Created holiday year not found in list.
    
    # Create Holiday Day
    ${day_name}=      Set Variable    Auto วันหยุดสงกรานต์ ${rand_year}
    Log To Console    [STEP 3] Creating new holiday day: ${day_name}
    ${day_id}    ${day_body}=    Create Holiday Day via API
    ...                          holiday_year_id=${year_id}
    ...                          name=${day_name}
    ...                          date_start=${rand_year}-04-13
    ...                          date_end=${rand_year}-04-15
    ...                          type=1
    ...                          description=Songkran Festival API Test
    
    Set Suite Variable    ${CREATED_HOLIDAY_DAY_ID}    ${day_id}
    Log To Console    [INFO] Created Holiday Day ID: ${day_id}
    
    # Verify Holiday Day Retrieval
    Log To Console    [STEP 4] Verifying holiday day via query-by-year
    ${days_resp}=    List Holiday Days by Year via API    holiday_year_id=${year_id}    year=${rand_year}
    ${day_found}=    Set Variable    ${FALSE}
    FOR    ${item}    IN    @{days_resp}
        ${id}=    Get From Dictionary    ${item}    id
        IF    ${id} == ${day_id}
            ${day_found}=    Set Variable    ${TRUE}
            Should Be Equal As Strings    ${item}[name]    ${day_name}
            BREAK
        END
    END
    Should Be True    ${day_found}    Created holiday day not found in year schedule.
    
    # Update Holiday Day
    Log To Console    [STEP 5] Updating holiday day (name -> ${day_name} (อัปเดต))
    ${update_payload}=    Create Dictionary
    ...                   name=${day_name} (อัปเดต)
    ...                   dateStart=${rand_year}-04-13
    ...                   dateEnd=${rand_year}-04-15
    ...                   holidayYearId=${year_id}
    ${updated}=    Update Holiday Day via API    ${day_id}    ${update_payload}
    Should Be Equal As Strings    ${updated}[name]    ${day_name} (อัปเดต)
    
    Log To Console    [SUCCESS] Holidays and Days API CRUD verified successfully!
    Log To Console    ------------------------------------------------------------

*** Keywords ***
Cleanup Settings Test Resources
    [Documentation]    Deletes all created test resources in reverse order to prevent foreign key or database constraint issues.
    Log To Console    \n------------------------------------------------------------
    Log To Console    [CLEANUP] Initiating Cleanup of Settings Test Resources...
    
    # 1. Delete Holiday Day
    IF    '${CREATED_HOLIDAY_DAY_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Holiday Day via API    ${CREATED_HOLIDAY_DAY_ID}
        Log To Console    [CLEANUP] Deleted Holiday Day: ${CREATED_HOLIDAY_DAY_ID}
    END
    
    # 2. Delete Holiday Year
    IF    '${CREATED_HOLIDAY_YEAR_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Holiday Year via API    ${CREATED_HOLIDAY_YEAR_ID}
        Log To Console    [CLEANUP] Deleted Holiday Year: ${CREATED_HOLIDAY_YEAR_ID}
    END
    
    # 3. Delete Benefit
    IF    '${CREATED_BENEFIT_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Benefit via API    ${CREATED_BENEFIT_ID}
        Log To Console    [CLEANUP] Deleted Benefit: ${CREATED_BENEFIT_ID}
    END
    
    # 4. Delete Employment Type
    IF    '${CREATED_EMP_TYPE_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Employment Type via API    ${CREATED_EMP_TYPE_ID}
        Log To Console    [CLEANUP] Deleted Employment Type: ${CREATED_EMP_TYPE_ID}
    END
    
    # 5. Delete Level
    IF    '${CREATED_LEVEL_ID}' != '${None}'
        Run Keyword And Ignore Error    Delete Level via API    ${CREATED_LEVEL_ID}
        Log To Console    [CLEANUP] Deleted Level: ${CREATED_LEVEL_ID}
    END
    
    Log To Console    [CLEANUP] Cleanup of Settings Test Resources completed successfully.
    Log To Console    ------------------------------------------------------------
