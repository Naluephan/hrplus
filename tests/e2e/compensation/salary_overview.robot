*** Settings ***
Library    Browser    timeout=60s
Resource          ../../resources/common.resource
Resource          ../../resources/navigation.resource

*** Test Cases ***
User Can View Salary Overview Dashboard
    [Documentation]    ทดสอบการเข้าหน้าภาพรวมเงินเดือน (Salary Dashboard)
    [Tags]             smoke    compensation    salary_overview

    # 1. Login To Application
    Open HR Plus Application
    Login To Application
    
    # 2. ไปที่หน้า "ภาพรวมเงินเดือน" (Salary Dashboard)
    Navigate To Menu    compensation    compensation.salary.dashboard    /salary/dashboard
    
    # ตรวจสอบว่าเข้าหน้า /compensation/salary สำเร็จและรอจนหน้าเว็บโหลดเสร็จ
    Wait Until Keyword Succeeds    15s    1s    Check Url    /salary/dashboard
    Wait For Load State    networkidle    timeout=10s
