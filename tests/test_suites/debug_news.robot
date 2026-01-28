*** Settings ***
Resource    ../resources/common.resource

Test Setup  Open HR Plus Application
Test Teardown  Close Application

*** Test Cases ***
Debug News Table DOM
    Login To Application
    Go To    ${URL}/news/admin
    Wait For Elements State    css=[data-testid="news.admin.ready"]    visible    timeout=15s
    ${table_html}=    Get Property    css=[data-testid="news.admin.root"]    outerHTML
    Log    TABLE HTML: ${table_html}
    ${rows}=    Get Elements    css=[data-testid^="news.admin.table.row."]
    Log    ROW COUNT: ${rows}
    ${all_ids}=    Get Elements    css=[data-testid]
    Log    ALL TEST IDs count: ${all_ids}
    Take Screenshot
