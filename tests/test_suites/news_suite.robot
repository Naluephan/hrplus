*** Settings ***
Resource    ../resources/common.resource
Test Setup  Open HR Plus Application
Test Teardown  Close Application

*** Test Cases ***
Verify News Page Elements
    [Documentation]    Verify that the News page loads and displays key elements.
    [Tags]    critical
    # Debugging steps
    Go To    ${URL}/login
    Sleep    2s
    
    # Login
    Wait For Elements State    id=login-email    visible    timeout=30s
    Fill Text    id=login-email    ${LOGIN_EMAIL}
    Fill Text    id=login-password    ${LOGIN_PASSWORD}
    Click    xpath=//button[@type='submit']
    
    # Wait briefly for dashboard, but don't fail if it takes too long
    # We will try to go to News page directly which is our goal
    Run Keyword And Ignore Error    Wait For Condition    Url    contains    /dashboard    timeout=10s
    
    # Try forcing navigation to News
    Go To    ${URL}/news
    
    # Check if we are on news page (implies login success)
    Wait For Condition    Url    contains    /news    timeout=30s
    
    # Debug page source if failed by checking title
    # Note: 'text=' selector is strict in Playwright, so we use 'contains' logic or regex if needed.
    # Text="ประกาศ และข่าวสาร" should match if exact, but let's be safe.
    # Using 'text=...' matches substring or exact depending on quotes? 
    # Browser library strategy: text=foo matches element containing foo (case insensitive fuzzy) or "foo" (exact).
    # "ประกาศ และข่าวสาร" is usually exact or substring.
    ${status}=    Run Keyword And Return Status    Wait For Elements State    text="ประกาศ และข่าวสาร"    visible    timeout=20s
    Run Keyword If    not ${status}    Log Page Source
    
    Should Be True    ${status}    msg=Failed to load News page content (Title not found)
    
    # Manage button is a Link, so check for element with text
    Get Element    xpath=//a[contains(text(), 'จัดการประกาศและข่าวสาร')]
    Get Element    xpath=//button[contains(text(), 'ค้นหา')]

Search News With No Results
    [Documentation]    Verifies that searching for a non-existent term returns no results.
    [Tags]    negative
    Login To Application
    Go To    ${URL}/news
    Wait For Condition    Url    contains    /news    timeout=30s
    Fill Text    xpath=//input[@type='search']    NonExistentNews123
    # Click search button if exists, or just wait for results (assuming real-time/enter key)
    # Previous test used Click Button ค้นหา, so we keep a click attempt or just wait.
    # If the button 'ค้นหา' is strictly a button, we use 'button >> text=ค้นหา'.
    # If it's just text 'ค้นหา' somewhere that looked like a button...
    # Let's try to just wait for result first.
    Wait For Elements State    text="ยังไม่มีประกาศในขณะนี้"    visible    timeout=10s

*** Keywords ***
Log Page Source
    ${html}=    Get Page Source
    Log    Page Source on Failure: ${html[:2000]}
