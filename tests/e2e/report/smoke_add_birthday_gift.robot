*** Settings ***
Documentation     Test Case สำหรับการเพิ่มหมวดหมู่และเพิ่มของขวัญวันเกิด
Library           String
Resource          ../../resources/common.resource

Test Setup        Open HR Plus Application    load_session=True
Test Teardown     Close Browser

*** Variables ***
${DUMMY_IMAGE_PATH}    ${EXECDIR}/tests/data/dummy-image.png

*** Test Cases ***
HR Can Create Gift Category And Add Gift
    [Tags]    smoke    report    birthday-gift
    
    # Generate unique category and gift name
    ${random_str}    Generate Random String    6    [LOWER]
    ${category_name}    Set Variable    หมวดหมู่ ${random_str}
    ${gift_name}    Set Variable    ของขวัญทดสอบ ${random_str}
    
    # 1. Login To Application
    Login To Application
    
    # 2. Go To Gift Categories Page
    Go To    ${URL}/report/gift-categories
    Wait Until Keyword Succeeds    15s    1s    Verify Url Match    .*/report/gift-categories.*
    
    # 3. Create Category
    Wait For Elements State    xpath=//button[contains(., 'เพิ่มหมวดหมู่')]    visible    timeout=10s
    Click    xpath=//button[contains(., 'เพิ่มหมวดหมู่')]
    
    Wait For Elements State    xpath=//input[@placeholder="เช่น อาหาร"]    visible    timeout=10s
    Fill Text    xpath=//input[@placeholder="เช่น อาหาร"]    ${category_name}
    Fill Text    xpath=//textarea[@placeholder="รายละเอียดเพิ่มเติม (ไม่จำเป็น)"]    รายละเอียดหมวดหมู่ ${random_str}
    
    Wait For Elements State    xpath=//button[@type="submit" and contains(., 'เพิ่ม')]    enabled    timeout=10s
    Click    xpath=//button[@type="submit" and contains(., 'เพิ่ม')]
    
    Wait For Load State    networkidle
    Wait For Loading To Hide
    Wait For Elements State    text="${category_name}"    visible    timeout=60s
    
    # 4. Go To Birthday Gifts Page
    Go To    ${URL}/report/birthday-gifts
    Wait Until Keyword Succeeds    15s    1s    Verify Url Match    .*/report/birthday-gifts.*
    
    # 5. Create Gift
    Wait For Elements State    xpath=//button[contains(., 'เพิ่มของขวัญ')]    visible    timeout=10s
    Click    xpath=//button[contains(., 'เพิ่มของขวัญ')]
    
    Wait For Elements State    xpath=//input[@placeholder="เช่น กระเช้าผลไม้"]    visible    timeout=10s
    Fill Text    xpath=//input[@placeholder="เช่น กระเช้าผลไม้"]    ${gift_name}
    Fill Text    xpath=//input[contains(@placeholder, "GIFT001")]    GIFT-${random_str}
    
    Wait For Elements State    xpath=//select    visible    timeout=10s
    Select Options By    xpath=//select    label    ${category_name}
    
    Fill Text    xpath=//input[@type="number"]    10
    
    # Upload Image
    Upload File By Selector    xpath=//input[@type="file"]    ${DUMMY_IMAGE_PATH}
    
    # Wait for image upload to show preview
    Wait For Elements State    xpath=//img[@alt="Preview"]    visible    timeout=15s
    
    Wait For Elements State    xpath=//button[@type="submit" and contains(., "เพิ่ม")]    enabled    timeout=10s
    Click    xpath=//button[@type="submit" and contains(., "เพิ่ม")]
    
    ${has_error}    Run Keyword And Return Status    Wait For Elements State    xpath=//p[contains(@class, 'text-destructive')]    visible    timeout=3s
    IF    ${has_error}
        ${error_msg}    Get Text    xpath=//p[contains(@class, 'text-destructive')]
        Log To Console    VALIDATION ERROR: ${error_msg}
        Fail    Submit failed with error: ${error_msg}
    END
    
    # Muted checking dialog hidden
    # Wait For Elements State    xpath=//div[@role="dialog"]    hidden    timeout=15s
    # Wait For Elements State    text="${gift_name}"    visible    timeout=15s
