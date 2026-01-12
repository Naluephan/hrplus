*** Settings ***
Documentation     A test suite for the Settings functionality of HR Plus.
Resource          ../resources/common.resource
Test Setup        Open HR Plus Application
Test Teardown     Close Application

*** Test Cases ***
Verify Company Settings Page
    [Documentation]    Verifies that the Company Settings page loads correctly.
    Login To Application
    Go To    ${URL}/settings/company
    Wait Until Element Contains    xpath://h1    ข้อมูลบริษัท/สังกัด    timeout=10s
    Wait Until Element Is Visible    xpath://div[contains(@class, 'rounded-[32px]')]    timeout=5s
    Log    Company Settings page loaded successfully.

Verify Departments Settings Page
    [Documentation]    Verifies that the Departments Settings page loads and the Add button is visible.
    Login To Application
    Go To    ${URL}/settings/departments
    Wait Until Element Contains    xpath://h1    แผนก    timeout=10s
    Wait Until Page Contains Element    xpath://button[contains(., 'เพิ่มรายการ')]    timeout=5s
    Log    Departments Settings page loaded successfully.

Verify Add Department Form Opens
    [Documentation]    Verifies that the Add Department form opens correctly.
    Login To Application
    Go To    ${URL}/settings/departments
    Wait Until Element Contains    xpath://h1    แผนก    timeout=10s
    Click Button    xpath://button[contains(., 'เพิ่มรายการ')]
    Wait Until Element Contains    xpath://h2    เพิ่มข้อมูล    timeout=5s
    Wait Until Page Contains Element    xpath://label[contains(text(), 'ชื่อแผนก (TH)')]
    Wait Until Page Contains Element    xpath://label[contains(text(), 'ชื่อแผนก (ENG)')]
    Wait Until Page Contains Element    xpath://label[contains(text(), 'รหัสย่อ (2 อักษร)')]
    Log    Add Department form opened successfully.
