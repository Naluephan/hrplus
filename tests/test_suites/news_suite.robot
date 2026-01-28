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
    Go To    ${NEWS_URL}
    
    # Ready State Markers
    Wait For Elements State    css=[data-testid="news.page.loading"]    hidden    timeout=15s
    Wait For Elements State    css=[data-testid="news.page.ready"]    attached    timeout=10s
    
    # Root & Toolbar
    Wait For Elements State    css=[data-testid="news.page.root"]    visible
    Wait For Elements State    css=[data-testid="news.toolbar.manage"]    visible

Create News Announcement
    [Documentation]    Verifies that a new news announcement can be created via Admin.
    [Tags]    critical    news    crud
    Login To Application
    Go To    ${NEWS_ADMIN_URL}
    
    # Admin Ready State
    Wait For Elements State    css=[data-testid="news.admin.loading"]    hidden    timeout=15s
    Wait For Elements State    css=[data-testid="news.admin.ready"]    attached    timeout=10s
    
    # Open Form
    Click    css=[data-testid="news.admin.add"]
    
    # Fill Form
    ${RANDOM_STR}=    Generate Random String    8    [LETTERS]
    ${TITLE}=         Set Variable    Test News ${RANDOM_STR}
    Fill Text    css=[data-testid="news.form.title.input"]    ${TITLE}
    Fill Text    css=[data-testid="news.form.description.input"]    Description for ${TITLE}
    
    # Date/Time
    Fill Text    css=[data-testid="news.form.publishedDate.input"]    2025-12-31
    Fill Text    css=[data-testid="news.form.publishedTime.input"]    09:00
    
    # No Expire
    Click    css=[data-testid="news.form.noExpire.checkbox"]
    
    # Submit
    Wait For Elements State    css=[data-testid="news.form.submit"]    enabled    timeout=10s
    Click    css=[data-testid="news.form.submit"]
    
    # Check validation
    ${is_error}=    Run Keyword And Return Status    Wait For Elements State    text="กรุณากรอก"    visible    timeout=2s
    IF    ${is_error}
        Log    Form validation failed!
        Fail    Form validation failed
    END
    
    # Verify Modal Closes (Success)
    Wait For Elements State    css=[data-testid="news.form.title.input"]    hidden    timeout=30s
    Wait For Elements State    text=${TITLE}    visible    timeout=15s

Edit News Announcement
    [Documentation]    Verifies that an existing news item can be edited.
    [Tags]    critical    news    crud
    Login To Application
    Ensure News Item Exists
    
    # Find first row and click edit
    ${edit_btn}=    Set Variable    css=button[data-testid*=".action.edit"]
    Wait For Elements State    ${edit_btn} >> nth=0    visible    timeout=15s
    Click    ${edit_btn} >> nth=0
    
    # Wait for Modal
    Wait For Elements State    css=[data-testid="news.form.title.input"]    visible    timeout=10s
    
    # Modify Title
    ${EDIT_STR}=    Generate Random String    4    [NUMBERS]
    ${NEW_TITLE}=   Set Variable    Edited News ${EDIT_STR}
    Fill Text    css=[data-testid="news.form.title.input"]    ${NEW_TITLE}
    
    # Submit
    Wait For Elements State    css=[data-testid="news.form.submit"]    enabled    timeout=5s
    Click    css=[data-testid="news.form.submit"]
    
    # Verify Modal Closes
    Wait For Elements State    css=[data-testid="news.form.title.input"]    hidden    timeout=20s
    Wait For Elements State    text=${NEW_TITLE}    visible    timeout=15s

Delete News Announcement
    [Documentation]    Verifies that a news item can be deleted.
    [Tags]    critical    news    crud
    Login To Application
    Ensure News Item Exists
    
    # Click Delete on first row
    ${delete_btn}=    Set Variable    css=button[data-testid*=".action.delete"]
    Wait For Elements State    ${delete_btn} >> nth=0    visible    timeout=15s
    Click    ${delete_btn} >> nth=0
    
    # Confirm in Dialog
    Wait For Elements State    css=[data-testid="news.admin.delete.dialog"]    visible    timeout=10s
    Click    css=[data-testid="news.admin.delete.confirm"]
    
    # Verify disappearance of dialog
    Wait For Elements State    css=[data-testid="news.admin.delete.dialog"]    hidden    timeout=15s

*** Keywords ***
Ensure News Item Exists
    Go To    ${NEWS_ADMIN_URL}
    Wait For Elements State    css=[data-testid="news.admin.loading"]    hidden    timeout=15s
    Wait For Elements State    css=[data-testid="news.admin.ready"]    attached    timeout=10s
    
    # Explicitly look for ROWS to avoid matching buttons
    ${row_selector}=    Set Variable    css=tr[data-testid^="news.admin.table.row."]
    ${has_items}=    Run Keyword And Return Status    Wait For Elements State    ${row_selector} >> nth=0    visible    timeout=5s
    
    IF    not ${has_items}
        Log    No news items found or not loaded yet. Checking empty state...
        ${is_empty}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid="news.admin.table.empty"]    visible    timeout=2s
        IF    ${is_empty}
            Log    Creating auto-news...
            Click    css=[data-testid="news.admin.add"]
            Wait For Elements State    css=[data-testid="news.form.title.input"]    visible    timeout=5s
            Fill Text    css=[data-testid="news.form.title.input"]    Auto Created News
            Fill Text    css=[data-testid="news.form.description.input"]    Auto created for testing.
            Fill Text    css=[data-testid="news.form.publishedDate.input"]    2025-01-01
            Fill Text    css=[data-testid="news.form.publishedTime.input"]    00:00
            Click    css=[data-testid="news.form.noExpire.checkbox"]
            Click    css=[data-testid="news.form.submit"]
            Wait For Elements State    css=[data-testid="news.form.title.input"]    hidden    timeout=15s
            # Wait for any row after creation
            Wait For Elements State    ${row_selector} >> nth=0    visible    timeout=15s
        ELSE
            Log    Neither rows nor empty state found. Retrying wait for rows...
            Wait For Elements State    ${row_selector} >> nth=0    visible    timeout=15s
        END
    END
    
    # Final check for edit button to ensure interactivity
    Wait For Elements State    css=button[data-testid*=".action.edit"] >> nth=0    visible    timeout=15s
