*** Settings ***
Documentation     ตั้งค่า › การขอ OT
...
...               เวลาตัดรอบการขอ OT รายวัน, ระดับขั้นต่ำของผู้สั่ง OT และกติกาการขอล่วงหน้าสำหรับ
...               วันหยุดสุดสัปดาห์และวันหยุดนักขัตฤกษ์ — ค่าเหล่านี้มีผลกับการขอ OT ของทั้งบริษัท
...
...               สวีทจำค่า OT เดิมผ่าน API ตอนเริ่ม และคืนค่าผ่าน API ตอนจบเสมอ
...               การคืนค่าส่งเฉพาะฟิลด์ OT (PATCH แบบบางฟิลด์) จึงไม่กระทบการตั้งค่าอื่นของบริษัท
Resource          ../../resources/session.resource
Resource          ../../../resources/core/page_state.resource
Resource          ../../resources/keywords/api_common.resource
Library           Collections
Library           ../../resources/session_lifetime.py

Suite Setup       Prepare OT Settings Suite
Suite Teardown    Restore OT Settings And Close
Test Setup        Open Fresh Logged In Page
Test Teardown     Close Test Page


*** Variables ***
${PAGE}                  settings.otSettings
${PATH}                  /settings/ot-settings
${ORIGINAL_OT}           ${None}


*** Test Cases ***
Page Loads Into A Ready State
    [Tags]    smoke    settings    ot_settings
    Open OT Settings Page
    Wait For Elements State    css=[data-testid="${PAGE}.page.error"]    detached    timeout=1s

The Form Shows The Saved Values
    [Documentation]    ค่าที่แสดงในฟอร์มต้องตรงกับที่ระบบบันทึกไว้จริง
    [Tags]    smoke    settings    ot_settings
    ${saved}=    Saved OT Settings
    Open OT Settings Page
    # A company that never saved OT settings gets the page defaults: 17:00 and level 7.
    Get Property    css=[data-testid="${PAGE}.form.cutoffTime.input"]    value    ==    ${{ $saved["otCutoffTime"] or "17:00" }}
    Get Property    css=[data-testid="${PAGE}.form.supervisorMinLevel.input"]    value    ==    ${{ str($saved["otSupervisorMinLevel"] or 7) }}
    Wait For Elements State    css=[data-testid="${PAGE}.form.save"]    disabled    timeout=5s

Editing Marks The Form As Unsaved And Reverting Clears It
    [Tags]    settings    ot_settings
    ${saved}=    Saved OT Settings
    ${other_level}=    Other Supervisor Level    ${saved}[otSupervisorMinLevel]
    Open OT Settings Page
    Fill Text    css=[data-testid="${PAGE}.form.supervisorMinLevel.input"]    ${other_level}
    Wait For Elements State    css=[data-testid="${PAGE}.form.dirty"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.form.save"]    enabled    timeout=5s
    Fill Text    css=[data-testid="${PAGE}.form.supervisorMinLevel.input"]    ${saved}[otSupervisorMinLevel]
    Wait For Elements State    css=[data-testid="${PAGE}.form.dirty"]    detached    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.form.save"]    disabled    timeout=5s

An Out Of Range Supervisor Level Is Refused
    [Documentation]    ระดับต้องอยู่ระหว่าง 1–99 — เบราว์เซอร์ปฏิเสธตั้งแต่ช่องกรอก (max=99) และค่าต้องไม่ถูกบันทึก
    [Tags]    settings    ot_settings    negative
    ${before}=    Saved OT Settings
    Open OT Settings Page
    Fill Text    css=[data-testid="${PAGE}.form.supervisorMinLevel.input"]    100
    Click    css=[data-testid="${PAGE}.form.save"]
    ${overflow}=    Evaluate JavaScript    css=[data-testid="${PAGE}.form.supervisorMinLevel.input"]    (el) => el.validity.rangeOverflow
    Should Be True    ${overflow}    ช่องระดับผู้สั่ง OT ต้องปฏิเสธค่า 100
    Wait For Elements State    css=[data-testid="${PAGE}.toast.success"]    detached    timeout=3s
    ${after}=    Saved OT Settings
    Should Be Equal As Integers    ${after}[otSupervisorMinLevel]    ${before}[otSupervisorMinLevel]

Saving A New Cutoff Time Persists It
    [Tags]    smoke    settings    ot_settings    crud
    ${saved}=    Saved OT Settings
    ${new_time}=    Set Variable If    "${saved}[otCutoffTime]" == "18:30"    19:15    18:30
    Open OT Settings Page
    Fill Text    css=[data-testid="${PAGE}.form.cutoffTime.input"]    ${new_time}
    Save OT Settings
    Open OT Settings Page
    Get Property    css=[data-testid="${PAGE}.form.cutoffTime.input"]    value    ==    ${new_time}
    ${after}=    Saved OT Settings
    Should Be Equal As Strings    ${after}[otCutoffTime]    ${new_time}
    [Teardown]    Restore OT And Close Page

Turning Off The Weekend Advance Rule Hides Its Fields And Persists
    [Documentation]    ปิดกติกาขอล่วงหน้าของวันเสาร์อาทิตย์ → ช่องจำนวนวันและเวลาต้องหายไป และบันทึกได้จริง
    [Tags]    settings    ot_settings    crud
    Ensure Weekend Advance Rule Is On
    Open OT Settings Page
    Click    css=[data-testid="${PAGE}.form.advance.weekend.enabled"]
    Wait For Elements State    css=[data-testid="${PAGE}.form.advance.weekend.enabled"][data-state="unchecked"]    visible    timeout=5s
    Wait For Elements State    css=[data-testid="${PAGE}.form.advance.weekend.days.input"]    detached    timeout=5s
    Save OT Settings
    ${after}=    Saved OT Settings
    Should Not Be True    ${after}[otAdvanceRequestPolicy][weekend][enabled]
    [Teardown]    Restore OT And Close Page


*** Keywords ***
Open OT Settings Page
    Go To    ${URL}${PATH}
    Wait For Page Ready    ${PAGE}

Save OT Settings
    Click    css=[data-testid="${PAGE}.form.save"]
    Wait For Elements State    css=[data-testid="${PAGE}.toast.success"]    visible    timeout=${ACTION_TIMEOUT}

Saved OT Settings
    [Documentation]    อ่านค่า OT ที่บันทึกไว้จากระบบ (ไม่ใช่จากหน้าจอ)
    ${response}=    Send GET Request Wrapper    /organization-settings
    ${body}=    Set Variable    ${response.json()}
    ${ot}=    Create Dictionary
    ...    otCutoffTime=${body}[otCutoffTime]
    ...    otSupervisorMinLevel=${body}[otSupervisorMinLevel]
    ...    otAdvanceRequestPolicy=${body}[otAdvanceRequestPolicy]
    RETURN    ${ot}

Other Supervisor Level
    [Arguments]    ${level}
    ${other}=    Evaluate    int(${level}) + 1 if int(${level}) < 99 else int(${level}) - 1
    RETURN    ${other}

Patch OT Settings Through The API
    [Documentation]    ส่งเฉพาะฟิลด์ OT — service ของ organization-settings อัปเดตเฉพาะฟิลด์ที่ส่งมา
    [Arguments]    ${ot}
    ${response}=    PATCH On Session    hr_api    /organization-settings    json=${ot}    expected_status=any
    Should Be True    ${response.status_code} < 300    คืนค่า OT ไม่สำเร็จ: ${response.status_code} ${response.text}

Ensure Weekend Advance Rule Is On
    ${saved}=    Saved OT Settings
    IF    not ${saved}[otAdvanceRequestPolicy][weekend][enabled]
        ${policy}=    Evaluate    {**$saved["otAdvanceRequestPolicy"], "weekend": {**$saved["otAdvanceRequestPolicy"]["weekend"], "enabled": True}}
        ${patch}=    Create Dictionary    otAdvanceRequestPolicy=${policy}
        Patch OT Settings Through The API    ${patch}
    END

Restore OT And Close Page
    Run Keyword And Ignore Error    Patch OT Settings Through The API    ${ORIGINAL_OT}
    Close Test Page

Prepare OT Settings Suite
    Open Browser For Suite
    ${session_file}=    Resolve Session File
    ${ui_tenant}=    Session Cookie    ${session_file}    hr-tenant-id
    # The API session uses the system token, which the backend pins to tenant 3.
    Should Be Equal As Strings    ${ui_tenant}    ${DEFAULT_TENANT_ID}
    ...    msg=ผู้ใช้หน้าเว็บอยู่ tenant "${ui_tenant}" แต่ API คืนค่าได้เฉพาะ tenant "${DEFAULT_TENANT_ID}" — ยกเลิกเพื่อไม่ให้แก้การตั้งค่าผิดบริษัท
    Create HR API Session    tenant_id=${ui_tenant}
    ${original}=    Saved OT Settings
    Set Suite Variable    ${ORIGINAL_OT}    ${original}
    Log    ค่า OT เดิม: ${original}

Restore OT Settings And Close
    [Documentation]    ตาข่ายชั้นสุดท้าย: ค่า OT ของบริษัทต้องกลับเป็นค่าก่อนเริ่มสวีท ไม่ว่าเคสไหนจะล้ม
    IF    $ORIGINAL_OT is not None
        Run Keyword And Ignore Error    Patch OT Settings Through The API    ${ORIGINAL_OT}
    END
    Close Browser    ALL
