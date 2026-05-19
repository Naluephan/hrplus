*** Settings ***
Documentation     Smoke tests for new Leave functionality (Edit and Cancel).
Resource          ../../../resources/common/browser.resource
Resource          ../../../resources/pages/leaves_page.resource
Test Setup        Open App With Auth State    role=admin
Test Teardown     Close App

*** Variables ***
# Note: These IDs should be updated based on seeded test data
${PENDING_LEAVE_ID}           PLACEHOLDER_PENDING_ID
${APPROVED_FUTURE_LEAVE_ID}    PLACEHOLDER_APPROVED_FUTURE_ID
${APPROVED_PAST_LEAVE_ID}      PLACEHOLDER_APPROVED_PAST_ID

*** Test Cases ***
Verify Actions For Pending Leave
    [Documentation]    Pending leave should have both Edit and Cancel buttons.
    [Tags]    smoke    leaves
    Navigate To Leave Requests Page
    Verify Edit Button Visible For Leave      ${PENDING_LEAVE_ID}
    Verify Cancel Button Visible For Leave    ${PENDING_LEAVE_ID}

Verify Actions For Approved Future Leave
    [Documentation]    Approved leave at least 1 day in advance should have Cancel button but no Edit button.
    [Tags]    smoke    leaves
    Navigate To Leave Requests Page
    Verify Cancel Button Visible For Leave    ${APPROVED_FUTURE_LEAVE_ID}
    Verify Edit Button Not Visible For Leave    ${APPROVED_FUTURE_LEAVE_ID}

Verify Actions For Approved Past Or Today Leave
    [Documentation]    Approved leave on the same day or in the past should not have Cancel or Edit buttons.
    [Tags]    smoke    leaves
    Navigate To Leave Requests Page
    Verify Cancel Button Not Visible For Leave    ${APPROVED_PAST_LEAVE_ID}
    Verify Edit Button Not Visible For Leave      ${APPROVED_PAST_LEAVE_ID}

User Can Open Edit Modal For Pending Leave
    [Documentation]    Clicking edit on a pending leave should open the edit modal.
    [Tags]    smoke    leaves
    Navigate To Leave Requests Page
    Open Edit Leave Modal    ${PENDING_LEAVE_ID}
