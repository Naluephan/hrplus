*** Settings ***
Library    Browser    timeout=60s
Library    OperatingSystem
Resource   variables.resource

*** Keywords ***
Start Browser
    [Arguments]    ${url}=${URL}    ${headless}=${HEADLESS}    ${load_session}=True
    New Browser    browser=${BROWSER}    headless=${headless}
    ${session_file}=    Resolve Session File
    
    # Ensure session directory exists
    ${session_dir}=    Evaluate    os.path.dirname(r"${session_file}")    modules=os
    Create Directory    ${session_dir}

    # Check for existing session only if load_session is True
    ${session_exists}=    Run Keyword And Return Status    File Should Exist    ${session_file}
    
    IF    ${load_session} and ${session_exists}
        New Context    viewport={'width': 1280, 'height': 720}    storageState=${session_file}
        Log    Loaded session from ${session_file}
    ELSE
        New Context    viewport={'width': 1280, 'height': 720}
        Log    Starting fresh context (Session loaded: ${load_session}, Exists: ${session_exists})
    END
    
    Set Browser Timeout    120s
    New Page    ${url}

Save Current Session
    [Documentation]    Saves the current browser context state (cookies, local storage) to a file.
    ${session_file}=    Resolve Session File
    ${temp_state}=    Save Storage State
    Move File    ${temp_state}    ${session_file}
    Log    Saved session to ${session_file}

Resolve Session File
    [Documentation]    ไฟล์เก็บเซสชันล็อกอิน — แยกไฟล์ต่อ process เมื่อรันขนานด้วย pabot
    ...
    ...                ถ้าหลาย process เขียนไฟล์เดียวกันพร้อมกัน ไฟล์อาจเสียครึ่ง ๆ กลาง ๆ
    ...                แล้ว process อื่นโหลดเซสชันพังไปใช้ ทำให้เทสล้มแบบสุ่ม
    ...                รันธรรมดา (ไม่ใช่ pabot) ยังใช้ไฟล์เดิมเหมือนเดิมทุกอย่าง
    ${pool}=    Get Variable Value    ${PABOTEXECUTIONPOOLID}    ${EMPTY}
    IF    "${pool}" == "${EMPTY}"    RETURN    ${SESSION_PATH}
    ${root}    ${ext}=    Split Extension    ${SESSION_PATH}
    RETURN    ${root}.pool${pool}.${ext}

Close Application
    Close Browser
