*** Settings ***
Documentation    Test Case สำหรับการสร้างตำแหน่งงาน สร้างลิงก์รับสมัคร และผู้สมัครเข้ามากรอกแบบฟอร์ม
Library          Browser    timeout=60s
Resource         ../../resources/common.resource
Resource         ../../resources/navigation.resource

Suite Setup      Open HR Plus Application    load_session=False

*** Test Cases ***
HR Can Create Job Posting And Applicant Can Apply
    [Tags]    smoke    recruitment

    # 1. Login To Application (HR Role)
    Login To Application

    # 2. Navigate to Recruitment -> Jobs directly (Avoid sidebar UI flakiness)
    Go To    ${URL}/recruitment/jobs
    Wait Until Keyword Succeeds    15s    1s    Verify Url Match    .*/recruitment/jobs.*

    # 3. Create Job
    Wait For Elements State    css=a[href="/recruitment/jobs/create"]    visible    timeout=15s
    Click    css=a[href="/recruitment/jobs/create"]
    
    ${nav_success}=    Run Keyword And Return Status    Wait Until Keyword Succeeds    5s    1s    Verify Url Match    .*/recruitment/jobs/create.*
    IF    not ${nav_success}
        Go To    ${URL}/recruitment/jobs/create
    END
    
    ${mock_btn}=    Set Variable    css=[data-testid="mockButton"]
    Wait For Elements State    ${mock_btn}    visible    timeout=10s
    Click    ${mock_btn}

    # Save Job
    Wait For Elements State    xpath=//button[contains(text(), "บันทึก")]    enabled    timeout=10s
    Click    xpath=//button[contains(text(), "บันทึก")]

    # Wait until returned to jobs page
    Wait For Elements State    xpath=//a[contains(@href, '/recruitment/jobs/create') or contains(text(), 'สร้างตำแหน่งงาน')]    visible    timeout=15s

    # 4. Create Recruitment Link
    # Switch tab to Links - target the tab button inside the tab bar (not the dashboard stats card)
    # The tab bar is a div with border-b border-border containing inline-flex buttons
    ${links_tab}=    Set Variable    xpath=//div[contains(@class, 'border-b')]//button[contains(., 'ลิงก์รับสมัคร') or contains(., 'Recruitment Links')]
    Wait For Elements State    ${links_tab}    visible    timeout=10s
    Click    ${links_tab}
    
    # Wait for LinksTab content to load (async API call)
    Wait Until Keyword Succeeds    15s    2s    Wait For Elements State    xpath=//a[contains(@href, '/recruitment/links/create')]    visible    timeout=3s
    Click    xpath=//a[contains(@href, '/recruitment/links/create')]


    # Fill Link Form (use data-testid instead of locale-dependent placeholder)
    Wait For Elements State    css=[data-testid="recruitment.links.form.title"]    visible    timeout=15s
    Fill Text    css=[data-testid="recruitment.links.form.title"]    Automated Recruitment URL
    
    # Select Job from Job Selector (Click the first available job card)
    Wait For Elements State    xpath=(//form//div[contains(@class, 'grid')]//button)[1]    visible    timeout=10s
    Click    xpath=(//form//div[contains(@class, 'grid')]//button)[1]

    Click    xpath=//button[@type="submit"]

    # Wait until returned to links page
    Wait For Loading To Hide
    Wait Until Keyword Succeeds    15s    2s    Wait For Elements State    xpath=//a[contains(@href, '/recruitment/links/create')]    visible    timeout=3s

    # 5. Extract Generated Link and Navigate to Applicant View
    Wait For Elements State    xpath=(//a[contains(@href, '/recruit/')])[1]    visible    timeout=10s
    ${recruit_link}=    Get Attribute    xpath=(//a[contains(@href, '/recruit/')])[1]    href
    
    # Navigate to the recruitment portal as an applicant
    Go To    ${recruit_link}

    # 6. Applicant Form Flow
    Wait Until Keyword Succeeds    30s    2s    Wait For Elements State    xpath=//a[contains(., 'ดูรายละเอียดและสมัครงาน')]    visible    timeout=3s
    Click    xpath=//a[contains(., 'ดูรายละเอียดและสมัครงาน')] >> nth=0
    
    # Wait for navigation to job details page (URL: /recruit/{token}/{jobId})
    Wait Until Keyword Succeeds    30s    1s    Verify Url Match    .*/recruit/[^/]+/[^/]+.*

    Wait For Elements State    css=a[href$="/apply"]    visible    timeout=15s
    Click    css=a[href$="/apply"]
    Wait For Load State    networkidle    timeout=30s

    ${mock_btn}=    Set Variable    [data-testid="apply-mock-btn"]
    Wait Until Keyword Succeeds    30s    2s    Wait For Elements State    ${mock_btn}    visible    timeout=3s
    Click    ${mock_btn}

    Wait For Elements State    xpath=//button[@type="submit" and contains(., 'ส่งใบสมัคร')]    enabled    timeout=10s
    Click    xpath=//button[@type="submit" and contains(., 'ส่งใบสมัคร')]

    # 7. Verify Success and Return
    # Using normalize-space() and increasing timeout for reliability
    Wait For Elements State    xpath=//a[contains(@href, '/recruit/') and contains(normalize-space(.), 'ดูตำแหน่งงานอื่น')]    visible    timeout=30s
    Click    xpath=//a[contains(@href, '/recruit/') and contains(normalize-space(.), 'ดูตำแหน่งงานอื่น')]
