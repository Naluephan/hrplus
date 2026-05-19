*** Settings ***
Documentation     Test Case สำหรับรายงานวันเกิดพนักงาน (Birthday Report)
Resource          ../../resources/common.resource

Test Setup        Open HR Plus Application    load_session=True
Test Teardown     Close Browser

*** Test Cases ***
HR Can View Birthday Report
    [Tags]    smoke    report    birthday
    
    # 1. Login To Application
    Login To Application
    
    # 2. Navigate to Birthday Report directly
    Go To    ${URL}/report/birthday
    Wait Until Keyword Succeeds    15s    1s    Verify Url Match    .*/report/birthday.*
    
    # 3. Verify Page Content
    # รอให้ข้อมูลโหลดและแสดงผลกราฟ/สรุป
    Wait For Elements State    css=[data-testid="report.birthday.page.root"]    visible    timeout=30s
    Wait For Elements State    css=[data-testid="report.birthday.overview.title"]    visible    timeout=15s
    Wait For Elements State    css=[data-testid="report.birthday.chart.title"]    visible    timeout=15s
    Wait For Elements State    css=[data-testid="report.birthday.summary.total"]    visible    timeout=15s
