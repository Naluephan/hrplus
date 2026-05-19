*** Settings ***
Documentation     A test suite for the News functionality of HR Plus.
Resource          ../resources/common.resource
Library           String
Test Setup        Open HR Plus Application
Test Teardown     Close Application

*** Variables ***
${NEWS_URL}          ${URL}/news
${NEWS_ADMIN_URL}    ${URL}/news/admin

*** Test Cases ***
Verify News Page Elements
    [Documentation]    Verify that the News page loads and displays key elements.
    [Tags]    critical    news
    Login To Application
    Go To    ${NEWS_URL}    wait_until=domcontentloaded
    
    # Ready State Markers
    Wait For Elements State    text="ประกาศ และข่าวสาร"    visible    timeout=60s
    # Wait for loading to finish if visible
    ${is_loading}=    Run Keyword And Return Status    Wait For Elements State    text="กำลังโหลดประกาศ..."    visible    timeout=2s
    IF    ${is_loading}
        Wait For Elements State    text="กำลังโหลดประกาศ..."    hidden    timeout=60s
    END
    
    # Root & Toolbar
    Wait For Elements State    text="จัดการประกาศและข่าวสาร"    visible

Verify News Card Interactions
    [Documentation]    Verify clicking news cards and buttons opens the detail modal.
    [Tags]    critical    news    ui
    Login To Application
    Go To    ${NEWS_URL}    wait_until=domcontentloaded
    
    # Ensure content exists (Wait for cards)
    Wait For Elements State    css=article h2 >> nth=0    visible    timeout=60s
    
    # TEST 1: Click Card Body (excluding button)
    Click    css=article >> nth=0
    
    # Verify Modal Opens
    Wait For Elements State    css=[role="dialog"]    visible    timeout=30s
    
    # Close Modal
    Press Keys    css=body    Escape
    Wait For Elements State    css=[role="dialog"]    hidden    timeout=30s
    
    # TEST 2: Click Read More Button explicitly
    Click    xpath=(//button[contains(., "ดูเพิ่มเติม")])[1]
    
    # Verify Modal Opens
    Wait For Elements State    css=[role="dialog"]    visible    timeout=30s
    
    # Close Modal
    Press Keys    css=body    Escape
    Wait For Elements State    css=[role="dialog"]    hidden    timeout=30s

Create News Announcement
    [Documentation]    Verifies that a new news announcement can be created via Admin.
    [Tags]    critical    news    crud
    Login To Application
    Go To    ${NEWS_ADMIN_URL}    wait_until=domcontentloaded
    
    # Admin Ready State
    Wait For Elements State    text="จัดการประกาศและข่าวสาร"    visible    timeout=60s
    Wait For Loading To Hide
    
    # Open Form
    Click    text="เพิ่มรายการใหม่"
    
    # Fill Form
    ${RANDOM_STR}=    Generate Random String    8    [LETTERS]
    ${TITLE}=         Set Variable    Test News ${RANDOM_STR}
    Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    visible    timeout=10s
    Fill Text    input[placeholder="กรุณากรอกหัวข้อ"]    ${TITLE}
    Fill Text    textarea[placeholder="กรุณากรอกรายละเอียด"]    Description for ${TITLE}
    
    # Date/Time (Native inputs can be tricky, ensured they are Fillable)
    Fill Text    input[type="date"] >> nth=0    2025-12-31
    Fill Text    input[type="time"]    09:00
    
    # No Expire
    ${is_checked}=    Get Checkbox State    input[type="checkbox"]
    IF    not ${is_checked}
        Click    input[type="checkbox"]
    END
    
    # Submit
    Click    css=button[type="submit"] >> text="ยืนยัน"
    
    # Verify Modal Closes (Success)
    Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    hidden    timeout=60s
    Wait For Elements State    xpath=//td[contains(., "${TITLE}")]    visible    timeout=60s

Edit News Announcement
    [Documentation]    Verifies that an existing news item can be edited.
    [Tags]    critical    news    crud
    Login To Application
    Ensure News Item Exists
    
    # Find first row and click edit
    ${edit_btn}=    Set Variable    css=button[aria-label="แก้ไข"]
    Wait For Elements State    ${edit_btn} >> nth=0    visible    timeout=30s
    Click    ${edit_btn} >> nth=0
    
    # Wait for Modal
    Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    visible    timeout=30s
    
    # Modify Title
    ${EDIT_STR}=    Generate Random String    4    [NUMBERS]
    ${NEW_TITLE}=   Set Variable    Edited News ${EDIT_STR}
    Fill Text    input[placeholder="กรุณากรอกหัวข้อ"]    ${NEW_TITLE}
    
    # Submit
    Click    css=button[type="submit"] >> text="ยืนยัน"
    
    # Verify Modal Closes (robust with fallback)
    ${closed}=    Run Keyword And Return Status
    ...    Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    hidden    timeout=60s
    IF    not ${closed}
        Log    WARNING: News edit modal stuck after save. Attempting recovery...
        Press Keys    css=body    Escape
        ${still_open}=    Run Keyword And Return Status
        ...    Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    visible    timeout=2s
        IF    ${still_open}
            Go To    ${NEWS_ADMIN_URL}    wait_until=domcontentloaded
            Wait For Loading To Hide
        END
    END
    Wait For Elements State    xpath=//td[contains(., "${NEW_TITLE}")]    visible    timeout=30s

Delete News Announcement
    [Documentation]    Verifies that a news item can be deleted.
    [Tags]    critical    news    crud
    Login To Application
    Ensure News Item Exists
    
    # Click Delete on first row
    ${delete_btn}=    Set Variable    css=button[aria-label="ลบ"]
    Wait For Elements State    ${delete_btn} >> nth=0    visible    timeout=15s
    Click    ${delete_btn} >> nth=0
    
    # Confirm in Dialog
    Wait For Elements State    text="ลบรายการนี้หรือไม่?"    visible    timeout=10s
    Click    css=button:has-text("ยืนยัน")
    
    # Verify disappearance of dialog
    Wait For Elements State    text="ลบรายการนี้หรือไม่?"    hidden    timeout=30s

*** Keywords ***
Ensure News Item Exists
    Go To    ${NEWS_ADMIN_URL}    wait_until=domcontentloaded
    Wait For Elements State    text="กำลังโหลด..."    hidden    timeout=15s
    Wait For Elements State    text="จัดการประกาศและข่าวสาร"    visible    timeout=10s
    
    # Explicitly look for ROWS to avoid matching buttons
    ${row_selector}=    Set Variable    css=tbody tr
    ${has_items}=    Run Keyword And Return Status    Wait For Elements State    ${row_selector} >> nth=0    visible    timeout=5s
    
    IF    not ${has_items}
        Log    No news items found or not loaded yet. Checking empty state...
        ${is_empty}=    Run Keyword And Return Status    Wait For Elements State    text="ไม่พบข้อมูล"    visible    timeout=2s
        IF    ${is_empty}
            Log    Creating auto-news...
            Click    text="เพิ่มรายการใหม่"
            Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    visible    timeout=5s
            Fill Text    input[placeholder="กรุณากรอกหัวข้อ"]    Auto Created News
            Fill Text    textarea[placeholder="กรุณากรอกรายละเอียด"]    Auto created for testing.
            Fill Text    input[type="date"] >> nth=0    2025-01-01
            Fill Text    input[type="time"]    00:00
            Click    input[type="checkbox"]
            Click    css=button[type="submit"] >> text="ยืนยัน"
            Wait For Elements State    input[placeholder="กรุณากรอกหัวข้อ"]    hidden    timeout=15s
            # Wait for any row after creation
            Wait For Elements State    ${row_selector} >> nth=0    visible    timeout=15s
        ELSE
            Log    Neither rows nor empty state found. Retrying wait for rows...
            Wait For Elements State    ${row_selector} >> nth=0    visible    timeout=15s
        END
    END
    
    # Final check for edit button to ensure interactivity
    Wait For Elements State    css=button[aria-label="แก้ไข"] >> nth=0    visible    timeout=15s
