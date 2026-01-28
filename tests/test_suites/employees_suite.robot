*** Settings ***
Documentation       A test suite for the Employees module.
Resource            ../resources/common.resource

Library             String

Suite Setup         Run Keywords    Open HR Plus Application    AND    Login To Application
Suite Teardown      Close Browser

*** Variables ***
${EMPLOYEES_URL}    ${URL}/employees

*** Test Cases ***
# Navigate To Employees Page
    # [Documentation]    Verify navigation to the Employees module from the sidebar.
    # [Tags]    critical    employees    navigation
    # Go To    ${URL}/dashboard
    # Wait For Elements State    css=[data-testid="sidebar.section.sidebar.people"]    visible    timeout=30s
    # Click    css=[data-testid="sidebar.section.sidebar.people"]
    # Wait For Elements State    css=[data-testid="sidebar.item.sidebar.people.list"]    visible    timeout=10s
    # Click    css=[data-testid="sidebar.item.sidebar.people.list"]
    
    # # Verify we are on the correct page
    # Wait For Elements State    css=[data-testid="employees.toolbar.add"]    visible    timeout=30s
    # Wait Until Keyword Succeeds    10s    1s    Check Url    /employees

# Create Employee Step 1
#     [Documentation]    Verify filling and submitting the first step of employee creation.
#     [Tags]    critical    employees    crud
    
#     # Navigate to Create
#     Go To    ${EMPLOYEES_URL}
#     Wait For Elements State    css=[data-testid="employees.toolbar.add"]    visible    timeout=30s
#     Click    css=[data-testid="employees.toolbar.add"]
#     Wait Until Keyword Succeeds    10s    1s    Check Url    /employees/create
    
#     # Generate Data
#     ${random_id}=    Generate Random String    4    [NUMBERS]
#     ${first_name}=    Set Variable    AutoUser${random_id}
#     ${last_name}=     Set Variable    Test
#     ${email}=         Set Variable    auto.user.${random_id}@example.com
#     ${phone}=         Generate Random String    10    [NUMBERS]
#     ${id_card}=       Generate Random String    13    [NUMBERS]
    
#     # Fill Form: Identity
#     # Prefix (Dropdown) - Selecting first option
#     Click    css=[data-testid="employees.form.prefix"]
#     Click    xpath=(//div[@role="option"])[1]
    
#     Fill Text    css=[data-testid="employees.form.firstName"]    ${first_name}
#     Fill Text    css=[data-testid="employees.form.lastName"]     ${last_name}
#     Fill Text    css=[data-testid="employees.form.nickname"]     TestNick
    
#     # Fill Form: Contact
#     Fill Text    css=[data-testid="employees.form.phone"]        ${phone}
#     Fill Text    css=[data-testid="employees.form.email"]        ${email}
    
#     # Fill Form: ID Card (Only if Thai citizen, which is default)
#     Fill Text    css=[data-testid="employees.form.idCardNumber"]    ${id_card}
    
#     # Fill Form: Dates/Dropdowns
#     # Birth Date - For simplicity, if it's a date picker, we might need specific handling. 
#     # Attempting to type if possible, or skip if not strictly blocking (frontend said required)
#     # Assuming we can type YYYY-MM-DD or similar? Or just click and pick today.
#     # For now, let's try to skip and see if validation blocks us, or try to select if it blocks.
#     # Actually, let's try to select a date if possible.
#     # Click    css=[data-testid="employees.form.birthDate"]
#     # Click    xpath=//button[contains(@class, "rdp-day_today")]    # Click today if calendar opens
    
#     # Gender
#     Click    css=[data-testid="employees.form.gender"]
#     Click    xpath=(//div[@role="option"])[1]
    
#     # Blood Type
#     Click    css=[data-testid="employees.form.bloodType"]
#     Click    xpath=(//div[@role="option"])[1]
    
#     # Personality
#     Click    css=[data-testid="employees.form.personalityId"]
#     Click    xpath=(//div[@role="option"])[1]
    
#     # Submit Step 1
#     Click    css=[data-testid="wizard.button.next"]
    
#     # Verify Step 2 Page Load (Meaning Step 1 passed)
#     Wait Until Keyword Succeeds    30s    1s    Check Url    /employees/create/step/2
