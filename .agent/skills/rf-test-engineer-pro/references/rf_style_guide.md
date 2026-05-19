# Robot Framework Style Guide (Project)

- Naming:
  - Suite: snake_case เช่น `smoke_login.robot`
  - Test case: ประโยคสั้น ๆ อ่านรู้เรื่อง เช่น `User can login with valid credentials`
  - Keyword: Verb + Object เช่น `Open Login Page`, `Submit Login Form`

- Locator priority:
  1) data-testid
  2) role/aria
  3) stable text
  4) css เฉพาะเจาะจง
  * หลีกเลี่ยง XPath ยาว/ผูกกับ DOM layout

- No Sleep-first:
  - ใช้ waits ของ Browser library แทน sleep
  