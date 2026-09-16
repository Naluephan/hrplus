*** Settings ***
Documentation    Department Resource Keywords for HTTP API Testing
Resource         api_common.resource
Library          Collections

*** Variables ***
@{ALPHABET}      A    B    C    D    E    F    G    H    I    J    K    L    M
...              N    O    P    Q    R    S    T    U    V    W    X    Y    Z

*** Keywords ***
Allocate Unused Department Code
    [Documentation]    คืนรหัสแผนกที่ยังไม่มีใครใช้ในเทนแนนต์นี้
    ...
    ...                คอลัมน์ `departments.code` เป็น varchar(2) และมี unique index
    ...                ต่อ (tenant, code) การสุ่มรหัสจึงชนกันได้เสมอ — โดยเฉพาะเมื่อรันก่อนหน้า
    ...                ล้มกลางคันจนรหัสเดิมค้างอยู่ในฐาน คีย์เวิร์ดนี้จึงอ่านของที่มีอยู่จริง
    ...                ก่อนแล้วค่อยเลือกรหัสที่ว่าง แทนการเดา
    [Arguments]        ${prefix}=Q
    ${response}=       Send GET Request Wrapper    /departments?limit=200    expected_status=200
    ${body}=           Set Variable    ${response.json()}
    ${items}=          Get From Dictionary    ${body}    items    default=${body}
    ${used}=           Create List
    FOR    ${item}    IN    @{items}
        ${code}=    Get From Dictionary    ${item}    code    default=${EMPTY}
        Append To List    ${used}    ${code}
    END
    FOR    ${suffix}    IN    @{ALPHABET}
        ${candidate}=    Set Variable    ${prefix}${suffix}
        ${taken}=        Run Keyword And Return Status    List Should Contain Value    ${used}    ${candidate}
        IF    not ${taken}    RETURN    ${candidate}
    END
    Fail    ไม่มีรหัสแผนกว่างที่ขึ้นต้นด้วย "${prefix}" เหลือแล้ว — ตรวจว่ามีข้อมูลเทสค้างอยู่ในเทนแนนต์นี้หรือไม่

Delete Department By Code If Exists
    [Documentation]    ลบแผนกตามรหัสถ้ามีอยู่ — ใช้เก็บกวาดของค้างจากรันที่ล้มกลางคัน
    [Arguments]        ${code}
    ${response}=       Send GET Request Wrapper    /departments?limit=200    expected_status=200
    ${body}=           Set Variable    ${response.json()}
    ${items}=          Get From Dictionary    ${body}    items    default=${body}
    FOR    ${item}    IN    @{items}
        ${item_code}=    Get From Dictionary    ${item}    code    default=${EMPTY}
        IF    "${item_code}" == "${code}"
            ${item_id}=    Get From Dictionary    ${item}    id
            Delete Department via API    ${item_id}
            Log    ลบแผนกค้างรหัส ${code} (id=${item_id}) แล้ว
            RETURN
        END
    END

Create Department via API
    [Documentation]    Creates a new department and returns its generated ID.
    [Arguments]        ${code}    ${name_th}    ${name_en}    ${description}=${None}
    ${payload}=        Create Dictionary
    ...                code=${code}
    ...                nameTh=${name_th}
    ...                nameEn=${name_en}
    ...                description=${description}
    ...                status=active
    ${response}=       Send POST Request Wrapper    /departments    ${payload}    expected_status=201
    ${dept_id}=        Get From Dictionary    ${response.json()}    id
    Log                Department created with ID: ${dept_id}
    RETURN             ${dept_id}    ${response.json()}

Get Department Details via API
    [Documentation]    Retrieves department details by ID.
    [Arguments]        ${dept_id}
    ${response}=       Send GET Request Wrapper    /departments/${dept_id}    expected_status=200
    RETURN             ${response.json()}

Update Department via API
    [Documentation]    Updates department details by ID.
    [Arguments]        ${dept_id}    ${payload}
    ${response}=       Send PUT Request Wrapper    /departments/${dept_id}    ${payload}    expected_status=200
    RETURN             ${response.json()}

Delete Department via API
    [Documentation]    Deletes a department by ID.
    [Arguments]        ${dept_id}
    ${response}=       Send DELETE Request Wrapper    /departments/${dept_id}    expected_status=200
    RETURN             ${response}
