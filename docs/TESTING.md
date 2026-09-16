# UI Testing — hrplus

Robot Framework + Browser Library (Playwright) ทดสอบ HR Plus ผ่านหน้าจอจริง

> เทส **API E2E** ของ NestJS อยู่ในโปรเจกต์นี้เหมือนกัน แต่คนละชั้น — ดู [API_TESTING.md](API_TESTING.md)

## โครงสร้าง

```
resources/
  core/
    page_state.resource   # รอสถานะหน้าตามสัญญา — ไม่มี Sleep
    table.resource        # ตาราง/แถว อ้างด้วย id จริง ไม่ใช่ลำดับ
  pages/                  # Page Object — selector + action ของแต่ละหน้า
  flows/                  # ขั้นตอนทางธุรกิจที่ประกอบจากหลายหน้า
tests/
  test_suites/            # ชุดเทสปัจจุบัน
  resources/              # (ของเดิม) จะทยอยย้ายมาไว้ใต้ resources/
scripts/
  audit_testids.py        # ตรวจว่า frontend ประกาศ data-testid ครบตามสัญญาหรือยัง
data/
  env/                    # ค่าคอนฟิกต่อ environment
  testdata/               # ข้อมูลทดสอบ
```

## การรัน

```powershell
robot -d results -V data/env/dev.yaml -V data/testdata/users.yaml tests
robot -d results -i smoke tests                       # เฉพาะ smoke
robot -d results tests/test_suites/login_suite.robot  # เฉพาะไฟล์เดียว
```

## ความเร็ว

### คำสั่ง

```powershell
npm run test:ui            # headless ทีละสวีท
npm run test:ui:parallel   # pabot 4 process — รันหลายสวีทพร้อมกัน
npm run test:ui:headed     # เปิดหน้าต่างเบราว์เซอร์ให้ดูตอนดีบัก
npm run test:ui:smoke      # เฉพาะแท็ก smoke
```

รันเองโดยไม่ผ่าน npm: เพิ่ม `-v HEADLESS:false` เพื่อดูเบราว์เซอร์

### เวลาหายไปไหน (วัดจากรันเต็ม 105 เคส ก่อนปรับ: 90 นาที, เฉลี่ย 52 วินาที/เคส)

| ส่วน | เวลารวม | สาเหตุ |
| --- | ---: | --- |
| `Navigate To Menu` | 21.7 นาที | เรียก 67 จุด แต่ละครั้งรอ loader + fallback `Go To` |
| `Wait For Loading To Hide` | 17.0 นาที | `Sleep 0.3s` + `Sleep 0.2s` **ทุกครั้ง** แม้ไม่มี loader |
| `Login To Application` | 15.2 นาที | ล็อกอินใหม่ทุกเคส |
| `Open HR Plus Application` | 12.1 นาที | เปิดเบราว์เซอร์ใหม่ทุกเคส |
| `Sleep` ตรง ๆ | 5.1 นาที | 42 จุดในชุดเทส |

(ตัวเลขซ้อนกันบางส่วน เพราะคีย์เวิร์ดเรียกกันเอง) — ฐานข้อมูลไม่ใช่คอขวด

### คอขวดที่แท้จริง: frontend รันด้วย `next dev`

พอร์ต `:8001` ให้บริการด้วย `next dev` ซึ่งคอมไพล์หน้าเว็บ **ตอนมีคนเปิดครั้งแรก** ทุกหน้า
ทุกครั้งที่รีสตาร์ต dev server — เทสจึงจ่ายค่าคอมไพล์แทนผู้ใช้

| หน้า | เปิดครั้งแรก | ครั้งที่สอง |
| --- | ---: | ---: |
| `/get-app` | 14.3 วิ | 0.4 วิ |
| `/package-expired` | 9.1 วิ | 0.5 วิ |
| `/register` | 16.2 วิ | 3.0 วิ |

ขณะที่ backend ตอบเร็วมาก — `/salary/dashboard` ยิง API 7 ตัว ตอบครบใน **57–124 มิลลิวินาที**
แต่หน้าเว็บค้าง loader **21–80 วินาที** ช่องว่างนั้นอยู่ฝั่ง frontend ทั้งหมด

**ข้อแนะนำ:** รันเทส UI กับ production build (`npm run build && npm run start` ใน hr-frontend)
ไม่ใช่ `next dev` — และด้วยเหตุผลเดียวกัน การย้ายฐานข้อมูลไป Docker จะไม่ทำให้เร็วขึ้น

### production build (`next build` + `next start` ที่พอร์ต 8002) — วัดแล้ว 2026-09-14

| สิ่งที่วัด | `next dev` (8001) | production (8002) |
| --- | --- | --- |
| build | ไม่มี | 261 วินาที (ครั้งเดียว) |
| `/get-app` ครั้งแรก | 14.3 วินาที | 9.5 วินาที |
| `/get-app` ครั้งที่สอง | 0.4 วินาที | 0.08 วินาที |
| หน้าอื่นครั้งแรก | ต้อง compile ทีละหน้า | 0.06–0.1 วินาที |
| ชุดย่อย 8 เคส (headless) | 62 วินาที · ผ่าน 8/8 | 229 วินาที · ผ่าน 8/8 |

ข้อสรุป: production ตัดเวลา compile รายหน้าได้จริง แต่เวลารวมของชุดย่อยไม่ลดลง
เวลาส่วนใหญ่อยู่ในเคสสร้างรอบเงินเดือน (102 วินาที) กับ Sleep คงที่ใน `Wait For Loading To Hide`
และตัวเลขสองฝั่งมาจากการรันคนละช่วงเวลา ข้อมูลในฐานต่างกัน จึงยังเทียบตรง ๆ ไม่ได้
ประโยชน์หลักของ production คือเคสแรกของแต่ละหน้าไม่ timeout ตอน compile (ต้นเหตุของ `page.goto: Timeout` ที่เจอในชุดพนักงาน)
Docker ไม่ช่วยเรื่องนี้ เพราะฐานข้อมูลตอบใน 57–124 มิลลิวินาทีอยู่แล้ว

### headless vs headed (A/B รันเดี่ยว สภาพเดียวกัน)

| โหมด | Salary Overview | เวลา | รอ loader |
| --- | --- | ---: | ---: |
| headed | ผ่าน | 118 วิ | 80.7 วิ |
| headless | ผ่าน | 62 วิ | 21.5 วิ |

headless ไม่ได้ทำให้เทสพัง — ที่เคยพังเป็นเพราะเวลาโหลดหน้าแกว่งมากจาก `next dev`

### เปิดเบราว์เซอร์ครั้งเดียวต่อสวีท: วัดแล้วได้น้อยกว่าที่คาด

ย้าย `settings_suite`, `employees_suite`, `news_suite` (65 เคส) จากเปิดเบราว์เซอร์ใหม่ทุกเคส
มาเป็นเปิดครั้งเดียวต่อสวีท + context ใหม่ต่อเคส (`tests/resources/session.resource`)

| สวีท | ผ่าน ก่อน → หลัง | เวลา ก่อน → หลัง | เปิดเบราว์เซอร์+ล็อกอิน ก่อน → หลัง |
| --- | --- | --- | --- |
| Settings (56) | 49 → 49 | 49.8 → 43.7 นาที | 19.1 → 31.3 นาที |
| Employees (4) | 4 → 1 | 14.8 → 17.1 นาที | 1.5 → 2.4 นาที |
| News (5) | 4 → 4 | 4.3 → 6.2 นาที | 1.6 → 3.3 นาที |
| **รวม** | | **68.9 → 67.0 นาที (−3%)** | |

**ที่แพงจริงไม่ใช่การเปิดเบราว์เซอร์** แต่คือ `Login To Application` ใน Test Setup ที่สั่ง
`Go To /login` แล้วรอ redirect กลับ **ทุกเคส** — บน `next dev` ครั้งละ 10–20 วินาที
ทั้งที่ context โหลดเซสชันที่ยังใช้ได้มาแล้ว จึงแก้ให้แวะ /login เฉพาะเมื่อเซสชันหมดอายุหรือใกล้หมด

ค่าก่อนหน้ามาจากรันวันที่ 8 ข้อมูลและโค้ดต่างจากวันที่วัดหลัง ผลของ Employees (4 → 1) จึงยังไม่ใช่
หลักฐานว่าการ refactor ทำให้พัง — ต้องยืนยันด้วย A/B บนโค้ดและข้อมูลชุดเดียวกัน

### เซสชันหลุดกลางเคส: หน้าผาเวลา 1 ชั่วโมง

Central ออก access token **และ** refresh token อายุ 1 ชั่วโมง และหมุน (blacklist) refresh token
ทุกครั้งที่หน้าเว็บ refresh เงียบ ๆ — ซึ่งเกิดขึ้นในเทสด้วย เพราะคลิกของ Playwright นับเป็น "ผู้ใช้ active"
token ใบใหม่อยู่แค่ใน context นั้น เคสถัดไปโหลด token ที่ถูกยกเลิกแล้วจากไฟล์เซสชัน
เคสที่คร่อมเวลาหมดอายุจึงถูกเด้งไป `/login` กลางเคส (เช่น *Verify Admins Page*)

เป็นความไม่เสถียรที่มีมาตั้งแต่ก่อน refactor แก้แล้วสองจุด:
- **บันทึกเซสชันกลับลงไฟล์ตอนจบทุกเคส** ถ้ายังล็อกอินอยู่ — token ใบใหม่ส่งต่อให้เคสถัดไป
- **ตรวจอายุที่เหลือก่อนเริ่มเคส** (`tests/resources/session_lifetime.py`) ถ้าเหลือไม่ถึง 10 นาที ล็อกอินใหม่ก่อน

### สิ่งที่ปรับแล้ว

- **Headless เป็นค่าเริ่มต้น** — ตัวแปร `HEADLESS` ใน `tests/resources/env.py`
- **รันขนานด้วย pabot** — ไฟล์เซสชันแยกต่อ process (`Resolve Session File`) กันไฟล์ `.auth/admin_state.json`
  ถูกเขียนพร้อมกันจนเสีย สวีทที่เขียนข้อมูลทั้งสามใช้ชื่อข้อมูลแบบสุ่มอยู่แล้ว จึงไม่ชนกันเมื่อรันพร้อมกัน

### สิ่งที่ยังควรทำ

- เปิดเบราว์เซอร์ + ล็อกอิน **ครั้งเดียวต่อสวีท** (`Suite Setup`) แทนทุกเคส (`Test Setup`)
- ลบ `Sleep` ที่เหลือ 42 จุด — ทำได้เต็มที่เมื่อ frontend ประกาศ `page.ready` (ดู `docs/UI_COVERAGE.md`)

### บทเรียนที่วัดได้: อย่าตัด Sleep ก่อนมีสัญญาณ page.ready

ทดลองตัด `Sleep` ใน `Wait For Loading To Hide` และย่อหน้าต่างจับ loader จาก ~1.3 เหลือ 0.5 วินาที
แล้ววัดกับชุดตัวอย่าง 8 เคส:

| | ผ่าน | เวลารวม |
| --- | ---: | ---: |
| ก่อนแก้ | 8/8 | 579 วินาที |
| ตัด Sleep | 6/8 | 777 วินาที |

loader โผล่ช้ากว่าหน้าต่างที่ย่อลง เทสจึงไปคลิกขณะ loader ยังคลุมหน้าจอ —
Playwright รายงาน *intercepts pointer events* 30 ครั้ง คลิกค้างจนหมดเวลา 120 วินาที
ผลคือ**ทั้งช้าลงและพังมากขึ้น** จึงคืนคีย์เวิร์ดเดิมแล้ว

`Sleep` เหล่านี้กำลังชดเชยการที่หน้าเว็บไม่บอกว่าโหลดเสร็จเมื่อไร ทางแก้ที่ถูกคือให้ frontend
ประกาศ `page.ready` แล้วรอสัญญาณนั้น — ไม่ใช่ตัด `Sleep` ทิ้งเฉย ๆ

## แท็ก

| แท็ก | ความหมาย |
| --- | --- |
| `smoke` | เส้นทางหลักที่ต้องผ่านทุกครั้งก่อน deploy |
| `critical` | ฟีเจอร์ที่พังแล้วกระทบผู้ใช้ทันที |
| `crud` | สร้าง / แก้ไข / ลบ |
| `negative` | เคสที่ระบบต้องปฏิเสธและอธิบายเหตุผล |

## กติกาการเขียน

1. **ล็อกด้วย `data-testid` เท่านั้น** — `css=[data-testid="employees.toolbar.add"]`
   ห้ามใช้คลาส Tailwind, โครงสร้าง DOM (`div > div > span`) หรือ `nth-child`
   ทั้งสามอย่างจะพังทันทีที่ดีไซน์เปลี่ยน ทั้งที่ระบบยังทำงานถูก
2. **ห้ามใช้ `Sleep`** — รอ *สถานะ* เสมอ ใช้คีย์เวิร์ดใน `resources/core/page_state.resource`
   การรอตามเวลาทำให้เทสช้าเมื่อทุกอย่างปกติ และพังเมื่อเครื่องช้ากว่าที่เดา
3. **แถวอ้างด้วย id จริง** — `employees.table.row.<id>` ไม่ใช่ `row.1`
4. **หนึ่งเทส หนึ่งพฤติกรรม** และตั้งชื่อเป็นประโยคที่บอกว่าระบบทำอะไร
5. **ยืนยันผลจากสิ่งที่ผู้ใช้เห็น** — โมดัลปิด + toast success + แถวปรากฏในตาราง
   ไม่ใช่แค่ "ไม่มี error"

---

## บั๊กของชุดเทสที่แก้ไปแล้ว (2026-09-08)

ก่อนหน้านี้รันเต็มชุดแล้วพัง 93 จาก 105 เคส ส่วนใหญ่ **ไม่ใช่ระบบเสีย** แต่เป็นชุดเทสเอง

### 1. `Login To Application` อ่าน URL ก่อน redirect เสร็จ — ต้นเหตุที่ทำให้พังยกแผง

ของเดิม `Go To ${URL}/login` แล้วอ่าน `Get Url` ทันที ซึ่งยังเป็น `/login`
เพราะแอปยัง redirect ไม่จบ จึงสรุปว่า "ยังไม่ได้ล็อกอิน" แล้วไปรอฟอร์ม
`id=login-email` นาน 60 วินาที ทั้งที่แอปพาไป `/employees/dashboard` ไปแล้ว

อาการที่เห็น: **รันไฟล์เดียวผ่าน แต่รันรวมพังเกือบทุกไฟล์** เพราะสวีทแรกบันทึก
เซสชันไว้ สวีทถัด ๆ ไปจึงโดน redirect

แก้เป็น `Resolve Authentication State` ที่รอจนสรุปสถานะได้จริง (authenticated /
anonymous) แทนการอ่านค่าครั้งเดียวแล้วเดา

### 2. selector ปฏิทินใช้รูปแบบวันที่ผิด — ไม่เคยแมตช์เลยสักครั้ง

`button[data-day="2026-09-09"]` ไม่มีวันเจอ เพราะปฏิทินเขียน `data-day` เป็น
`M/D/YYYY` เช่น `9/7/2026` เพิ่มคีย์เวิร์ด `Get Calendar Day Attribute` แปลงให้ถูกรูปแบบ

### 3. วันที่ฮาร์ดโค้ด = เทสระเบิดเวลา

- แดชบอร์ดล็อกวันที่ 9 กับ 10 ของเดือน → ปฏิทินกดวันอนาคตไม่ได้ จึงพังเองทุกวันที่ 1–9
- API smoke ส่งใบลาวันที่ `2026-05-19` ซึ่งผ่านมาแล้ว → ยกเลิกไม่ได้ ตอบ 403
  "The leave date has already passed"

แก้ทั้งสองจุดให้คำนวณจากวันปัจจุบัน (`Get Calendar Day Attribute`, `Get Future Date`)

### 4. รหัสแผนกสุ่มจากตัวอักษรตัวเดียว — ชนกันแน่นอน

`Q` + สุ่ม A–Z = 26 ค่า และ `departments.code` มี unique index ต่อเทนแนนต์
พอรันก่อนหน้าล้มกลางคันจน cleanup ไม่ทำงาน รหัสเดิมค้าง ครั้งต่อไปชนทันที (500)
เปลี่ยนเป็น `Allocate Unused Department Code` ที่อ่านรหัสที่ใช้อยู่จริงก่อนแล้วเลือกตัวที่ว่าง

### 5. selector ชนกันเอง (strict mode violation)

`input[placeholder*="ค้นหา"]` แมตช์ช่องค้นหา 2 ช่องบนหน้าเดียวกัน
เปลี่ยนไปใช้ `attendance.report.scanner.search.input` ที่มีอยู่แล้ว

### 6. mobile check-in ไม่ได้แนบรูป

ปลายทางบังคับแนบเซลฟี่ (multipart) แต่เทสส่ง JSON เปล่า จึงได้ 400
เพิ่ม `Send Multipart POST Request Wrapper` และแนบ `tests/data/dummy-image.png`

### 7. ผูกกับชื่อข้อมูล seed

รอข้อความ `"Tenant 3"` ตรง ๆ ทั้งที่ tenant id 3 ชื่อจริงคือ `Demo Tenant`
เลิกยืนยันจากชื่อ เปลี่ยนไปยืนยันจากพฤติกรรมที่ล็อกได้

---

## เทสที่ยัง Skip เพราะรอ frontend

| เทส | ต้องการ |
| --- | --- |
| `ot_request.robot` — เลือกหัวหน้าและเริ่ม OT | หน้า `/attendance/overtime/request` **ไม่มี data-testid สักตัว** — selector `ot-supervisor-combobox` ที่เทสอ้างถึงไม่เคยมีอยู่จริง ต้องเพิ่ม `overtime.request.form.supervisor.select`, `.option.<employeeId>`, `overtime.request.table.row.<employeeId>`, `overtime.request.toolbar.start` |
| `dashboard.robot` — เลือกค่าในตัวกรองบริษัท | ตัวเลือกในดรอปดาวน์ไม่มี testid ต้องการ `attendance.dashboard.tenant.filter.option.<id>` |

เลือก Skip พร้อมเหตุผลที่ทำต่อได้ แทนการปล่อยให้แดงค้าง — เทสที่แดงตลอดจะสอนให้ทีมเลิกสนใจสีแดง

---

## เพิ่มเทสให้หน้าใหม่ (แพตเทิร์นที่ใช้จริงแล้ว)

นำร่องกับ `/settings/rejection-reasons` และ `/settings/application-sources`
ทั้งสองหน้าไม่มี `Sleep` สักจุด ใช้ `data-testid` อย่างเดียว และอ้างแถวด้วย id จริง

### 1. ฝั่ง frontend (hr-frontend)

**ประกาศสถานะของหน้า** ด้วย `components/common/PageStateMarker.tsx` — วางครั้งเดียวในหน้า:

```tsx
const PAGE = "settings.rejectionReasons";
<PageStateMarker page={PAGE} loading={loading} error={loadError} />
```

component จะเรนเดอร์ marker หนึ่งตัวตามสถานะ: `<page>.page.loading` / `.page.ready` / `.page.error`
(มี unit test ที่ `__tests__/common/PageStateMarker.test.tsx`)

**หน้าต้องมีสถานะ error จริง** — ถ้าโหลดพังแล้วตกไปแสดงหน้าว่าง ผู้ใช้จะถูกบอกว่า "ยังไม่มีข้อมูล"
ทั้งที่ข้อมูลแค่โหลดไม่สำเร็จ (เจอบั๊กนี้ทั้งสองหน้านำร่อง: `load()` มีแค่ `try/finally` ไม่มี `catch`)

**ใส่ testid ตาม `docs/TESTING_STANDARDS.md`** — ขั้นต่ำสำหรับหน้ารายการ:
`root`, `toolbar.add`, `modal.create|edit` (+ `.save` `.cancel` `.saving`), `form.<field>.input|error`,
`table`, `table.empty`, `table.row.<id>` (+ `.name` `.action.edit|delete|toggle`), `page.error.retry`

### 2. ฝั่งเทส (hrplus)

หน้ารายการที่หน้าตาแบบเดียวกันใช้ page object ร่วม `tests/resources/pages/sortable_list_page.resource`
สวีทใหม่กำหนดแค่สามตัวแปร:

```robotframework
*** Variables ***
${LIST_PAGE}      settings.applicationSources
${LIST_PATH}      /settings/application-sources
${LIST_FIELD}     label
```

แล้วเขียนเคสด้วยคำศัพท์ของโดเมนนั้น (`Add List Item`, `Rename List Item`, `Toggle List Item`, `Delete List Item`)
ดูตัวอย่างเต็มที่ `tests/e2e/settings/application_sources.robot`

สวีทใหม่ทุกสวีทใช้ `tests/resources/session.resource`:

```robotframework
Suite Setup       Open Browser For Suite
Suite Teardown    Close Browser    ALL
Test Setup        Open Fresh Logged In Page
Test Teardown     Close Test Page
```

### 3. ตรวจความคืบหน้า

```powershell
python scripts/ui_coverage.py ../hr-frontend > docs/UI_COVERAGE.md
```

หน้าที่ใช้ `PageStateMarker` จะขึ้นเป็น `ready`

### 4. ยืนยันผลที่ระบบตอบกลับ

toast ของทั้งแอปมาจาก **sonner** (รวมถึง `hooks/useToast.ts` ที่เป็นแค่ตัวห่อ) ซึ่งติดแอตทริบิวต์ให้อยู่แล้ว
ไม่ต้องเพิ่ม testid:

```robotframework
Wait For Elements State    css=[data-sonner-toast][data-type="success"]    visible
```

การตั้งค่าที่มีผลกับทั้งบริษัท (เช่น `equipment_mode.robot`, `salary_access.robot`) ต้อง **จำค่าเดิมใน Suite Setup
และคืนค่าใน Suite Teardown** — ถ้าเป็นข้อมูลความปลอดภัย ให้คืนค่าผ่าน API ไม่ใช่ผ่านหน้าจอที่อาจล้มกลางทาง

---

## ข้อค้นพบในโค้ด frontend ระหว่างทำเทส

| เรื่อง | รายละเอียด |
| --- | --- |
| หน้าโหลดพังแล้วแสดงข้อมูลผิด | `/settings/rejection-reasons` และ `/settings/application-sources` — `load()` ไม่มี `catch` จึงแสดงว่า "ยังไม่มีข้อมูล" และ `toggleActive` ไม่จัดการ error · `/settings/equipment-mode` — โหลดไม่สำเร็จแล้วยังแสดงโหมดค่าเริ่มต้น (ERP) พร้อมป้าย "ใช้อยู่" ทั้งที่ไม่เคยอ่านค่าจริง ผู้ใช้อาจกดบันทึกทับค่าของบริษัท · `/settings/salary-access` — โหลดไม่สำเร็จแล้วยังแสดงฟอร์มที่แก้ไขได้ด้วยค่าว่าง (ไม่มีผู้อนุมัติ, timeout 0) **ถ้ากดบันทึกตอนนั้นจะลบผู้อนุมัติการดูเงินเดือนทั้งหมดและปิด idle timeout** · `/settings/ot-settings` — `load()` ไม่มี `catch` ฟอร์มจึงค้างค่าตั้งต้นในโค้ด (ระดับผู้สั่ง 7, กติกาขอล่วงหน้าเริ่มต้น) **ถ้ากดบันทึกตอนนั้นจะเขียนทับนโยบาย OT จริงของบริษัท** · แก้แล้วทั้งห้าหน้า — โหลดพังจะแสดง error พร้อมปุ่มลองใหม่แทนข้อมูลที่ไม่ได้อ่านมาจริง หน้าอื่นที่เขียนแบบเดียวกันควรตรวจด้วย |
| `params` ของ route handler ยังเป็นแบบ Next 14 | Next.js 15.5.18 กำหนดให้ `params` เป็น `Promise<{...}>` แต่ route แบบเดิม `{ params: { id: string } }` ยังมีราว 49 จุด (เช่น `app/api/rejection-reasons/[id]/route.ts`, `app/api/application-source-options/[id]/route.ts`) — ยังทำงานเพราะ Next 15 ยอมให้อ่านแบบ sync ชั่วคราว และ `tsc` ฟ้องเมื่อ dev server สร้าง type ของ route นั้น |
| `news.page.ready` อยู่ผิดกิ่ง | `app/(news)/news/page.tsx` เรนเดอร์ marker เฉพาะกรณีมี error และไม่มีข้อมูล — กรณีโหลดสำเร็จจะไม่มี marker เลย ใช้รอหน้าโหลดไม่ได้ |
| แถวพนักงานอ้างด้วยลำดับ | `EmployeeTable.tsx` ใช้ `employees.table.row.${index}` แทน id จริง — ขัดมาตรฐาน และทำให้เทสที่อ้างแถวเปราะเมื่อข้อมูลเปลี่ยน |

## ข้อจำกัดปัจจุบัน: frontend ยังไม่ประกาศ state marker

`docs/TESTING_STANDARDS.md` กำหนดว่าทุกหน้าที่ดึงข้อมูลต้องมี
`<page>.page.loading` / `<page>.page.ready` / `<page>.page.error`
แต่ผลตรวจจริงคือ **ยังแทบไม่มีหน้าไหนทำ**:

```powershell
python scripts/audit_testids.py ../hr-frontend
```

จากผลล่าสุด มี marker ที่ยังขาดรวม **83 จุด** — มีเพียง `news.page.ready`
กับ `announcements.page.loading` เท่านั้นที่ประกาศไว้แล้ว

**ผลที่ตามมา:** ตราบใดที่ยังไม่มี marker เหล่านี้ เทส UI จะไม่มีสัญญาณที่เชื่อถือได้ว่า
"หน้าโหลดเสร็จแล้ว" จึงต้องเดาด้วยการรอตามเวลา ซึ่งเป็นสาเหตุที่ชุดเทสเดิมเต็มไปด้วย
`Sleep` และ fallback แบบ `Run Keyword And Ignore Error` — เทสจะพังแบบสุ่มและปิดบังบั๊กจริง

**ลำดับที่ควรทำ:**

1. ให้ frontend เติม marker ตามผลของ `audit_testids.py` โดยเริ่มจากหน้า core
   (employees, leaves, attendance, settings)
2. เขียน Page Object ใหม่บน `resources/core/` ซึ่งรอ marker เหล่านั้น
3. ลบ `Sleep` และ `Run Keyword And Ignore Error` ออกจากชุดเทสเดิมทีละไฟล์
4. รันซ้ำ 10 ครั้งเพื่อยืนยันว่าไม่มีเทสที่ผลไม่คงที่ ก่อนต่อเข้า CI

`resources/core/page_state.resource` และ `resources/core/table.resource` เขียนรอไว้แล้ว
พร้อมใช้ทันทีที่ marker ฝั่ง frontend มาถึง
