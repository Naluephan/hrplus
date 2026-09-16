*** Settings ***
Documentation    Attendance API Resource Keywords for HTTP API Testing
Resource         api_common.resource
Library          OperatingSystem

*** Variables ***
# ปลายทาง mobile check-in/out บังคับให้แนบรูปยืนยันตัวตนเสมอ (SELFIE_UPLOAD_OPTIONS)
# ถ้าไม่แนบ ระบบจะตอบ 400 "กรุณาถ่ายรูปยืนยันตัวตนก่อนบันทึกเวลา"
${SELFIE_IMAGE_PATH}    ${CURDIR}/../../data/dummy-image.png

*** Keywords ***
Build Selfie Upload
    [Documentation]    เตรียมไฟล์รูปสำหรับแนบไปกับ mobile check-in/out
    ${image}=          Get Binary File    ${SELFIE_IMAGE_PATH}
    ${upload}=         Evaluate    {'photo': ('selfie.png', $image, 'image/png')}
    RETURN             ${upload}
Check In Mobile via API
    [Documentation]    Performs mobile check-in with GPS coordinates and the required selfie.
    [Arguments]        ${employee_id}    ${lat}    ${lng}    ${date}=${None}    ${time}=${None}
    ${payload}=        Create Dictionary
    ...                employeeId=${employee_id}
    ...                latitude=${lat}
    ...                longitude=${lng}
    Run Keyword If     '${date}' != '${None}'    Set To Dictionary    ${payload}    date=${date}
    Run Keyword If     '${time}' != '${None}'    Set To Dictionary    ${payload}    time=${time}
    ${files}=          Build Selfie Upload
    ${response}=       Send Multipart POST Request Wrapper    /attendance/mobile/check-in    ${payload}    ${files}    expected_status=201
    RETURN             ${response.json()}

Check Out Mobile via API
    [Documentation]    Performs mobile check-out with GPS coordinates and the required selfie.
    [Arguments]        ${employee_id}    ${lat}    ${lng}    ${date}=${None}    ${time}=${None}
    ${payload}=        Create Dictionary
    ...                employeeId=${employee_id}
    ...                latitude=${lat}
    ...                longitude=${lng}
    Run Keyword If     '${date}' != '${None}'    Set To Dictionary    ${payload}    date=${date}
    Run Keyword If     '${time}' != '${None}'    Set To Dictionary    ${payload}    time=${time}
    ${files}=          Build Selfie Upload
    ${response}=       Send Multipart POST Request Wrapper    /attendance/mobile/check-out    ${payload}    ${files}    expected_status=201
    RETURN             ${response.json()}

Get Mobile Attendance By Employee via API
    [Documentation]    Retrieves mobile attendance records for a specific employee.
    [Arguments]        ${employee_id}    ${start_date}=${None}    ${end_date}=${None}
    ${payload}=        Create Dictionary    employeeId=${employee_id}
    Run Keyword If     '${start_date}' != '${None}'    Set To Dictionary    ${payload}    startDate=${start_date}
    Run Keyword If     '${end_date}' != '${None}'      Set To Dictionary    ${payload}    endDate=${end_date}
    ${response}=       Send POST Request Wrapper    /attendance/mobile/employee    ${payload}    expected_status=201
    RETURN             ${response.json()}

Get Attendance Detail via API
    [Documentation]    Retrieves detailed attendance record for an employee on a specific date.
    [Arguments]        ${employee_id}    ${date}
    ${response}=       Send GET Request Wrapper    /attendance/detail?employeeId=${employee_id}&date=${date}    expected_status=200
    RETURN             ${response.json()}

Update Attendance Detail via API
    [Documentation]    Updates attendance details (check-in/out times, status) for a specific employee date.
    [Arguments]        ${employee_id}    ${date}    ${payload}
    Set To Dictionary    ${payload}    employeeId=${employee_id}
    Set To Dictionary    ${payload}    date=${date}
    ${response}=       Send PATCH Request Wrapper    /attendance/detail    ${payload}    expected_status=200
    RETURN             ${response.json()}

Get Attendance Summary via API
    [Documentation]    Retrieves attendance summary based on filters.
    [Arguments]        ${payload}=${None}
    ${payload_dict}=   Run Keyword If    '${payload}' == '${None}'    Create Dictionary    ELSE    Set Variable    ${payload}
    ${response}=       Send POST Request Wrapper    /attendance/summary    ${payload_dict}    expected_status=201
    RETURN             ${response.json()}
