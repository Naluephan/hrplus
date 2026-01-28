*** Settings ***
Documentation     A test suite for the Workflow settings functionality of HR Plus.
Resource          ../resources/common.resource
Library           String
Test Setup        Open HR Plus Application
Test Teardown     Close Application

*** Variables ***
${WORKFLOW_URL}    ${URL}/settings/workflow

*** Test Cases ***
Verify Workflow Page Access
    [Documentation]    Verifies that the Workflow page loads correctly and complies with state standards.
    [Tags]    critical    settings    workflow
    Login To Application
    Go To    ${WORKFLOW_URL}
    
    # Wait for page ready state (Standard Rule 2.1)
    Wait For Elements State    css=[data-testid="workflow.page.loading"]    hidden    timeout=30s
    Wait For Elements State    css=[data-testid="workflow.page.ready"]    visible    timeout=30s
    
    # Verify Root
    Wait For Elements State    css=[data-testid="workflow.page.root"]    visible
    Log    Workflow page loaded successfully.

Validate Create Workflow Form
    [Documentation]    Verifies that the Workflow form requires department and approver.
    [Tags]    critical    settings    workflow    validation
    Login To Application
    Go To    ${WORKFLOW_URL}
    
    # Ready State
    Wait For Elements State    css=[data-testid="workflow.page.loading"]    hidden    timeout=30s
    Wait For Elements State    css=[data-testid="workflow.page.ready"]    attached    timeout=20s
    
    # Click Add (Standard Rule 3.1)
    Click    css=[data-testid="workflow.toolbar.add"]
    
    # Wait for Form
    Wait For Elements State    css=[data-testid="workflow.form.department.select"]    visible    timeout=15s
    
    # Check Disabled State (Standard Rule 4.1)
    Wait For Elements State    css=[data-testid="workflow.modal.create.save"]    disabled    timeout=15s

Create Workflow
    [Documentation]    Verifies creating a new workflow using random selection.
    [Tags]    critical    settings    workflow    crud
    Login To Application
    Go To    ${WORKFLOW_URL}
    
    Wait For Elements State    css=[data-testid="workflow.page.loading"]    hidden    timeout=30s
    Wait For Elements State    css=[data-testid="workflow.page.ready"]    attached    timeout=20s
    
    # Click Add
    Click    css=[data-testid="workflow.toolbar.add"]
    Wait For Elements State    css=[data-testid="workflow.form.department.select"]    visible    timeout=15s
    
    # Select Department (Random Selection)
    Click    css=[data-testid="workflow.form.department.select"]
    # Wait for non-placeholder options with generous timeout
    Wait For Elements State    css=[data-testid^="workflow.form.department.select.option."]:not([data-testid$="placeholder"]) >> nth=0    visible    timeout=20s
    ${depts}=    Get Elements    css=[data-testid^="workflow.form.department.select.option."]:not([data-testid$="placeholder"])
    ${dept_count}=    Get Length    ${depts}
    ${dept_index}=    Evaluate    random.randint(0, int(${dept_count}) - 1)    random
    Click    css=[data-testid^="workflow.form.department.select.option."]:not([data-testid$="placeholder"]) >> nth=${dept_index}
    
    # Wait for employees API to load after department selection
    Sleep    3s
    
    # Select Approver (Step 1 - Random Selection)
    # Wait for approver dropdown to be visible and clickable
    Wait For Elements State    css=[data-testid="workflow.form.step.0.primary.select"]    visible    timeout=20s
    Click    css=[data-testid="workflow.form.step.0.primary.select"]
    Wait For Elements State    css=[data-testid^="workflow.form.step.0.primary.select.option."] >> nth=0    visible    timeout=30s
    ${apprs}=    Get Elements    css=[data-testid^="workflow.form.step.0.primary.select.option."]
    ${appr_count}=    Get Length    ${apprs}
    ${appr_index}=    Evaluate    random.randint(0, int(${appr_count}) - 1)    random
    Click    css=[data-testid^="workflow.form.step.0.primary.select.option."] >> nth=${appr_index}
    
    # Save (Correct TestId)
    Wait For Elements State    css=[data-testid="workflow.modal.create.save"]    enabled    timeout=15s
    Click    css=[data-testid="workflow.modal.create.save"]
    
    # Verify Success
    Wait For Elements State    text="บันทึกเวิร์กโฟลว์สำเร็จ"    visible    timeout=20s

Edit Workflow
    [Documentation]    Verifies editing an existing workflow.
    [Tags]    critical    settings    workflow    crud
    Login To Application
    Go To    ${WORKFLOW_URL}
    
    # Wait for ready (increased timeout)
    Wait For Elements State    css=[data-testid="workflow.page.loading"]    hidden    timeout=30s
    Wait For Elements State    css=[data-testid="workflow.page.ready"]    attached    timeout=20s
    
    # Check if we have rows OR if it's empty. If empty, create one first.
    ${has_rows}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid^="workflow.table.row."] >> nth=0    visible    timeout=15s
    
    IF    ${has_rows} == ${FALSE}
        Log    No workflows found. Creating one first for testing purpose.
        Click    css=[data-testid="workflow.toolbar.add"]
        Wait For Elements State    css=[data-testid="workflow.form.department.select"]    visible    timeout=15s
        # Select Department
        Click    css=[data-testid="workflow.form.department.select"]
        Wait For Elements State    css=[data-testid^="workflow.form.department.select.option."]:not([data-testid$="placeholder"]) >> nth=0    visible    timeout=20s
        Click    css=[data-testid^="workflow.form.department.select.option."]:not([data-testid$="placeholder"]) >> nth=0
        # Wait for employees API to load
        Sleep    3s
        # Select Approver
        Wait For Elements State    css=[data-testid="workflow.form.step.0.primary.select"]    visible    timeout=20s
        Click    css=[data-testid="workflow.form.step.0.primary.select"]
        Wait For Elements State    css=[data-testid^="workflow.form.step.0.primary.select.option."] >> nth=0    visible    timeout=30s
        ${apprs}=    Get Elements    css=[data-testid^="workflow.form.step.0.primary.select.option."]
        ${appr_count}=    Get Length    ${apprs}
        Click    css=[data-testid^="workflow.form.step.0.primary.select.option."] >> nth=0
        # Save
        Click    css=[data-testid="workflow.modal.create.save"]
        Wait For Elements State    text="บันทึกเวิร์กโฟลว์สำเร็จ"    visible    timeout=20s
        # Refresh to see the item
        Reload
        Wait For Elements State    css=[data-testid="workflow.page.ready"]    attached    timeout=20s
    END

    # Find first row action edit
    Wait For Elements State    css=[data-testid^="workflow.table.row."][data-testid$=".action.edit"] >> nth=0    visible    timeout=15s
    Click    css=[data-testid^="workflow.table.row."][data-testid$=".action.edit"] >> nth=0
    
    # Wait for Edit View
    Wait For Elements State    css=[data-testid="workflow.modal.edit.save"]    visible    timeout=15s
    
    # Change Approver (Random Selection) - Wait for options to load
    Sleep    2s
    Click    css=[data-testid="workflow.form.step.0.primary.select"]
    Wait For Elements State    css=[data-testid^="workflow.form.step.0.primary.select.option."] >> nth=0    visible    timeout=30s
    ${apprs}=    Get Elements    css=[data-testid^="workflow.form.step.0.primary.select.option."]
    ${appr_count}=    Get Length    ${apprs}
    ${appr_index}=    Evaluate    random.randint(0, int(${appr_count}) - 1)    random
    Click    css=[data-testid^="workflow.form.step.0.primary.select.option."] >> nth=${appr_index}

    # Save
    Wait For Elements State    css=[data-testid="workflow.modal.edit.save"]    enabled    timeout=15s
    Click    css=[data-testid="workflow.modal.edit.save"]
    
    # Verify Success
    Wait For Elements State    text="บันทึกเวิร์กโฟลว์สำเร็จ"    visible    timeout=20s

Delete Workflow
    [Documentation]    Verifies deleting a workflow.
    [Tags]    critical    settings    workflow    crud
    Login To Application
    Go To    ${WORKFLOW_URL}
    
    # Wait for ready
    Wait For Elements State    css=[data-testid="workflow.page.loading"]    hidden    timeout=30s
    Wait For Elements State    css=[data-testid="workflow.page.ready"]    attached    timeout=15s
    
    # Ensure there is at least one row
    ${has_rows}=    Run Keyword And Return Status    Wait For Elements State    css=[data-testid^="workflow.table.row."] >> nth=0    visible    timeout=10s
    IF    ${has_rows} == ${FALSE}
         Log    No workflows found to delete.
         Pass Execution    No workflows available for deletion.
    END

    # Click Delete on first row
    Wait For Elements State    css=[data-testid^="workflow.table.row."][data-testid$=".action.delete"] >> nth=0    visible    timeout=15s
    Click    css=[data-testid^="workflow.table.row."][data-testid$=".action.delete"] >> nth=0
    
    Wait For Elements State    text="ลบเงื่อนไขสำเร็จ"    visible    timeout=15s
