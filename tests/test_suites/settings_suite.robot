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
    Wait For Elements State    xpath=//h1 >> text="ข้อมูลบริษัท/สังกัด"    visible    timeout=10s
    Wait For Elements State    xpath=//div[contains(@class, 'rounded-[32px]')]    visible    timeout=5s
    Log    Company Settings page loaded successfully.

Verify Departments Settings Page
    [Documentation]    Verifies that the Departments Settings page loads and the Add button is visible.
    Login To Application
    Go To    ${URL}/settings/departments
    Wait For Elements State    xpath=//h1 >> text="แผนก"    visible    timeout=10s
    Wait For Elements State    xpath=//button[contains(., 'เพิ่มรายการ')]    visible    timeout=5s
    Log    Departments Settings page loaded successfully.

Verify Add Department Form Opens
    [Documentation]    Verifies that the Add Department form opens correctly.
    Login To Application
    Go To    ${URL}/settings/departments
    Wait For Elements State    xpath=//h1 >> text="แผนก"    visible    timeout=10s
    Click    xpath=//button[contains(., 'เพิ่มรายการ')]
    Wait For Elements State    xpath=//h2 >> text="เพิ่มข้อมูล"    visible    timeout=5s
    Wait For Elements State    xpath=//label[contains(text(), 'ชื่อแผนก (TH)')]    visible
    Wait For Elements State    xpath=//label[contains(text(), 'ชื่อแผนก (ENG)')]    visible
    Wait For Elements State    xpath=//label[contains(text(), 'รหัสย่อ (2 อักษร)')]    visible
    Log    Add Department form opened successfully.
