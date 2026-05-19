*** Settings ***
Library    Browser
Resource   ../resources/common.resource
Resource   ../resources/pages_<feature>.resource
Suite Setup     Open App
Suite Teardown  Close Browser

*** Test Cases ***
Smoke - <feature> works
    [Tags]    smoke    <module>
    Go To <Feature> Page
    Do <Feature> Action
    Assert <Feature> Success
